-- =====================================================================
-- 0003_m2_meetings.sql — M2 會議管理
-- 決議事項（action item）可一鍵轉 M1 任務,雙向可追。
-- =====================================================================

create type action_item_status as enum ('open', 'converted', 'done');

-- ---- meeting ----
create table meeting (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id) on delete cascade,
  project_id   uuid,                                 -- FK 於 0004 加上（選填）
  title        text not null,
  meeting_date timestamptz not null,
  location     text,
  agenda       text,
  notes        text,                                 -- 會議紀錄
  created_by   uuid not null references app_user(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_meeting_tenant  on meeting(tenant_id);
create index idx_meeting_project on meeting(project_id);
create trigger trg_meeting_updated before update on meeting
  for each row execute function set_updated_at();

-- ---- meeting_attendee ----
create table meeting_attendee (
  meeting_id uuid not null references meeting(id) on delete cascade,
  user_id    uuid not null references app_user(id) on delete cascade,
  primary key (meeting_id, user_id)
);

-- ---- meeting_action_item（決議事項） ----
create table meeting_action_item (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant(id) on delete cascade,
  meeting_id     uuid not null references meeting(id) on delete cascade,
  content        text not null,
  owner_id       uuid references app_user(id),
  due_date       date,
  status         action_item_status not null default 'open',
  linked_task_id uuid references task(id) on delete set null,  -- 一鍵轉任務後回填
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_action_item_meeting on meeting_action_item(meeting_id);
create trigger trg_action_item_updated before update on meeting_action_item
  for each row execute function set_updated_at();
