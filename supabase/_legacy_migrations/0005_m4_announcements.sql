-- =====================================================================
-- 0005_m4_announcements.sql — M4 公告系統（支柱③）
-- 對象範圍（全公司/部門/個人）+ 已讀掌握（記誰看了,不做強制回條）。
-- =====================================================================

create type announcement_audience as enum ('all', 'department', 'users');

-- ---- announcement ----
create table announcement (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  title         text not null,
  body          text not null,
  audience_type announcement_audience not null default 'all',
  is_pinned     boolean not null default false,      -- 置頂
  published_at  timestamptz,                          -- null = 草稿
  created_by    uuid not null references app_user(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_announcement_tenant on announcement(tenant_id);
create trigger trg_announcement_updated before update on announcement
  for each row execute function set_updated_at();

-- ---- announcement_target（audience_type = department|users 時的對象明細） ----
create table announcement_target (
  id              uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references announcement(id) on delete cascade,
  department_id   uuid references department(id) on delete cascade,
  user_id         uuid references app_user(id) on delete cascade,
  check (department_id is not null or user_id is not null)
);
create index idx_ann_target_ann on announcement_target(announcement_id);

-- ---- announcement_read（已讀紀錄） ----
create table announcement_read (
  announcement_id uuid not null references announcement(id) on delete cascade,
  user_id         uuid not null references app_user(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (announcement_id, user_id)
);
