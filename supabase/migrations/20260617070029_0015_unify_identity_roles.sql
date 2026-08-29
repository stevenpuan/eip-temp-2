-- =====================================================================
-- 0015 P0-a:身分/角色整併 — 框架角色成為單一事實來源
--  - 補上 EIP 需要的角色 dept_manager / viewer 到框架 roles
--  - current_role_name() 改為「讀框架 user_roles → 對應 EIP 角色」,
--    無框架角色時 fallback 到 app_user.role(安全)
--  - profiles 新增時自動建 app_user(EIP 擴充半:tenant/department/line),
--    確保 EIP 外鍵(owner_id 等)永遠有對應
-- =====================================================================

-- 1) 補框架角色(對齊 EIP 四級)
insert into roles (code, name, is_system) values
  ('dept_manager', '部門主管', true),
  ('viewer',       '唯讀',     true)
on conflict (code) do nothing;

-- 2) 角色單一來源:EIP 角色由框架 user_roles 推導(取最高權限)
create or replace function current_role_name()
returns user_role
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select (case
        when count(*) filter (where r.code in ('admin','manager','company_admin')) > 0 then 'company_admin'
        when count(*) filter (where r.code = 'dept_manager') > 0 then 'dept_manager'
        when count(*) filter (where r.code = 'member')       > 0 then 'member'
        when count(*) filter (where r.code = 'viewer')       > 0 then 'viewer'
        else null end)::user_role
     from user_roles ur join roles r on r.id = ur.role_id
     where ur.user_id = auth.uid()),
    (select role from app_user where id = auth.uid())   -- fallback:無框架角色者
  );
$$;

-- 3) profiles → app_user 自動同步(確保每個框架使用者都有 EIP 擴充列)
create or replace function sync_profile_to_app_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into app_user (id, tenant_id, name, email, role, status)
  values (new.id,
          '00000000-0000-0000-0000-000000000001',
          coalesce(new.full_name, split_part(new.email, '@', 1)),
          new.email, 'member', 'active')
  on conflict (id) do update
    set email = excluded.email,
        name  = coalesce(app_user.name, excluded.name);
  return new;
end; $$;

drop trigger if exists trg_profile_sync on profiles;
create trigger trg_profile_sync after insert on profiles
  for each row execute function sync_profile_to_app_user();

-- 4) 回填:現有 profiles 補上對應 app_user(若缺)
insert into app_user (id, tenant_id, name, email, role, status)
select p.id, '00000000-0000-0000-0000-000000000001',
       coalesce(p.full_name, split_part(p.email,'@',1)), p.email, 'member', 'active'
from profiles p
where not exists (select 1 from app_user a where a.id = p.id)
on conflict (id) do nothing;;
