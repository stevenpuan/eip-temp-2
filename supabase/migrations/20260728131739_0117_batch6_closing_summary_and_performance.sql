-- 0117 批6（第一部分）：task.closing_summary + 績效儀表板
-- work_log_item 正規化不在這一批 —— 會動到正式庫既有 32 筆日誌的 JSON 結構，
-- 排到 8/1 上線之後單獨處理。

------------------------------------------------------------------
-- ① 任務結案摘要
--    不加 NOT NULL / CHECK：既有任務沒有摘要，強制會讓現有結案流程直接壞掉。
--    「結案要填摘要」由前端在切到 done 狀態時提示，DB 只負責存。
------------------------------------------------------------------
alter table public.task add column if not exists closing_summary text;

comment on column public.task.closing_summary is
  '結案摘要：做了什麼、結果如何。前端在切換到 is_done_state 狀態時提示填寫，DB 不強制';

------------------------------------------------------------------
-- ② 績效儀表板
--    口徑一律走「兩軸分類 + 工作日誌為唯一出海口」的架構：
--      例行 → 個人例行範本應做/已做（從日誌 JSON 取）
--      特殊 → 任務看板（完成/逾期/未完成）＋ 會議決議行動項
--      異常 → eip_anomaly（被開立件數、已結案件數）
--      日誌 → 送出天數（draft 不算）
--
--    權限：管理者看全公司、部門主管看管轄範圍、一般員工只能看自己。
------------------------------------------------------------------
create or replace function public.eip_performance_summary(
  p_from date, p_to date, p_department_id uuid default null, p_user_id uuid default null)
 returns table(
   user_id uuid, user_name text,
   department_id uuid, department_name text,
   tasks_done int, tasks_overdue int, tasks_open int,
   routine_expected int, routine_done int, routine_rate numeric,
   worklog_submitted int, worklog_draft int,
   meeting_actions_done int, meeting_actions_open int,
   anomalies_raised int, anomalies_closed int, anomalies_unfilled int)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_me uuid := auth.uid(); v_role text := coalesce(current_role_name()::text, '');
