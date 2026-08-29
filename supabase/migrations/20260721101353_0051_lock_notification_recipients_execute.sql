-- 收回預設的 public/anon EXECUTE，僅保留 authenticated 與 service_role
revoke execute on function public.eip_notification_recipients(text, uuid, uuid, uuid) from public;
revoke execute on function public.eip_notification_recipients(text, uuid, uuid, uuid) from anon;
grant execute on function public.eip_notification_recipients(text, uuid, uuid, uuid) to authenticated, service_role;;
