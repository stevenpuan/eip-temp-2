-- =====================================================================
-- 0049: 安全收斂 — 收掉「純 trigger 函式」對 anon/authenticated 的 REST EXECUTE。
-- 這些函式皆綁定在 trigger 上自動觸發；trigger 執行不檢查 EXECUTE 權限，
-- 故 revoke 後完全不影響運作，只是關掉 /rest/v1/rpc 的攻擊面（修 advisor 0028/0029）。
-- 不動 RLS 政策 helper（current_tenant_id / eip_can_see_* / eip_user_can_scope_dept…）
-- 與前端 .rpc() 函式（eip_create_employee / eip_admin_* / eip_set_user_roles…）。
-- 冪等可重跑。
-- =====================================================================
revoke execute on function
  public.eip_fill_announcement_defaults(),
  public.eip_fill_attachment_defaults(),
  public.eip_fill_comment_defaults(),
  public.eip_fill_document_defaults(),
  public.eip_fill_docver_defaults(),
  public.eip_fill_task_update_defaults(),
  public.eip_set_feature_request_defaults(),
  public.eip_set_personal_event_defaults(),
  public.eip_set_quick_report_defaults(),
  public.eip_qr_set_department(),
  public.eip_notify_quick_report(),
  public.notify_line_on_notification(),
  public.sync_app_user_role(),
  public.sync_profile_to_app_user(),
  public.prevent_app_user_self_escalation(),
  public.set_updated_at(),
  public.handle_new_user()
from anon, authenticated;;
