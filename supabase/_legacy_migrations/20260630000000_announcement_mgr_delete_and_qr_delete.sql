-- =====================================================================
-- 放入 client repo：eip-base-standards-09bc2746/supabase/migrations/
-- 檔名：20260630000000_announcement_mgr_delete_and_qr_delete.sql
-- （時間戳命名，排在現有 20260627… 之後，不破壞全新 clone 排序）
--
-- 內容＝已套用到正式庫的 live migration 0048（CRUD 稽核 2026-06-30 發現 A/B）。
--   A. 公告：部門主管可刪除自己發佈的公告。
--   B. 臨時回報：admin 可刪；submitter 在 status='open'（未處理）可改/撤回自己的。
-- 冪等可重跑；正式庫已套用，此檔僅作版控紀錄。
-- =====================================================================

-- A. announcement：主管刪除自己的公告
drop policy if exists announcement_manager_delete on public.announcement;
create policy announcement_manager_delete on public.announcement
  for delete using (
    tenant_id = current_tenant_id()
    and current_role_name() = 'dept_manager'
    and created_by = auth.uid()
  );

-- B-1. eip_quick_report：刪除（admin 任意；submitter 限 open）
drop policy if exists qr_delete on public.eip_quick_report;
create policy qr_delete on public.eip_quick_report
  for delete using (
    tenant_id = current_tenant_id()
    and (
      current_role_name() = 'company_admin'
      or (submitter_id = auth.uid() and status = 'open')
    )
  );

-- B-2. eip_quick_report：submitter 在 open 時可改自己的
drop policy if exists qr_update_own on public.eip_quick_report;
create policy qr_update_own on public.eip_quick_report
  for update using (
    tenant_id = current_tenant_id()
    and submitter_id = auth.uid()
    and status = 'open'
  ) with check (
    tenant_id = current_tenant_id()
    and submitter_id = auth.uid()
  );
