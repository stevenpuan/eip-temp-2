-- =====================================================================
-- 0004_m3_projects.sql — M3 專案管理（Kanban only,Scrum 移出 MVP）
-- 同時補上 task / meeting 對 project 的 FK（project 此時才存在）。
-- =====================================================================

create type project_status   as enum ('planning', 'active', 'on_hold', 'done');
create type milestone_status as enum ('pending', 'done');

-- ---- project ----
create table project (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  name        text not null,
  description text,
  goal        text,
  start_date  date,
  end_date    date,
  status      project_status not null default 'planning',
  owner_id    uuid not null references app_user(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_project_tenant on project(tenant_id);
create trigger trg_project_updated before update on project
  for each row execute function set_updated_at();

-- ---- project_member ----
create table project_member (
  project_id uuid not null references project(id) on delete cascade,
  user_id    uuid not null references app_user(id) on delete cascade,
  role       text,                                   -- 例:PM、成員
  primary key (project_id, user_id)
);

-- ---- milestone ----
create table milestone (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenant(id) on delete cascade,
  project_id uuid not null references project(id) on delete cascade,
  name       text not null,
  due_date   date,
  status     milestone_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_milestone_project on milestone(project_id);
create trigger trg_milestone_updated before update on milestone
  for each row execute function set_updated_at();

-- ---- 補上延後的 FK ----
alter table task    add constraint fk_task_project
  foreign key (project_id) references project(id) on delete set null;
alter table meeting add constraint fk_meeting_project
  foreign key (project_id) references project(id) on delete set null;
