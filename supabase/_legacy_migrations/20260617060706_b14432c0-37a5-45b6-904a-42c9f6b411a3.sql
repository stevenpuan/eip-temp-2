
-- ============================================================
-- 系統管理後台：完整重建（不動 EIP 業務模組資料表）
-- ============================================================

-- 1) ROLES & USER ROLES ---------------------------------------------------
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  avatar_url text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  unique(user_id, role_id)
);

-- security definer: is_admin (避免 RLS 遞迴)
create or replace function public.is_admin(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = _uid and r.code = 'admin'
  );
$$;

grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;
grant select on public.roles to authenticated;
grant all on public.roles to service_role;
grant select, insert, update, delete on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.user_roles enable row level security;

create policy "profiles read all" on public.profiles for select to authenticated using (true);
create policy "profiles self update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles admin all" on public.profiles for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create policy "roles read all" on public.roles for select to authenticated using (true);
create policy "roles admin write" on public.roles for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create policy "user_roles read all" on public.user_roles for select to authenticated using (true);
create policy "user_roles admin write" on public.user_roles for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- Seed roles
insert into public.roles (code, name, is_system) values
  ('admin', '系統設計師', true),
  ('manager', '管理者', true),
  ('member', '一般成員', true)
on conflict (code) do nothing;

-- 2) INVITATIONS & FIRST-ADMIN TRIGGER -----------------------------------
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  email text,
  role_id uuid references public.roles(id),
  invited_by uuid references auth.users(id),
  status text not null default 'unused',
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.invitations to authenticated;
grant all on public.invitations to service_role;
alter table public.invitations enable row level security;
create policy "invitations admin all" on public.invitations for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "invitations read all auth" on public.invitations for select to authenticated using (true);

-- handle_new_user：建立 profile；首位註冊者自動成為 admin + active
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_count int;
  v_admin_role uuid;
  v_member_role uuid;
