create type task_priority as enum ('low', 'normal', 'high', 'urgent');

create table task_type (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  name          text not null,
  default_steps jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_task_type_tenant on task_type(tenant_id);
create trigger trg_task_type_updated before update on task_type
  for each row execute function set_updated_at();

create table task_status (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  name          text not null,
  sort_order    int  not null default 0,
  is_done_state boolean not null default false,
  is_default    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_task_status_tenant on task_status(tenant_id);
create trigger trg_task_status_updated before update on task_status
  for each row execute function set_updated_at();

create table task (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant(id) on delete cascade,
  title          text not null,
  description    text,
  type_id        uuid references task_type(id) on delete set null,
  project_id     uuid,
  parent_task_id uuid references task(id) on delete cascade,
  department_id  uuid references department(id) on delete set null,
  owner_id       uuid not null references app_user(id),
  priority       task_priority not null default 'normal',
  status_id      uuid not null references task_status(id),
  progress       int  not null default 0 check (progress between 0 and 100),
  due_date       date,
  created_by     uuid not null references app_user(id),
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_task_tenant  on task(tenant_id);
create index idx_task_owner    on task(owner_id);
create index idx_task_dept     on task(department_id);
create index idx_task_project  on task(project_id);
create index idx_task_parent   on task(parent_task_id);
create index idx_task_status   on task(status_id);
create trigger trg_task_updated before update on task
  for each row execute function set_updated_at();

create table task_collaborator (
  task_id uuid not null references task(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  primary key (task_id, user_id)
);

create table task_update (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenant(id) on delete cascade,
  task_id               uuid not null references task(id) on delete cascade,
  user_id               uuid not null references app_user(id),
  progress              int check (progress between 0 and 100),
  comment               text,
  status_changed_to_id  uuid references task_status(id) on delete set null,
  created_at            timestamptz not null default now()
);
create index idx_task_update_task on task_update(task_id);;
