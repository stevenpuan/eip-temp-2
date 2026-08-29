-- 0135 接續 0134：部門例行彙總與異常週彙整的入口閘門一併對齊。
-- 兩支的列層過濾本來就走 eip_user_can_scope_dept / eip_is_dept_supervisor，
-- 所以實際課長看到的範圍不會變大，只是不再被入口擋掉。

create or replace function public.eip_dept_routine_summary(p_from date, p_to date, p_department_id uuid default null)
 returns table(department_id uuid, department_name text, user_id uuid, user_name text,
               log_date date, expected integer, done integer, log_status text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_me uuid := auth.uid(); v_role text := coalesce(current_role_name()::text, '');
begin
  -- fail-closed：0117 原本寫 `if auth.uid() is not null and ...`，anon 會整條跳過
  if v_me is null then raise exception '需要登入身分'; end if;
  if not public.eip_is_any_dept_supervisor() then
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

revoke all on function public.eip_dept_routine_summary(date, date, uuid) from public, anon;
grant execute on function public.eip_dept_routine_summary(date, date, uuid) to authenticated, service_role;


create or replace function public.eip_anomaly_weekly_kpi(p_from date, p_to date, p_department_id uuid default null)
 returns table(department_id uuid, department_name text, total integer, unfilled integer,
               filled integer, improving integer, closed integer, voided integer,
               overdue_unfilled integer, total_amount numeric, avg_close_days numeric)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_me uuid := auth.uid(); v_role text := coalesce(current_role_name()::text, '');
begin
  if v_me is null then raise exception '需要登入身分'; end if;
  if not public.eip_is_any_dept_supervisor() then
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

revoke all on function public.eip_anomaly_weekly_kpi(date, date, uuid) from public, anon;
grant execute on function public.eip_anomaly_weekly_kpi(date, date, uuid) to authenticated, service_role;;