begin
  select id into v_admin_role from public.roles where code = 'admin';
  select id into v_member_role from public.roles where code = 'member';

  select count(*) into v_count from public.profiles;

  insert into public.profiles (id, email, full_name, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    case when v_count = 0 then 'active' else 'pending' end
  );

  if v_count = 0 and v_admin_role is not null then
    insert into public.user_roles (user_id, role_id) values (new.id, v_admin_role);
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- redeem_invitation RPC
create or replace function public.redeem_invitation(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_inv record;
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then return 'no_user'; end if;
  select * into v_inv from public.invitations where code = p_code;
  if not found then return 'not_found'; end if;
  if v_inv.status <> 'unused' then return 'used'; end if;
  if v_inv.expires_at is not null and v_inv.expires_at < now() then
    update public.invitations set status = 'expired' where id = v_inv.id;
    return 'expired';
  end if;
  update public.profiles set status = 'active' where id = v_uid;
  if v_inv.role_id is not null then
    insert into public.user_roles (user_id, role_id) values (v_uid, v_inv.role_id) on conflict do nothing;
  end if;
  update public.invitations set status = 'used' where id = v_inv.id;
  return 'ok';
end;
$$;

grant execute on function public.redeem_invitation(text) to authenticated;

-- 3) MENUS ---------------------------------------------------------------
create table if not exists public.menus (
  id uuid primary key default gen_random_uuid(),
  menu_key text unique not null,
  parent_id uuid references public.menus(id) on delete cascade,
  title text not null,
  icon text,
  route text,
  module_key text,
  page_key text,
  sort_order int not null default 10,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.menus to authenticated;
grant all on public.menus to service_role;
alter table public.menus enable row level security;
create policy "menus read all" on public.menus for select to authenticated using (true);
create policy "menus admin write" on public.menus for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- 4) ROLE PERMISSIONS ---------------------------------------------------
create table if not exists public.role_module_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles(id) on delete cascade,
  module_key text not null,
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  can_export boolean not null default false,
  unique(role_id, module_key)
);
grant select, insert, update, delete on public.role_module_permissions to authenticated;
grant all on public.role_module_permissions to service_role;
alter table public.role_module_permissions enable row level security;
create policy "rmp read all" on public.role_module_permissions for select to authenticated using (true);
create policy "rmp admin write" on public.role_module_permissions for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create table if not exists public.role_page_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles(id) on delete cascade,
  page_key text not null,
  can_view boolean,
  can_create boolean,
  can_edit boolean,
  can_delete boolean,
  can_export boolean,
  unique(role_id, page_key)
);
grant select, insert, update, delete on public.role_page_permissions to authenticated;
grant all on public.role_page_permissions to service_role;
alter table public.role_page_permissions enable row level security;
create policy "rpp read all" on public.role_page_permissions for select to authenticated using (true);
create policy "rpp admin write" on public.role_page_permissions for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- 5) SYSTEM CONFIGS & LOOKUPS -------------------------------------------
create table if not exists public.system_configs (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  value text,
  group_name text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.system_configs to authenticated;
grant all on public.system_configs to service_role;
alter table public.system_configs enable row level security;
create policy "cfg read all" on public.system_configs for select to authenticated using (true);
create policy "cfg admin write" on public.system_configs for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create table if not exists public.lookups (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  code text not null,
  label text not null,
  sort_order int not null default 10,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(category, code)
);
grant select, insert, update, delete on public.lookups to authenticated;
grant all on public.lookups to service_role;
alter table public.lookups enable row level security;
create policy "lk read all" on public.lookups for select to authenticated using (true);
create policy "lk admin write" on public.lookups for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- 6) FEATURE / ISSUE / TODO / CHANGELOG ---------------------------------
create table if not exists public.feature_requests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  area text,
  description text,
  points_cost int not null default 1,
  submitter_id uuid references auth.users(id),
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.feature_requests to authenticated;
grant all on public.feature_requests to service_role;
alter table public.feature_requests enable row level security;
create policy "fr read all" on public.feature_requests for select to authenticated using (true);
create policy "fr insert auth" on public.feature_requests for insert to authenticated with check (auth.uid() is not null);
create policy "fr admin write" on public.feature_requests for update to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "fr admin del" on public.feature_requests for delete to authenticated using (public.is_admin(auth.uid()));

create table if not exists public.issue_reports (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  severity text not null default 'normal',
  status text not null default 'open',
  reporter_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.issue_reports to authenticated;
grant all on public.issue_reports to service_role;
alter table public.issue_reports enable row level security;
create policy "ir read all" on public.issue_reports for select to authenticated using (true);
create policy "ir insert auth" on public.issue_reports for insert to authenticated with check (auth.uid() is not null);
create policy "ir admin write" on public.issue_reports for update to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "ir admin del" on public.issue_reports for delete to authenticated using (public.is_admin(auth.uid()));

create table if not exists public.dev_todos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'todo',
  created_by uuid references auth.users(id),
  done_at timestamptz,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.dev_todos to authenticated;
grant all on public.dev_todos to service_role;
alter table public.dev_todos enable row level security;
create policy "dt read all" on public.dev_todos for select to authenticated using (true);
create policy "dt insert auth" on public.dev_todos for insert to authenticated with check (auth.uid() is not null);
create policy "dt admin write" on public.dev_todos for update to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "dt admin del" on public.dev_todos for delete to authenticated using (public.is_admin(auth.uid()));

create table if not exists public.changelogs (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  type text not null default 'feature',
  title text not null,
  content text,
  released_at date,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.changelogs to authenticated;
grant all on public.changelogs to service_role;
alter table public.changelogs enable row level security;
create policy "cl read all" on public.changelogs for select to authenticated using (true);
create policy "cl admin write" on public.changelogs for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- 7) LOGS ----------------------------------------------------------------
create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  action text not null,
  route text,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
grant select, insert on public.activity_logs to authenticated;
grant all on public.activity_logs to service_role;
alter table public.activity_logs enable row level security;
create policy "al admin read" on public.activity_logs for select to authenticated using (public.is_admin(auth.uid()));
create policy "al insert any auth" on public.activity_logs for insert to authenticated with check (true);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  action text not null,
  target_table text,
  target_id text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
grant select, insert on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;
alter table public.audit_logs enable row level security;
create policy "au admin read" on public.audit_logs for select to authenticated using (public.is_admin(auth.uid()));
create policy "au insert any auth" on public.audit_logs for insert to authenticated with check (true);

create table if not exists public.error_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  level text not null default 'error',
  message text,
  context jsonb,
  route text,
  created_at timestamptz not null default now()
);
grant select, insert on public.error_logs to authenticated;
grant all on public.error_logs to service_role;
alter table public.error_logs enable row level security;
create policy "el admin read" on public.error_logs for select to authenticated using (public.is_admin(auth.uid()));
create policy "el insert any auth" on public.error_logs for insert to authenticated with check (true);

