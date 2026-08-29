-- 每日排程跑週期引擎(00:00 UTC = 08:00 台灣時間)
create extension if not exists pg_cron;

select cron.schedule('eip-recurring-daily', '0 0 * * *', $$select eip_run_recurring()$$);;
