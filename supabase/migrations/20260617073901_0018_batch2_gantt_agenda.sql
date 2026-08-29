-- =====================================================================
-- 0018 P2 第二批:甘特/行事曆需要的起始日、結構化議程、里程碑進度
-- =====================================================================

-- 1) 任務開始日(甘特/行事曆的起訖;due_date 已有)
alter table task add column start_date date;

-- 2) 里程碑進度
alter table milestone add column progress int not null default 0 check (progress between 0 and 100);

-- 3) 結構化議程項目
create table meeting_agenda_item (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id) on delete cascade,
  meeting_id   uuid not null references meeting(id) on delete cascade,
  title        text not null,
  duration_min int,                       -- 預計分鐘
  owner_id     uuid references app_user(id),
  notes        text,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
create index idx_agenda_meeting on meeting_agenda_item(meeting_id);
alter table meeting_agenda_item enable row level security;

create policy agenda_read on meeting_agenda_item
  for select using (tenant_id = current_tenant_id());
create policy agenda_write on meeting_agenda_item
  for all using (
    tenant_id = current_tenant_id() and (
      current_role_name() in ('company_admin','dept_manager')
      or exists (select 1 from meeting m where m.id = meeting_id and m.created_by = auth.uid())
    )
  )
  with check (tenant_id = current_tenant_id());;