begin
  if p_to < p_from then raise exception '日期範圍顛倒'; end if;
  if p_to - p_from > 366 then raise exception '一次最多查 366 天'; end if;

  -- 一般員工只能看自己
  if v_me is not null and v_role not in ('company_admin','dept_manager') then
    if p_user_id is null then
      p_user_id := v_me;
    elsif p_user_id <> v_me then
      raise exception '權限不足：只能查看自己的績效';
    end if;
  end if;

  return query
  with u as (
    select a.id, a.name, a.department_id
      from public.app_user a
     where a.status = 'active'
       and (p_user_id is null or a.id = p_user_id)
       and (p_department_id is null or a.department_id = p_department_id)
       and (v_me is null
            or v_role = 'company_admin'
            or a.id = v_me
            or (a.department_id is not null and public.eip_user_can_scope_dept(a.department_id)))
  ),
  d as (select generate_series(p_from, p_to, interval '1 day')::date as dt),
  -- 特殊工作：任務
  tk as (
    select t.owner_id as uid,
           count(*) filter (where s.is_done_state
                              and (t.completed_at at time zone 'Asia/Taipei')::date between p_from and p_to)::int as done,
           count(*) filter (where not s.is_done_state
                              and t.due_date is not null
                              and t.due_date < (now() at time zone 'Asia/Taipei')::date)::int as overdue,
           count(*) filter (where not s.is_done_state)::int as open
      from public.task t
      join public.task_status s on s.id = t.status_id
     where t.deleted_at is null and t.recurring_rule_id is null
     group by t.owner_id
  ),
  -- 例行：應做（範本到期日數）
  rx as (
    select u.id as uid, count(*)::int as n
      from u cross join d
      join public.personal_routine pr
        on pr.user_id = u.id and pr.is_active and pr.deleted_at is null
     where public.eip_personal_routine_due_on(pr, d.dt)
     group by u.id
  ),
  -- 日誌：送出天數、草稿天數、例行已做項數
  wl as (
    select w.user_id as uid, w.status,
           coalesce(w.routine_morning,'[]'::jsonb) || coalesce(w.routine_afternoon,'[]'::jsonb) as items
      from public.work_log w
     where w.deleted_at is null and w.log_date between p_from and p_to
  ),
  wlagg as (
    select wl.uid,
           count(*) filter (where wl.status = 'submitted')::int as submitted,
           count(*) filter (where wl.status <> 'submitted')::int as draft
      from wl group by wl.uid
  ),
  rd as (
    select wl.uid, count(*)::int as n
      from wl
      cross join lateral jsonb_array_elements(wl.items) it
     where (it->>'source') = 'personal_routine'
       and coalesce((it->>'done')::boolean, false)
     group by wl.uid
  ),
  -- 會議決議行動項
  ma as (
    select a.owner_id as uid,
           count(*) filter (where a.status = 'done')::int as done,
           count(*) filter (where a.status <> 'done')::int as open
      from public.meeting_action_item a
     group by a.owner_id
  ),
  -- 異常缺失（被開立在這個人身上的）
  an as (
    select a.subject_id as uid,
           count(*)::int as raised,
           count(*) filter (where a.status = 'closed')::int as closed,
           count(*) filter (where a.status = 'pending_fill')::int as unfilled
      from public.eip_anomaly a
     where a.deleted_at is null and a.occurred_on between p_from and p_to
     group by a.subject_id
  )
  select u.id, u.name, u.department_id, dp.name,
         coalesce(tk.done,0), coalesce(tk.overdue,0), coalesce(tk.open,0),
         coalesce(rx.n,0), coalesce(rd.n,0),
         case when coalesce(rx.n,0) = 0 then null
              else round(coalesce(rd.n,0)::numeric * 100 / rx.n, 1) end,
         coalesce(wlagg.submitted,0), coalesce(wlagg.draft,0),
         coalesce(ma.done,0), coalesce(ma.open,0),
         coalesce(an.raised,0), coalesce(an.closed,0), coalesce(an.unfilled,0)
    from u
    left join public.department dp on dp.id = u.department_id
    left join tk    on tk.uid    = u.id
    left join rx    on rx.uid    = u.id
    left join rd    on rd.uid    = u.id
    left join wlagg on wlagg.uid = u.id
    left join ma    on ma.uid    = u.id
    left join an    on an.uid    = u.id
   order by dp.name nulls last, u.name;
end;
$function$;

grant execute on function public.eip_performance_summary(date, date, uuid, uuid) to authenticated;
revoke execute on function public.eip_performance_summary(date, date, uuid, uuid) from anon;

------------------------------------------------------------------
-- ③ 部門層級的彙總（儀表板上方的卡片用，避免前端自己 group 一次）
------------------------------------------------------------------
create or replace function public.eip_performance_by_dept(
  p_from date, p_to date)
 returns table(
   department_id uuid, department_name text, headcount int,
   tasks_done int, tasks_overdue int,
   routine_rate numeric, worklog_submit_rate numeric,
   anomalies_raised int, anomalies_unfilled int)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is not null
     and coalesce(current_role_name()::text,'') not in ('company_admin','dept_manager') then
    raise exception '權限不足：僅管理者或部門主管可查看部門績效彙總';
  end if;

  return query
  with p as (select * from public.eip_performance_summary(p_from, p_to))
  select p.department_id, p.department_name, count(*)::int,
         sum(p.tasks_done)::int, sum(p.tasks_overdue)::int,
         case when sum(p.routine_expected) = 0 then null
              else round(sum(p.routine_done)::numeric * 100 / sum(p.routine_expected), 1) end,
         case when sum(p.worklog_submitted + p.worklog_draft) = 0 then null
              else round(sum(p.worklog_submitted)::numeric * 100
                         / sum(p.worklog_submitted + p.worklog_draft), 1) end,
         sum(p.anomalies_raised)::int, sum(p.anomalies_unfilled)::int
    from p
   group by p.department_id, p.department_name
   order by p.department_name nulls last;
end;
$function$;

grant execute on function public.eip_performance_by_dept(date, date) to authenticated;
revoke execute on function public.eip_performance_by_dept(date, date) from anon;;
