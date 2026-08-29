
create or replace function public.eip_phone_order_summary(
  p_year int, p_month int, p_department_id uuid default null)
returns table(
  user_id uuid, user_name text, department_id uuid, department_name text,
  total_orders int, total_errors int, days_recorded int, work_days int,
  avg_score numeric, locked boolean)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_me uuid := auth.uid(); v_from date; v_to date; v_locked boolean;
begin
  if v_me is null then raise exception '需要登入身分'; end if;
  if not (public.eip_is_phone_order_hr() or public.eip_is_any_dept_supervisor()) then
    raise exception '權限不足：僅人資或部門主管可查看電話訂單彙總';
  end if;
  if p_month < 1 or p_month > 12 then raise exception '月份不正確'; end if;
  v_from := make_date(p_year, p_month, 1);
  v_to := (v_from + interval '1 month' - interval '1 day')::date;
  select coalesce(bool_or(l.locked), false) into v_locked
    from public.phone_order_lock l
   where l.tenant_id = current_tenant_id() and l.ym = v_from;

  return query
  with parts as (
    select distinct uid from (
      select pod.user_id uid from public.phone_order_daily pod
        where pod.tenant_id = current_tenant_id() and pod.log_date between v_from and v_to
      union
      select pm.user_id from public.phone_order_month pm
        where pm.tenant_id = current_tenant_id() and pm.ym = v_from
    ) x
  ),
  base as (
    select a.id uid, a.name, a.department_id
      from parts p join public.app_user a on a.id = p.uid
     where (p_department_id is null or a.department_id = p_department_id)
       and (public.eip_is_phone_order_hr()
            or (a.department_id is not null and public.eip_user_can_scope_dept(a.department_id)))
  ),
  d as (
    select pod.user_id uid,
           coalesce(sum(pod.order_count), 0)::int tot,
           coalesce(sum(pod.error_count), 0)::int err,
           count(*)::int days
      from public.phone_order_daily pod
     where pod.tenant_id = current_tenant_id() and pod.log_date between v_from and v_to
     group by pod.user_id
  ),
  m as (
    select pm.user_id uid, pm.work_days
      from public.phone_order_month pm
     where pm.tenant_id = current_tenant_id() and pm.ym = v_from
  )
  select b.uid, b.name, b.department_id, dp.name,
         coalesce(d.tot, 0), coalesce(d.err, 0), coalesce(d.days, 0),
         m.work_days,
         case when coalesce(m.work_days, 0) > 0
              then round(coalesce(d.tot, 0)::numeric / m.work_days, 2) else null end,
         v_locked
    from base b
    left join public.department dp on dp.id = b.department_id
    left join d on d.uid = b.uid
    left join m on m.uid = b.uid
   order by dp.name nulls last, b.name;
end $$;

create or replace function public.eip_phone_order_error_detail(
  p_year int, p_month int, p_department_id uuid default null)
returns table(
  log_date date, user_id uuid, user_name text, department_name text,
  error_count int, error_reason text, remark text)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_me uuid := auth.uid(); v_from date; v_to date;
begin
  if v_me is null then raise exception '需要登入身分'; end if;
  if not (public.eip_is_phone_order_hr() or public.eip_is_any_dept_supervisor()) then
    raise exception '權限不足：僅人資或部門主管可查看失誤明細';
  end if;
  if p_month < 1 or p_month > 12 then raise exception '月份不正確'; end if;
  v_from := make_date(p_year, p_month, 1);
  v_to := (v_from + interval '1 month' - interval '1 day')::date;

  return query
  select pod.log_date, a.id, a.name, dp.name, pod.error_count, pod.error_reason, pod.remark
    from public.phone_order_daily pod
    join public.app_user a on a.id = pod.user_id
    left join public.department dp on dp.id = a.department_id
   where pod.tenant_id = current_tenant_id()
     and pod.log_date between v_from and v_to
     and pod.error_count > 0
     and (p_department_id is null or a.department_id = p_department_id)
     and (public.eip_is_phone_order_hr()
          or (a.department_id is not null and public.eip_user_can_scope_dept(a.department_id)))
   order by pod.log_date, a.name;
end $$;
;
