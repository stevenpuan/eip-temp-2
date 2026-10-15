-- 2026-10-15 安全性與效能強化（已套用至 Supabase，version 20261015153430）
-- 注意：RLS 政策引用的權限判斷函式（eip_can_*、eip_has_perm、current_tenant_id 等）
--       刻意保留 anon EXECUTE，避免未登入查詢從「回傳空」變成「報錯」。
--       參見 restore_anon_execute_on_rls_predicate_functions。

-- 1. 固定 search_path
alter function public.eip_rule_due_on(r public.recurring_rule, d date) set search_path = public;
alter function public.eip_run_recurring(p_date date) set search_path = public;
alter function public.trg_action_item_auto_convert_task() set search_path = public;

-- 2. 觸發器函式不應經由 RPC 對外暴露（觸發器觸發時不檢查 EXECUTE，不影響運作）
revoke execute on function public.eip_notify_task_update_comment() from public, anon, authenticated;
revoke execute on function public.eip_sync_recurring_counterparts() from public, anon, authenticated;
revoke execute on function public.eip_sync_task_to_worklog() from public, anon, authenticated;
revoke execute on function public.trg_action_item_auto_convert_task() from public, anon, authenticated;

-- 3. 補外鍵索引（28 個）
create index if not exists idx_eip_anomaly_attachment_uploaded_by on public.eip_anomaly_attachment (uploaded_by);
create index if not exists idx_announcement_deleted_by on public.announcement (deleted_by);
create index if not exists idx_app_user_deputy_id on public.app_user (deputy_id);
create index if not exists idx_eip_anomaly_closed_by on public.eip_anomaly (closed_by);
create index if not exists idx_eip_anomaly_confirmed_by on public.eip_anomaly (confirmed_by);
create index if not exists idx_eip_anomaly_deleted_by on public.eip_anomaly (deleted_by);
create index if not exists idx_eip_anomaly_filled_by on public.eip_anomaly (filled_by);
create index if not exists idx_eip_anomaly_raised_by on public.eip_anomaly (raised_by);
create index if not exists idx_eip_dept_supervisor_created_by on public.eip_dept_supervisor (created_by);
create index if not exists idx_eip_dept_supervisor_user_id on public.eip_dept_supervisor (user_id);
create index if not exists idx_eip_document_deleted_by on public.eip_document (deleted_by);
create index if not exists idx_eip_feature_request_deleted_by on public.eip_feature_request (deleted_by);
create index if not exists idx_eip_handover_item_resolved_by on public.eip_handover_item (resolved_by);
create index if not exists idx_eip_leave_handover_item_done_by on public.eip_leave_handover_item (done_by);
create index if not exists idx_eip_link_created_by on public.eip_link (created_by);
create index if not exists idx_eip_quick_report_deleted_by on public.eip_quick_report (deleted_by);
create index if not exists idx_eip_quick_report_deputy_id on public.eip_quick_report (deputy_id);
create index if not exists idx_eip_quick_report_done_by on public.eip_quick_report (done_by);
create index if not exists idx_personal_event_deleted_by on public.personal_event (deleted_by);
create index if not exists idx_personal_routine_deleted_by on public.personal_routine (deleted_by);
create index if not exists idx_recurring_rule_counterpart_user_id on public.recurring_rule (counterpart_user_id);
create index if not exists idx_task_deleted_by on public.task (deleted_by);
create index if not exists idx_task_change_log_changed_by on public.task_change_log (changed_by);
create index if not exists idx_task_checklist_created_by on public.task_checklist (created_by);
create index if not exists idx_task_checklist_done_by on public.task_checklist (done_by);
create index if not exists idx_work_log_deleted_by on public.work_log (deleted_by);
create index if not exists idx_work_log_locked_by on public.work_log (locked_by);
create index if not exists idx_work_log_review_reviewer_id on public.work_log_review (reviewer_id);
