-- 每日清理舊 log：error_logs / activity_logs / audit_logs，保留 p_days 天（預設 90）。
-- 不動 changelogs（開發歷程/版本紀錄，非 log）。每天 23:00 台灣時間 = 15:00 UTC 由 pg_cron 執行。
create or replace function public.eip_purge_old_logs(p_days int default 90)
returns text language plpgsql security definer set search_path = public as $$
declare d1 int; d2 int; d3 int;
begin
  delete from public.error_logs    where created_at < now() - make_interval(days => p_days);
  get diagnostics d1 = row_count;
  delete from public.activity_logs where created_at < now() - make_interval(days => p_days);
  get diagnostics d2 = row_count;
  delete from public.audit_logs    where created_at < now() - make_interval(days => p_days);
  get diagnostics d3 = row_count;
  return format('purged error_logs=%s activity_logs=%s audit_logs=%s (keep %s days)', d1, d2, d3, p_days);
end $$;

revoke execute on function public.eip_purge_old_logs(int) from public, anon;

-- 註冊/更新排程（同名會 upsert）。15:00 UTC = 23:00 Asia/Taipei。
select cron.schedule('eip-log-purge-daily', '0 15 * * *', $$select public.eip_purge_old_logs(90)$$);;
