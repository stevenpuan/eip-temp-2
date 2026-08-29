-- LINE 助理用 service_role 執行（沒有 auth.uid()），無法呼叫 eip_my_supervised_departments()。
-- 提供一個帶 user id 的版本，讓 edge function 能把部門主管的可見範圍限縮到自己的部門子樹，
-- 與網頁端的 RLS 口徑一致。
create or replace function public.eip_supervised_departments_of(p_user uuid)
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  with roots as (
    select d.id from public.department d where d.manager_id = p_user
    union
    select s.department_id from public.eip_dept_supervisor s where s.user_id = p_user
  )
  select distinct d.id
    from public.department d
    join roots r on public.eip_dept_in_subtree(d.id, r.id);
$$;

revoke all on function public.eip_supervised_departments_of(uuid) from public, anon, authenticated;
grant execute on function public.eip_supervised_departments_of(uuid) to postgres, service_role;
;
