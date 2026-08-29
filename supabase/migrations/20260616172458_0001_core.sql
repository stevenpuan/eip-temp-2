create extension if not exists "pgcrypto";

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

create type user_role   as enum ('company_admin', 'dept_manager', 'member', 'viewer');
create type user_status as enum ('active', 'inactive');

create table tenant (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_tenant_updated before update on tenant
  for each row execute function set_updated_at();

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

create table app_user (
  id            uuid primary key,
  tenant_id     uuid not null references tenant(id) on delete cascade,
  name          text not null,
  email         text,
  line_user_id  text,
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
$$;;