-- 8) DOC PAGES -----------------------------------------------------------
create table if not exists public.doc_pages (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  title text,
  content text,
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.doc_pages to authenticated;
grant all on public.doc_pages to service_role;
alter table public.doc_pages enable row level security;
create policy "doc read all" on public.doc_pages for select to authenticated using (true);
create policy "doc admin write" on public.doc_pages for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- 9) SEED: lookups, configs, menus, doc pages ---------------------------
insert into public.lookups (category, code, label, sort_order) values
  ('feature_request_status', 'open', '待規劃', 10),
  ('feature_request_status', 'planned', '規劃中', 20),
  ('feature_request_status', 'in_progress', '開發中', 30),
  ('feature_request_status', 'done', '已完成', 40),
  ('feature_request_status', 'rejected', '已拒絕', 50),
  ('changelog_type', 'feature', '功能', 10),
  ('changelog_type', 'fix', '修正', 20),
  ('changelog_type', 'improvement', '優化', 30),
  ('changelog_type', 'other', '其他', 40),
  ('issue_severity', 'low', '低', 10),
  ('issue_severity', 'normal', '一般', 20),
  ('issue_severity', 'high', '高', 30),
  ('issue_severity', 'critical', '嚴重', 40)
on conflict (category, code) do nothing;

insert into public.system_configs (key, value, group_name, description) values
  ('wish_points_monthly', '30', '許願清單', '每月可消耗的許願點數'),
  ('wish_allow_overdraft', 'false', '許願清單', '是否允許超支（true/false）'),
  ('site_name', '後台管理系統', '系統', '系統名稱')
on conflict (key) do nothing;

insert into public.doc_pages (key, title, content) values
  ('user_manual', '使用手冊', '（請編輯使用手冊內容）'),
  ('system_docs', '系統文件', '（請編輯系統文件內容）')
on conflict (key) do nothing;

-- Menus seed
do $$
declare
  g_use uuid; g_dev uuid; g_acc uuid; g_sys uuid;
