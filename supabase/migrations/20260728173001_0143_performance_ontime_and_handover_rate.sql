-- ============================================================
-- 0143 績效補兩個規格書 I 章要求但缺的指標（P2#13）
--   ・日誌準時率：當天就送出的比例（submitted_at 的台北日期 ≤ log_date）
--     —— 原本只有「送出率」，分不出當天交還是隔幾天補交
--   ・代辦完成率：請假代辦（eip_leave_handover_item）指派給我的完成比例
-- 兩個都放進 eip_performance_summary，讓前端一次拿完。
-- ============================================================
drop function if exists public.eip_performance_by_dept(date, date);
drop function if exists public.eip_performance_summary(date, date, uuid, uuid);

create function public.eip_performance_summary(
  p_from date, p_to date,
  p_department_id uuid default null, p_user_id uuid default null)
 returns table(
   user_id uuid, user_name text, department_id uuid, department_name text,
   tasks_done integer, tasks_overdue_now integer, tasks_open_now integer,
   routine_expected integer, routine_done integer, routine_rate numeric,
   worklog_submitted integer, worklog_draft integer,
   worklog_ontime integer, worklog_ontime_rate numeric,
   meeting_actions_done integer, meeting_actions_open_now integer,
   handover_items integer, handover_done integer, handover_rate numeric,
   anomalies_raised integer, anomalies_closed integer, anomalies_unfilled integer)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_me uuid := auth.uid();
        v_role text := coalesce(current_role_name()::text, '');
        v_sup boolean;
begin
  if v_me is null then raise exception '需要登入身分'; end if;
  if p_to < p_from then raise exception '日期範圍顛倒'; end if;
  if p_to - p_from > 366 then raise exception '一次最多查 366 天'; end if;

  v_sup := public.eip_is_any_dept_supervisor();
  if not v_sup then
    if p_user_id is null then p_user_id := v_me;
    elsif p_user_id <> v_me then raise exception '權限不足：只能查看自己的績效'; end if;
  end if;

  return query
  with u as (
    select a.id, a.name, a.department_id
      from public.app_user a
     where a.status = 'active'
       and (p_user_id is null or a.id = p_user_id)
       and (p_department_id is null or a.department_id = p_department_id)
       and (v_role = 'company_admin' or a.id = v_me
            or (a.department_id is not null and public.eip_user_can_scope_dept(a.department_id)))
  ),
  d as (select generate_series(p_from, p_to, interval '1 day')::date as dt),
  tk as (
    select t.owner_id as uid,
           count(*) filter (where s.is_done_state
                              and (t.completed_at at time zone 'Asia/Taipei')::date between p_from and p_to)::int as done,
           count(*) filter (where not s.is_done_state and t.due_date is not null
                              and t.due_date < (now() at time zone 'Asia/Taipei')::date)::int as overdue_now,
           count(*) filter (where not s.is_done_state)::int as open_now
      from public.task t join public.task_status s on s.id = t.status_id
     where t.deleted_at is null and t.recurring_rule_id is null
     group by t.owner_id
  ),
  rx as (
    select u.id as uid, count(*)::int as n
      from u cross join d
      join public.personal_routine pr
        on pr.user_id = u.id and pr.is_active and pr.deleted_at is null
     where public.eip_personal_routine_due_on(pr, d.dt)
     group by u.id
  ),
  wl as (
    select w.user_id as uid, w.status, w.log_date, w.submitted_at,
           coalesce(w.routine_morning,'[]'::jsonb) || coalesce(w.routine_afternoon,'[]'::jsonb) as items
      from public.work_log w
     where w.deleted_at is null and w.log_date between p_from and p_to
  ),
  wlagg as (
    select wl.uid,
           count(*) filter (where wl.status = 'submitted')::int as submitted,
           count(*) filter (where wl.status <> 'submitted')::int as draft,
           -- 準時＝當天（或更早）就送出；隔天以後才補的不算
           count(*) filter (where wl.status = 'submitted' and wl.submitted_at is not null
                              and (wl.submitted_at at time zone 'Asia/Taipei')::date <= wl.log_date)::int as ontime
      from wl group by wl.uid
  ),
  rd as (
    select wl.uid, count(*)::int as n
      from wl cross join lateral jsonb_array_elements(wl.items) it
     where (it->>'source') = 'personal_routine'
       and coalesce((it->>'done')::boolean, false)
     group by wl.uid
  ),
  ma as (
    select a.owner_id as uid,
           count(*) filter (where a.status = 'done'
                              and (m.meeting_date at time zone 'Asia/Taipei')::date between p_from and p_to)::int as done,
           count(*) filter (where a.status <> 'done')::int as open_now
      from public.meeting_action_item a join public.meeting m on m.id = a.meeting_id
     group by a.owner_id
  ),
  ho as (
    -- 代辦完成率：以「指派給我」為分母，請假單的日期落在區間內
    select i.assignee_id as uid,
           count(*)::int as total,
           count(*) filter (where i.done_at is not null)::int as done
      from public.eip_leave_handover_item i
      join public.eip_quick_report q on q.id = i.quick_report_id and q.deleted_at is null
     where i.assignee_id is not null
       and coalesce(q.leave_from, q.report_date) <= p_to
       and coalesce(q.leave_to, q.report_date) >= p_from
     group by i.assignee_id
  ),
  an as (
    select a.subject_id as uid, count(*)::int as raised,
           count(*) filter (where a.status = 'closed')::int as closed,
           count(*) filter (where a.status = 'pending_fill')::int as unfilled
      from public.eip_anomaly a
     where a.deleted_at is null and a.occurred_on between p_from and p_to
     group by a.subject_id
  )
  select u.id, u.name, u.department_id, dp.name,
         coalesce(tk.done,0), coalesce(tk.overdue_now,0), coalesce(tk.open_now,0),
         coalesce(rx.n,0), coalesce(rd.n,0),
         case when coalesce(rx.n,0) = 0 then null
              else round(coalesce(rd.n,0)::numeric * 100 / rx.n, 1) end,
         coalesce(wlagg.submitted,0), coalesce(wlagg.draft,0),
         coalesce(wlagg.ontime,0),
         case when coalesce(wlagg.submitted,0) + coalesce(wlagg.draft,0) = 0 then null
              else round(coalesce(wlagg.ontime,0)::numeric * 100
                         / (wlagg.submitted + wlagg.draft), 1) end,
         coalesce(ma.done,0), coalesce(ma.open_now,0),
         coalesce(ho.total,0), coalesce(ho.done,0),
         case when coalesce(ho.total,0) = 0 then null
              else round(coalesce(ho.done,0)::numeric * 100 / ho.total, 1) end,
         coalesce(an.raised,0), coalesce(an.closed,0), coalesce(an.unfilled,0)
    from u
    left join public.department dp on dp.id = u.department_id
    left join tk on tk.uid = u.id
    left join rx on rx.uid = u.id
    left join rd on rd.uid = u.id
    left join wlagg on wlagg.uid = u.id
    left join ma on ma.uid = u.id
    left join ho on ho.uid = u.id
    left join an on an.uid = u.id
   order by dp.name nulls last, u.name;
