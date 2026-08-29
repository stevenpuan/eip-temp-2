-- 以 user_roles（帳號管理 5 角色）為唯一來源，自動換算資料存取層級 app_user.role
-- 優先序：admin/manager → company_admin；dept_manager → dept_manager；viewer → viewer；其餘 → member
create or replace function public.eip_derive_app_role(p_user_id uuid)
returns public.user_role language sql stable security definer set search_path=public as $$
  select case
    when exists (select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id
                 where ur.user_id=p_user_id and r.code in ('admin','manager')) then 'company_admin'
    when exists (select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id
                 where ur.user_id=p_user_id and r.code='dept_manager') then 'dept_manager'
    when exists (select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id
                 where ur.user_id=p_user_id and r.code='viewer') then 'viewer'
    else 'member' end::public.user_role;
$$;

create or replace function public.eip_sync_app_user_role()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_uid uuid; v_role public.user_role;
begin
  v_uid := coalesce(NEW.user_id, OLD.user_id);
  v_role := public.eip_derive_app_role(v_uid);
  update public.app_user set role = v_role, updated_at = now()
   where id = v_uid and role is distinct from v_role;
  return null;
end $$;

revoke execute on function public.eip_derive_app_role(uuid) from public;
revoke execute on function public.eip_sync_app_user_role() from public;

drop trigger if exists trg_sync_app_role on public.user_roles;
create trigger trg_sync_app_role
  after insert or delete or update on public.user_roles
  for each row execute function public.eip_sync_app_user_role();

-- 回填：讓現有 app_user.role 與 user_roles 一致（目前已一致，屬保險）
update public.app_user u set role = public.eip_derive_app_role(u.id), updated_at = now()
 where role is distinct from public.eip_derive_app_role(u.id);;
