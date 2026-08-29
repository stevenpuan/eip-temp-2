-- =====================================================================
-- 0002_m1_tasks.sql — M1 任務與派工
-- 狀態不寫死,改用 task_status 設定表（可自訂欄位名稱/順序/是否為「完成」類）。
-- =====================================================================

create type task_priority as enum ('low', 'normal', 'high', 'urgent');

-- ---- task_type（任務類型 + 子任務步驟範本,使用者自訂） ----
create table task_type (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  name          text not null,                       -- 例:拍攝影片
  default_steps jsonb,                                -- ["道具準備","場內生產",...] 子任務範本
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_task_type_tenant on task_type(tenant_id);
create trigger trg_task_type_updated before update on task_type
  for each row execute function set_updated_at();

-- ---- task_status（看板欄位 / 狀態,可自訂） ----
create table task_status (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  name          text not null,                       -- 種子:待辦/進行中/待確認/完成(+卡關)
  sort_order    int  not null default 0,             -- 看板欄位排序
  is_done_state boolean not null default false,      -- 標記「完成」類（用於進度/逾期/完成率）
  is_default    boolean not null default false,      -- 系統種子值
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_task_status_tenant on task_status(tenant_id);
create trigger trg_task_status_updated before update on task_status
  for each row execute function set_updated_at();

-- ---- task ----
create table task (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant(id) on delete cascade,
  title          text not null,
  description    text,
  type_id        uuid references task_type(id) on delete set null,
  project_id     uuid,                               -- FK 於 0004 加上（project 後建）
  parent_task_id uuid references task(id) on delete cascade,  -- 子任務（跨部門拆解）
  department_id  uuid references department(id) on delete set null,
  owner_id       uuid not null references app_user(id),       -- 主要負責人
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

-- ---- task_collaborator（協作者,多對多） ----
create table task_collaborator (
  task_id uuid not null references task(id) on delete cascade,
  user_id uuid not null references app_user(id) on delete cascade,
  primary key (task_id, user_id)
);

-- ---- task_update（進度回報紀錄） ----
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
create index idx_task_update_task on task_update(task_id);
