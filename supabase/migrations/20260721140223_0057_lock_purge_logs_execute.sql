-- eip_purge_old_logs 無內部授權檢查，收回一般使用者執行權（僅保留 cron/postgres 與 service_role）
revoke execute on function public.eip_purge_old_logs(integer) from public;
revoke execute on function public.eip_purge_old_logs(integer) from anon;
revoke execute on function public.eip_purge_old_logs(integer) from authenticated;
grant execute on function public.eip_purge_old_logs(integer) to service_role;;
