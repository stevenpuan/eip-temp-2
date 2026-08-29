-- 0118 修正 0110–0117 的授權缺口（我自己造成的，advisor 抓到）
--
-- 問題：Postgres 建立函式時預設把 EXECUTE 授給 PUBLIC。
--       我在 0110–0117 寫的 `revoke execute ... from anon, authenticated` 是 **no-op** ——
--       權限來自 PUBLIC 這個偽角色，不是 anon/authenticated 的個別授權，
--       所以 has_function_privilege('anon', ...) 全部仍然是 true。
--
-- 實際影響（正式環境）：
--   ・POST /rest/v1/rpc/eip_sweep_anomaly_overdue 未登入即可呼叫 → 可觸發大量通知
--   ・eip_performance_summary / eip_dept_routine_summary / eip_anomaly_weekly_kpi
--     的守衛寫成 `if auth.uid() is not null and role not in (...)`，
--     anon 的 auth.uid() 是 null → 守衛整條略過 → **未登入可讀全公司績效與部門例行資料**
--
-- 兩層都修：① 收回 PUBLIC 的 EXECUTE ② 守衛改 fail-closed（沒有登入身分就拒絕）

------------------------------------------------------------------
-- ① 內部／觸發／排程函式：PUBLIC、anon、authenticated 全部收回
--    （只留 postgres 與 service_role，cron 與 trigger 都以 owner 身分執行）
------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.eip_fill_task_checklist_defaults()',
    'public.eip_fill_link_defaults()',
    'public.eip_fill_anomaly_defaults()',
    'public.eip_notify_anomaly()',
    'public.eip_sweep_anomaly_overdue()',
    'public.eip_notify_announcement_published()',
    'public.eip_notify_meeting_invited()',
    'public.eip_fill_personal_routine_defaults()',
    'public.eip_handover_touch()',
    'public.eip_try_jsonb(text)',
    'public.eip_line_status(text)',
    'public.eip_personal_routine_due_on(public.personal_routine, date)',
    'public.eip_rule_due_on(public.recurring_rule, date)',
    'public.eip_derive_app_role(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

------------------------------------------------------------------
-- ② 前端要用的 RPC：收回 PUBLIC 與 anon，明確只給 authenticated
------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.eip_can_edit_task_checklist(uuid)',
    'public.eip_reorder_task_checklist(uuid, uuid[])',
    'public.eip_soft_delete(text, uuid)',
    'public.eip_dept_routine_summary(date, date, uuid)',
    'public.eip_anomaly_weekly_kpi(date, date, uuid)',
    'public.eip_performance_summary(date, date, uuid, uuid)',
    'public.eip_performance_by_dept(date, date)',
    'public.eip_priority_label(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

