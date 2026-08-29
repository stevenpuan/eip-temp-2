-- 收緊本輪新增的 SECURITY DEFINER 函式權限（與既有安全慣例一致）
-- 觸發器函式：無直接呼叫者，全部收回
revoke execute on function public.eip_audit() from public, anon, authenticated;
revoke execute on function public.eip_notify_task_assigned() from public, anon, authenticated;
revoke execute on function public.eip_notify_task_status() from public, anon, authenticated;

-- RLS 用的輔助函式：保留 authenticated（RLS 評估需要），收回 anon/public
revoke execute on function public.eip_is_dept_supervisor(uuid) from public, anon;
grant execute on function public.eip_is_dept_supervisor(uuid) to authenticated;

-- 僅由觸發器/cron（以 owner 身分）呼叫的內部函式：只留 service_role
revoke execute on function public.eip_emit_notification(text,uuid,uuid,uuid,notification_entity,uuid,notification_type,text) from public, anon, authenticated;
grant execute on function public.eip_emit_notification(text,uuid,uuid,uuid,notification_entity,uuid,notification_type,text) to service_role;

revoke execute on function public.eip_notification_recipients(text,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.eip_notification_recipients(text,uuid,uuid,uuid) to service_role;

revoke execute on function public.eip_send_line_digests() from public, anon, authenticated;
grant execute on function public.eip_send_line_digests() to service_role;;
