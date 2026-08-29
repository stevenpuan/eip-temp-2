-- 「僅參與成員」私密專案：只有負責人與被加入的成員可見/可編輯；連系統管理者、部門主管、跨部門都看不到。

-- 1) 可編輯判定（負責人 / 專案成員 / 非私密時的 admin 或 部門主管(限管轄)）
create or replace function public.eip_can_edit_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from public.project p
    where p.id = p_project_id and p.tenant_id = current_tenant_id() and (
      p.owner_id = (select auth.uid())
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
revoke all on function public.eip_can_edit_project(uuid) from public;
grant execute on function public.eip_can_edit_project(uuid) to anon, authenticated, service_role;

-- 2) 可見判定：private(members) 排除 admin/部門/全公司，只留 負責人 + 成員
create or replace function public.eip_can_see_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from public.project p
    where p.id = p_project_id and p.tenant_id = current_tenant_id() and (
      p.owner_id = (select auth.uid())
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

-- 3) 專案與子物件寫入：統一走 eip_can_edit_project（成員可編輯；私密專案自動排除 admin/部門主管）
alter policy project_write on public.project
  using (tenant_id = current_tenant_id() and public.eip_can_edit_project(id))
  with check (tenant_id = current_tenant_id());

alter policy milestone_write on public.milestone
  using (tenant_id = current_tenant_id() and public.eip_can_edit_project(project_id))
  with check (tenant_id = current_tenant_id() and public.eip_can_edit_project(project_id));

alter policy project_kpi_write on public.project_kpi
  using (tenant_id = current_tenant_id() and public.eip_can_edit_project(project_id))
  with check (tenant_id = current_tenant_id() and public.eip_can_edit_project(project_id));

alter policy project_risk_write on public.project_risk
  using (tenant_id = current_tenant_id() and public.eip_can_edit_project(project_id))
  with check (tenant_id = current_tenant_id() and public.eip_can_edit_project(project_id));

-- 成員名單管理：改為「可編輯專案者」皆可管理（含成員自己），移除「任何部門主管都能加任何專案成員」的漏洞
alter policy project_member_write on public.project_member
  using (public.eip_can_edit_project(project_id))
  with check (public.eip_can_edit_project(project_id));

-- 4) 私密專案防護：可見範圍/負責人只能由原負責人或系統管理者變更，避免成員誤把私密專案改公開或換負責人
create or replace function public.eip_project_guard_private()
returns trigger language plpgsql set search_path to 'public'
as $function$
begin
  if old.visibility_scope = 'members'
     and (new.visibility_scope is distinct from old.visibility_scope
          or new.owner_id is distinct from old.owner_id) then
    if not (old.owner_id = (select auth.uid()) or public.current_role_name() = 'company_admin') then
      raise exception '私密專案的可見範圍與負責人，僅能由專案負責人或系統管理者變更' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;
drop trigger if exists trg_project_guard_private on public.project;
create trigger trg_project_guard_private
  before update on public.project
  for each row execute function public.eip_project_guard_private();;
