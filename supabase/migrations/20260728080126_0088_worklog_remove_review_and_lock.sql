-- 0088 簽核歸零：工作日誌不再有主管批示與鎖定
-- 依 2026-07-28 訪談定案：全系統唯一保留的主管簽核動作＝異常缺失「確認並追蹤改善」。
-- 使用者選擇「連資料一起清」，但先備份到 archive 表，保留還原可能。

-- ① 批示紀錄備份後清空
create table if not exists public.work_log_review_archive (
  id uuid primary key,
  tenant_id uuid,
  work_log_id uuid,
  reviewer_id uuid,
  reviewer_role text,
  comment text,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz not null default now(),
  archived_reason text not null default '0088 簽核歸零'
);
alter table public.work_log_review_archive enable row level security;
drop policy if exists wlra_admin_read on public.work_log_review_archive;
create policy wlra_admin_read on public.work_log_review_archive
  for select using (current_role_name() = 'company_admin'::user_role);

insert into public.work_log_review_archive
  (id, tenant_id, work_log_id, reviewer_id, reviewer_role, comment, created_at, updated_at)
select r.id, r.tenant_id, r.work_log_id, r.reviewer_id, r.reviewer_role, r.comment, r.created_at, r.updated_at
from public.work_log_review r
where not exists (select 1 from public.work_log_review_archive a where a.id = r.id);

delete from public.work_log_review;

-- ② 鎖定狀態備份後解除
create table if not exists public.work_log_lock_archive (
  work_log_id uuid primary key,
  locked_by uuid,
  locked_at timestamptz,
  archived_at timestamptz not null default now()
);
alter table public.work_log_lock_archive enable row level security;
drop policy if exists wlla_admin_read on public.work_log_lock_archive;
create policy wlla_admin_read on public.work_log_lock_archive
  for select using (current_role_name() = 'company_admin'::user_role);

insert into public.work_log_lock_archive (work_log_id, locked_by, locked_at)
select w.id, w.locked_by, w.locked_at
from public.work_log w
where w.locked
  and not exists (select 1 from public.work_log_lock_archive a where a.work_log_id = w.id);

update public.work_log
   set locked = false, locked_by = null, locked_at = null
 where locked or locked_by is not null or locked_at is not null;

-- ③ 停止產生「待批示」通知：移除 work_log 送出時的通知 trigger
drop trigger if exists trg_worklog_submitted on public.work_log;

-- ④ 清掉既有的待批示通知（僅 work_log 這一類，其他類型不受影響）
delete from public.notification
 where type = 'review_needed'::public.notification_type
   and entity_type = 'work_log'::public.notification_entity;

-- ⑤ work_log.status 不再會有 'reviewed'（現況本來就沒有），保守起見歸回 submitted
update public.work_log set status = 'submitted' where status = 'reviewed';

comment on table public.work_log_review is
  '2026-07-28 起停用（簽核歸零）。資料已移至 work_log_review_archive。保留空表以免相依物件失效。';
comment on column public.work_log.locked is
  '2026-07-28 起停用（簽核歸零），一律 false。歷史鎖定狀態見 work_log_lock_archive。';
;
