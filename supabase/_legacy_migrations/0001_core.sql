-- =====================================================================
-- 0001_core.sql — 核心:租戶 / 部門 / 使用者 + 共用 enum
-- 命名:snake_case。所有業務表含 tenant_id（MVP 全填同一值）、created_at、updated_at。
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---- 共用:updated_at 自動更新 ----
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

-- ---- enum 型別 ----
create type user_role   as enum ('company_admin', 'dept_manager', 'member', 'viewer');
create type user_status as enum ('active', 'inactive');

-- ---- tenant ----
create table tenant (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_tenant_updated before update on tenant
  for each row execute function set_updated_at();

-- ---- department（支援子部門） ----
create table department (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  name        text not null,
  parent_id   uuid references department(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_department_tenant on department(tenant_id);
create trigger trg_department_updated before update on department
  for each row execute function set_updated_at();

-- ---- app_user（對應 Supabase auth.users 的 profile） ----
create table app_user (
  id            uuid primary key,                    -- = auth.users.id
  tenant_id     uuid not null references tenant(id) on delete cascade,
  name          text not null,
  email         text,
  line_user_id  text,                                -- LINE 綁定
  department_id uuid references department(id) on delete set null,
  role          user_role   not null default 'member',
  status        user_status not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_app_user_tenant on app_user(tenant_id);
create index idx_app_user_dept   on app_user(department_id);
create index idx_app_user_line   on app_user(line_user_id);
create trigger trg_app_user_updated before update on app_user
  for each row execute function set_updated_at();

-- ---- 輔助函式:取目前登入者的 tenant / 部門 / 角色（供 RLS 用） ----
-- 重要:這些函式內部查 app_user,而 app_user 本身有 RLS,其 policy 又呼叫這些函式。
--   若用一般（invoker）權限會造成「policy → 函式 → policy」無窮遞迴。
--   故一律 SECURITY DEFINER,讓函式以擁有者身分執行、繞過 app_user 的 RLS,打斷遞迴。
--   並固定 search_path,避免 search_path 注入。
create or replace function current_tenant_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select tenant_id from app_user where id = auth.uid();
$$;

create or replace function current_role_name()
returns user_role
language sql stable security definer set search_path = public as $$
  select role from app_user where id = auth.uid();
$$;

create or replace function current_department_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select department_id from app_user where id = auth.uid();
$$;