------------------------------------------------------------------
-- ③ 守衛改 fail-closed：沒有登入身分（auth.uid() is null）就拒絕。
--    這幾支都不由 cron 呼叫，所以不需要保留「無身分可執行」的後路。
--    eip_performance_by_dept 內部呼叫 eip_performance_summary，
--    auth.uid() 讀的是 GUC，不受 SECURITY DEFINER 影響，仍是原呼叫者，因此連帶被保護。
------------------------------------------------------------------
create or replace function public.eip_dept_routine_summary(
  p_from date, p_to date, p_department_id uuid default null)
 returns table(
   department_id uuid, department_name text,
   user_id uuid, user_name text,
   log_date date, expected int, done int,
   log_status text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_me uuid := auth.uid(); v_role text := coalesce(current_role_name()::text, '');
begin
  -- fail-closed：0117 原本寫 `if auth.uid() is not null and ...`，anon 會整條跳過
  if v_me is null then raise exception '需要登入身分'; end if;
  if v_role not in ('company_admin','dept_manager') then
    raise exception '權限不足：僅管理者或部門主管可查看部門例行彙總';
  end if;
  if p_to < p_from then raise exception '日期範圍顛倒'; end if;
  if p_to - p_from > 92 then raise exception '一次最多查 92 天'; end if;

  return query
  with d as (select generate_series(p_from, p_to, interval '1 day')::date as dt),
  u as (
    select a.id, a.name, a.department_id
      from public.app_user a
     where a.status = 'active'
       and (p_department_id is null or a.department_id = p_department_id)
       and (v_role = 'company_admin'
            or (a.department_id is not null and public.eip_user_can_scope_dept(a.department_id)))
  ),
  exp as (
    select u.id as uid, d.dt, count(*)::int as n
      from u cross join d
      join public.personal_routine pr
        on pr.user_id = u.id and pr.is_active and pr.deleted_at is null
     where public.eip_personal_routine_due_on(pr, d.dt)
     group by u.id, d.dt
  ),
  wl as (
    select w.user_id as uid, w.log_date as dt, w.status,
           coalesce(w.routine_morning, '[]'::jsonb) || coalesce(w.routine_afternoon, '[]'::jsonb) as items
      from public.work_log w
     where w.deleted_at is null and w.log_date between p_from and p_to
  ),
  dn as (
    select wl.uid, wl.dt, wl.status,
           coalesce(count(*) filter (
             where (it->>'source') = 'personal_routine'
               and coalesce((it->>'done')::boolean, false)), 0)::int as n
      from wl
      left join lateral jsonb_array_elements(wl.items) it on true
     group by wl.uid, wl.dt, wl.status
  )
  select u.department_id, dp.name, u.id, u.name, d.dt,
         coalesce(exp.n, 0), coalesce(dn.n, 0), dn.status
    from u
    cross join d
    left join public.department dp on dp.id = u.department_id
    left join exp on exp.uid = u.id and exp.dt = d.dt
    left join dn  on dn.uid  = u.id and dn.dt  = d.dt
   where coalesce(exp.n, 0) > 0 or coalesce(dn.n, 0) > 0
   order by dp.name nulls last, u.name, d.dt;
end;
$function$;

create or replace function public.eip_anomaly_weekly_kpi(
  p_from date, p_to date, p_department_id uuid default null)
 returns table(
   department_id uuid, department_name text,
   total int, unfilled int, filled int, improving int, closed int, voided int,
   overdue_unfilled int, total_amount numeric, avg_close_days numeric)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_me uuid := auth.uid(); v_role text := coalesce(current_role_name()::text, '');
begin
  if v_me is null then raise exception '需要登入身分'; end if;
  if v_role not in ('company_admin','dept_manager') then
    raise exception '權限不足：僅管理者或部門主管可查看異常週彙整';
  end if;
  if p_to < p_from then raise exception '日期範圍顛倒'; end if;

  return query
  select a.department_id,
         d.name,
         count(*)::int,
         count(*) filter (where a.status = 'pending_fill')::int,
         count(*) filter (where a.status = 'filled')::int,
         count(*) filter (where a.status = 'improving')::int,
         count(*) filter (where a.status = 'closed')::int,
         count(*) filter (where a.status = 'void')::int,
         count(*) filter (where a.status = 'pending_fill'
                            and a.fill_due_date < (now() at time zone 'Asia/Taipei')::date)::int,
         coalesce(sum(a.amount), 0)::numeric,
         round(avg(extract(epoch from (a.closed_at - a.raised_at)) / 86400)
               filter (where a.closed_at is not null), 1)::numeric
    from public.eip_anomaly a
    left join public.department d on d.id = a.department_id
   where a.deleted_at is null
     and a.occurred_on between p_from and p_to
     and (p_department_id is null or a.department_id = p_department_id)
     and (v_role = 'company_admin' or public.eip_is_dept_supervisor(a.department_id))
   group by a.department_id, d.name
   order by d.name nulls last;
end;
$function$;

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
  if v_me is null then raise exception '需要登入身分'; end if;
  if p_to < p_from then raise exception '日期範圍顛倒'; end if;
  if p_to - p_from > 366 then raise exception '一次最多查 366 天'; end if;

  -- 一般員工只能看自己
  if v_role not in ('company_admin','dept_manager') then
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
       and (v_role = 'company_admin'
            or a.id = v_me
            or (a.department_id is not null and public.eip_user_can_scope_dept(a.department_id)))
  ),
  d as (select generate_series(p_from, p_to, interval '1 day')::date as dt),
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
  rx as (
    select u.id as uid, count(*)::int as n
      from u cross join d
      join public.personal_routine pr
        on pr.user_id = u.id and pr.is_active and pr.deleted_at is null
     where public.eip_personal_routine_due_on(pr, d.dt)
     group by u.id
  ),
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
  ma as (
    select a.owner_id as uid,
           count(*) filter (where a.status = 'done')::int as done,
           count(*) filter (where a.status <> 'done')::int as open
      from public.meeting_action_item a
     group by a.owner_id
  ),
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

create or replace function public.eip_performance_by_dept(p_from date, p_to date)
 returns table(
   department_id uuid, department_name text, headcount int,
   tasks_done int, tasks_overdue int,
   routine_rate numeric, worklog_submit_rate numeric,
   anomalies_raised int, anomalies_unfilled int)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_me uuid := auth.uid(); v_role text := coalesce(current_role_name()::text, '');
begin
  if v_me is null then raise exception '需要登入身分'; end if;
  if v_role not in ('company_admin','dept_manager') then
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

-- CREATE OR REPLACE 會重設 ACL 為預設值，所以四支重寫過的要再收一次
do $$
declare f text;
begin
  foreach f in array array[
    'public.eip_dept_routine_summary(date, date, uuid)',
    'public.eip_anomaly_weekly_kpi(date, date, uuid)',
    'public.eip_performance_summary(date, date, uuid, uuid)',
    'public.eip_performance_by_dept(date, date)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;;
