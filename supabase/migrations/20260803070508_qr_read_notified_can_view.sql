-- 臨時回報可見性擴充：讓「有收到該筆通知的人」也能在臨時回報清單看到那筆
-- （被通知＝可見）。與既有 owner/admin/主管/代理人/交接指派 條件併存（OR）。
-- notification 的 SELECT 政策僅 user_id=auth.uid()，不參照本表，無遞迴。
alter policy qr_read on public.eip_quick_report
using (
  (tenant_id = current_tenant_id())
  and (deleted_at is null)
  and (
    (submitter_id = (select auth.uid()))
    or (current_role_name() = 'company_admin'::user_role)
    or ((current_role_name() = 'dept_manager'::user_role) and (department_id is not null) and eip_user_can_scope_dept(department_id))
    or (deputy_id = (select auth.uid()))
    or exists (
      select 1 from public.eip_leave_handover_item i
      where i.quick_report_id = eip_quick_report.id and i.assignee_id = (select auth.uid())
    )
    or exists (
      select 1 from public.notification n
      where n.entity_id = eip_quick_report.id and n.user_id = (select auth.uid())
    )
  )
);;
