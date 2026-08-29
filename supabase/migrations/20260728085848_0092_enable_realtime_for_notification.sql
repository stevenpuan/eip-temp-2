-- 0092 開啟 notification 表的 Realtime
-- 症狀：同仁開著系統時，通知中心的鈴鐺不會自己跳紅點，要重新整理或切換頁面才看到新通知。
-- 根因：前端 NotificationBell 有訂閱 postgres_changes（filter user_id=eq.<自己>），
--       但 supabase_realtime publication 裡「一張表都沒有」，
--       所以 Supabase Realtime 從來不會把 notification 的變更廣播出去，訂閱等同無效。
-- 影響：使用者主觀感受＝「沒收到通知」，即使資料庫其實已經寫入通知。

alter table public.notification replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_rel pr
    join pg_publication p on p.oid = pr.prpubid
    join pg_class c on c.oid = pr.prrelid
    where p.pubname = 'supabase_realtime' and c.relname = 'notification'
  ) then
    execute 'alter publication supabase_realtime add table public.notification';
  end if;
end $$;

-- RLS 已有 notification_read（user_id = auth.uid()），Realtime 會沿用同一條政策，
-- 因此每個人只會收到自己的通知事件，不需額外處理。
;
