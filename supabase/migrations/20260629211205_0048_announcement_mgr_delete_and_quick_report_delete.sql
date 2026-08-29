-- =====================================================================
-- 0048: 放寬兩個「過嚴」的寫入政策（CRUD 稽核 2026-06-30 發現 A/B）
--   A. 公告：部門主管可刪除自己發佈的公告（比照既有 manager_update）
--   B. 臨時回報：admin 可刪；submitter 在未處理(status='open')時可改/撤回
-- 冪等可重跑。
-- =====================================================================

-- A. announcement: 主管刪除自己的公告
drop policy if exists announcement_manager_delete on public.announcement;
create policy announcement_manager_delete on public.announcement
  for delete using (
    tenant_id = current_tenant_id()
    and current_role_name() = 'dept_manager'
    and created_by = auth.uid()
  );

-- B-1. eip_quick_report: 刪除（admin 任意；submitter 限 open）
drop policy if exists qr_delete on public.eip_quick_report;
create policy qr_delete on public.eip_quick_report
  for delete using (
    tenant_id = current_tenant_id()
    and (
      current_role_name() = 'company_admin'
      or (submitter_id = auth.uid() and status = 'open')
    )
  );

-- B-2. eip_quick_report: submitter 在 open 時可改自己的（與既有 qr_update 並存，OR 關係）
drop policy if exists qr_update_own on public.eip_quick_report;
create policy qr_update_own on public.eip_quick_report
  for update using (
    tenant_id = current_tenant_id()
    and submitter_id = auth.uid()
    and status = 'open'
  ) with check (
    tenant_id = current_tenant_id()
    and submitter_id = auth.uid()
  );;
