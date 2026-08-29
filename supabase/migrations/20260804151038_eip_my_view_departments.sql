-- 前端過濾用：回傳目前使用者「看得到資料」的部門集合
-- ＝ 向上(自身部門及其上層) ∪ 向下(自己管轄的子樹：manager_id∪eip_dept_supervisor) ∪ 被授權(eip_dept_view_grant)
-- 與 eip_can_view_dept_record + eip_can_view_dept_shared 語意一致；company_admin 回全部。
create or replace function public.eip_my_view_departments()
returns setof uuid
language sql stable security definer set search_path to 'public'
as $function$
  with roots as (
    select d.id from public.department d
      where d.manager_id = (select auth.uid()) and d.tenant_id = current_tenant_id()
    union
    select s.department_id from public.eip_dept_supervisor s
      where s.user_id = (select auth.uid()) and s.tenant_id = current_tenant_id()
  ),
  gall as (
    select exists (
      select 1 from public.eip_dept_view_grant g
       where g.user_id = (select auth.uid()) and g.tenant_id = current_tenant_id()
         and g.is_active and g.department_id is null
    ) as f
  ),
  groots as (
    select g.department_id, g.include_subtree
      from public.eip_dept_view_grant g
     where g.user_id = (select auth.uid()) and g.tenant_id = current_tenant_id()
       and g.is_active and g.department_id is not null
  )
  select d.id
    from public.department d
   where d.tenant_id = current_tenant_id()
     and (
          current_role_name() = 'company_admin'
       or (select f from gall)
       or public.eip_dept_in_subtree(public.current_department_id(), d.id)               -- 向上（含自身部門）
       or exists (select 1 from roots r where public.eip_dept_in_subtree(d.id, r.id))     -- 向下（管轄子樹）
       or exists (select 1 from groots gr
                   where (gr.include_subtree and public.eip_dept_in_subtree(d.id, gr.department_id))
                      or (not gr.include_subtree and d.id = gr.department_id))             -- 被授權
     );
$function$;

revoke all on function public.eip_my_view_departments() from public;
grant execute on function public.eip_my_view_departments() to authenticated, service_role;;
