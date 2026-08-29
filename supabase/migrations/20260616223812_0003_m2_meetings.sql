create type action_item_status as enum ('open', 'converted', 'done');

create table meeting (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id) on delete cascade,
  project_id   uuid,
  title        text not null,
  meeting_date timestamptz not null,
  location     text,
  agenda       text,
  notes        text,
  created_by   uuid not null references app_user(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_meeting_tenant  on meeting(tenant_id);
create index idx_meeting_project on meeting(project_id);
create trigger trg_meeting_updated before update on meeting
  for each row execute function set_updated_at();

create table meeting_attendee (
  meeting_id uuid not null references meeting(id) on delete cascade,
  user_id    uuid not null references app_user(id) on delete cascade,
  primary key (meeting_id, user_id)
);

create table meeting_action_item (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant(id) on delete cascade,
  meeting_id     uuid not null references meeting(id) on delete cascade,
  content        text not null,
  owner_id       uuid references app_user(id),
  due_date       date,
  status         action_item_status not null default 'open',
  linked_task_id uuid references task(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_action_item_meeting on meeting_action_item(meeting_id);
create trigger trg_action_item_updated before update on meeting_action_item
  for each row execute function set_updated_at();;
