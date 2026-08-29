-- 0091 LINE 推播改為上班時間每 30 分鐘彙整
-- 原本 '10 0 * * *'（台北 08:10）一天只推一次，導致下午的通知要隔天早上才送出，
-- 使用者實際感受等同「沒收到通知」。
-- 改為 UTC '*/30 0-11 * * *' = 台北 08:00～19:30 每半小時一次。
-- 仍是「彙整」而非逐筆：同一人多筆通知合成一則，避免轟炸（維持 0055 的原始意圖）。
-- 下班時間（台北 19:30～隔日 08:00）不打擾，累積的通知在隔天第一次 tick 一併送出。

select cron.alter_job(
  job_id  => (select jobid from cron.job where jobname = 'line_daily_digest'),
  schedule => '*/30 0-11 * * *'
);

comment on function public.eip_send_line_digests() is
  '把 line_pending 的通知依人彙整成一則 LINE 推播。由 cron 於台北 08:00～19:30 每 30 分鐘執行一次（0091）。';
;
