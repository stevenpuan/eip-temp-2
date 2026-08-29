-- =====================================================================
-- 0006_shared.sql — 共用:附件 / 留言 / 通知（各模組共享）
-- 多型表用 entity_type + entity_id 掛到任務/會議/專案/公告。
-- =====================================================================

create type attachment_entity   as enum ('task', 'meeting', 'project', 'announcement');
create type comment_entity      as enum ('task', 'meeting', 'project');
create type notification_type   as enum (
  'assigned', 'status_changed', 'mentioned', 'due_soon',
  'overdue', 'review_needed', 'announcement'
);
create type notification_entity as enum ('task', 'meeting', 'project', 'announcement');

-- ---- attachment（Supabase Storage） ----
create table attachment (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  entity_type attachment_entity not null,
  entity_id   uuid not null,
  file_url    text not null,
  file_name   text not null,
  uploaded_by uuid not null references app_user(id),
  created_at  timestamptz not null default now()
);
create index idx_attachment_entity on attachment(entity_type, entity_id);

-- ---- comment ----
create table comment (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  entity_type comment_entity not null,
  entity_id   uuid not null,
  user_id     uuid not null references app_user(id),
  body        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_comment_entity on comment(entity_type, entity_id);
create trigger trg_comment_updated before update on comment
  for each row execute function set_updated_at();

-- ---- notification（站內通知 + LINE 推播事件來源） ----
create table notification (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  user_id     uuid not null references app_user(id) on delete cascade,  -- 收件者
  type        notification_type not null,
  entity_type notification_entity not null,
  entity_id   uuid not null,
  message     text not null,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index idx_notification_user on notification(user_id, is_read);