end;
$function$;
revoke all on function public.eip_performance_summary(date, date, uuid, uuid) from public, anon;
grant execute on function public.eip_performance_summary(date, date, uuid, uuid) to authenticated, service_role;

create function public.eip_performance_by_dept(p_from date, p_to date)
 returns table(
   department_id uuid, department_name text, headcount integer,
   tasks_done integer, tasks_overdue_now integer,
   routine_rate numeric, worklog_submit_rate numeric, worklog_ontime_rate numeric,
   handover_rate numeric,
   anomalies_raised integer, anomalies_unfilled integer)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception '需要登入身分'; end if;
  if not public.eip_is_any_dept_supervisor() then
    raise exception '權限不足：僅管理者或部門主管可查看部門績效彙總';
  end if;

  return query
  with p as (select * from public.eip_performance_summary(p_from, p_to))
  select p.department_id, p.department_name, count(*)::int,
         sum(p.tasks_done)::int, sum(p.tasks_overdue_now)::int,
         case when sum(p.routine_expected) = 0 then null
              else round(sum(p.routine_done)::numeric * 100 / sum(p.routine_expected), 1) end,
         case when sum(p.worklog_submitted + p.worklog_draft) = 0 then null
              else round(sum(p.worklog_submitted)::numeric * 100
                         / sum(p.worklog_submitted + p.worklog_draft), 1) end,
         case when sum(p.worklog_submitted + p.worklog_draft) = 0 then null
              else round(sum(p.worklog_ontime)::numeric * 100
                         / sum(p.worklog_submitted + p.worklog_draft), 1) end,
         case when sum(p.handover_items) = 0 then null
              else round(sum(p.handover_done)::numeric * 100 / sum(p.handover_items), 1) end,
         sum(p.anomalies_raised)::int, sum(p.anomalies_unfilled)::int
    from p
   group by p.department_id, p.department_name
   order by p.department_name nulls last;
end;
$function$;
revoke all on function public.eip_performance_by_dept(date, date) from public, anon;
grant execute on function public.eip_performance_by_dept(date, date) to authenticated, service_role;;