begin
  -- 群組
  insert into public.menus (menu_key, title, icon, sort_order) values ('grp_use','使用教學','BookOpen',10)
    on conflict (menu_key) do nothing returning id into g_use;
  if g_use is null then select id into g_use from public.menus where menu_key='grp_use'; end if;

  insert into public.menus (menu_key, title, icon, sort_order) values ('grp_dev','系統開發','Code',20)
    on conflict (menu_key) do nothing returning id into g_dev;
  if g_dev is null then select id into g_dev from public.menus where menu_key='grp_dev'; end if;

  insert into public.menus (menu_key, title, icon, sort_order) values ('grp_acc','帳號管理','Users',30)
    on conflict (menu_key) do nothing returning id into g_acc;
  if g_acc is null then select id into g_acc from public.menus where menu_key='grp_acc'; end if;

  insert into public.menus (menu_key, title, icon, sort_order) values ('grp_sys','系統設定','Settings',40)
    on conflict (menu_key) do nothing returning id into g_sys;
  if g_sys is null then select id into g_sys from public.menus where menu_key='grp_sys'; end if;

  -- 頂層：首頁 / 個人設定
  insert into public.menus (menu_key, title, icon, route, sort_order) values
    ('home','首頁','Home','/dashboard',1),
    ('profile','個人設定','User','/dashboard/profile',5)
  on conflict (menu_key) do nothing;

  -- 子項
  insert into public.menus (menu_key, parent_id, title, icon, route, module_key, page_key, sort_order) values
    ('user_manual', g_use, '使用手冊', 'BookOpen', '/dashboard/user-manual', 'user_manual', 'user_manual', 10),
    ('system_docs', g_use, '系統文件', 'FileText', '/dashboard/system-docs', 'system_docs', 'system_docs', 20),

    ('feature_requests', g_dev, '許願清單', 'Lightbulb', '/dashboard/feature-requests', 'feature_requests', 'feature_requests', 10),
    ('issue_reports', g_dev, '問題反饋', 'AlertCircle', '/dashboard/issue-reports', 'issue_reports', 'issue_reports', 20),
    ('dev_todos', g_dev, '代辦事項', 'CheckSquare', '/dashboard/dev-todos', 'dev_todos', 'dev_todos', 30),
    ('dev_history', g_dev, '開發歷程', 'History', '/dashboard/dev-history', 'dev_history', 'dev_history', 40),
    ('activity_logs', g_dev, '操作日誌', 'Activity', '/dashboard/activity-logs', 'activity_logs', 'activity_logs', 50),
    ('audit_logs', g_dev, '稽核日誌', 'ShieldCheck', '/dashboard/audit-logs', 'audit_logs', 'audit_logs', 60),
    ('error_logs', g_dev, '錯誤日誌', 'AlertTriangle', '/dashboard/error-logs', 'error_logs', 'error_logs', 70),

    ('users', g_acc, '帳號列表', 'Users', '/dashboard/users', 'users', 'users', 10),
    ('role_permissions', g_acc, '角色權限', 'KeyRound', '/dashboard/role-permissions', 'role_permissions', 'role_permissions', 20),

    ('menu_management', g_sys, '選單功能', 'Menu', '/dashboard/menu-management', 'menu_management', 'menu_management', 10),
    ('system_config', g_sys, '環境參數', 'Settings2', '/dashboard/system-config', 'system_config', 'system_config', 20),
    ('lookups', g_sys, '資料字典', 'List', '/dashboard/lookups', 'lookups', 'lookups', 30)
  on conflict (menu_key) do nothing;
end $$;

-- 10) Seed permissions: admin 全開（雖然 is_admin 已 bypass，仍寫入以利 UI 顯示）
insert into public.role_module_permissions (role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select r.id, m.module_key, true, true, true, true, true
from public.roles r, (
  select distinct module_key from public.menus where module_key is not null
) m
where r.code = 'admin'
on conflict (role_id, module_key) do update set can_view=true,can_create=true,can_edit=true,can_delete=true,can_export=true;

-- manager：view 全部模組
insert into public.role_module_permissions (role_id, module_key, can_view)
select r.id, m.module_key, true
from public.roles r, (select distinct module_key from public.menus where module_key is not null) m
where r.code = 'manager'
on conflict (role_id, module_key) do nothing;

-- 11) 指派 steven@puansage.net 為系統設計師（若已註冊）
do $$
declare
  v_uid uuid;
  v_admin uuid;
begin
  select id into v_uid from auth.users where lower(email) = 'steven@puansage.net' limit 1;
  select id into v_admin from public.roles where code = 'admin';
  if v_uid is not null and v_admin is not null then
    update public.profiles set status='active' where id = v_uid;
    insert into public.user_roles (user_id, role_id) values (v_uid, v_admin) on conflict do nothing;
  end if;
end $$;
