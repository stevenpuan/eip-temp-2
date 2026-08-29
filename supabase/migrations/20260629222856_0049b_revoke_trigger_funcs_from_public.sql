-- 0049b: 補收 PUBLIC（前一版只收 anon/authenticated，但這些函式的 EXECUTE
-- 是經由 PUBLIC 授予，需從 PUBLIC 收才生效）。trigger 觸發不需 EXECUTE，安全。冪等。
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
from public;;
