-- 最高權限系統管理者（系統設計師，roles.code='admin'，＝is_admin()）可檢視/編輯/重指派所有專案（含私密專案）。
-- 一般「管理者」(code='manager') 維持看不到私密專案。用於離職交接時重指派私密專案負責人等破窗處置。

create or replace function public.eip_can_see_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from public.project p
    where p.id = p_project_id and p.tenant_id = current_tenant_id() and (
      public.is_admin((select auth.uid()))                       -- 系統設計師：全部可見（含私密）
      or p.owner_id = (select auth.uid())
      or exists (select 1 from public.project_member pm
                 where pm.project_id = p.id and pm.user_id = (select auth.uid()))
      or (p.visibility_scope <> 'members' and (
            current_role_name() = 'company_admin'
            or p.visibility_scope = 'company'
            or (p.visibility_scope = 'department' and p.department_id is not null
                and public.eip_can_view_dept_record(p.department_id))
      ))
    )
  );
$function$;

create or replace function public.eip_can_edit_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from public.project p
    where p.id = p_project_id and p.tenant_id = current_tenant_id() and (
      public.is_admin((select auth.uid()))                       -- 系統設計師：全部可編輯/重指派（含私密）
      or p.owner_id = (select auth.uid())
      or exists (select 1 from public.project_member pm
                 where pm.project_id = p.id and pm.user_id = (select auth.uid()))
      or (p.visibility_scope <> 'members' and (
            current_role_name() = 'company_admin'
            or (current_role_name() = 'dept_manager' and p.department_id is not null
                and public.eip_user_can_scope_dept(p.department_id))
      ))
    )
  );
$function$;

-- 防護：私密專案的可見範圍/負責人，僅原負責人或系統設計師可變更（原本寫 company_admin＝含一般管理者，收緊為 is_admin）
create or replace function public.eip_project_guard_private()
returns trigger language plpgsql set search_path to 'public'
as $function$
begin
  if old.visibility_scope = 'members'
     and (new.visibility_scope is distinct from old.visibility_scope
          or new.owner_id is distinct from old.owner_id) then
    if not (old.owner_id = (select auth.uid()) or public.is_admin((select auth.uid()))) then
      raise exception '私密專案的可見範圍與負責人，僅能由專案負責人或系統設計師變更' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;;
