-- 0106 第二輪獨立審查的阻擋項修正
--
-- 背景：第二輪審查發現 0103「收攏成單一入口」漏掉了一整類路徑——
-- 我只檢查了「哪些函式 INSERT INTO notification」，
-- 完全沒檢查「notification 表上有沒有 trigger」。
-- 結果 trg_notify_line 這個 AFTER INSERT trigger 一直活著並直接呼叫 net.http_post，
-- 今天所有的 LINE 推播其實都是它發的（新程式碼一筆都沒真正跑過）。

/* ---------- H-A：移除繞過單一入口的舊 LINE 推播 trigger ---------- */
-- 它不看 notification_setting.line_enabled、不看 priority、不記 request_id，
-- 且把錯誤吞掉。造成：每次任務指派推 2 則 LINE、
-- 事件層 LINE 開關（recurring_due_soon / recurring_overdue 皆為 false）形同虛設。
drop trigger if exists trg_notify_line on public.notification;
drop function if exists public.notify_line_on_notification();

/* ---------- H-E：使用者只能改自己通知的已讀狀態 ---------- */
-- 原本 authenticated 有 notification 全欄位的 UPDATE grant，
-- RLS 只限制「哪些列」不限制「哪些欄」→ 任何員工可以把自己的通知
-- 改成 line_pending=true、line_attempts=0、message='任意內容'，
-- 讓系統每 30 分鐘重推一次 LINE 給自己。
-- 因為 LINE 額度是全公司共用，一個人可以燒光全公司整月額度。
revoke update on public.notification from authenticated;
revoke update, insert on public.notification from anon;
grant update (is_read) on public.notification to authenticated;

/* ---------- M-6：移除 0105 多餘的索引 ---------- */
-- ux_notif_setting_default 與 ux_notif_setting_dept 兩個 partial unique index
-- 在 0105 之前就已存在且完整覆蓋。當初的診斷是錯的。
drop index if exists public.uq_notification_setting_scope;

/* ---------- M-8：交接掃描不該讓一般使用者能執行 ---------- */
-- 它是 SECURITY DEFINER 且函式內沒有權限檢查，
-- 任何登入員工可以反覆呼叫觸發 urgent 推播、變更交接狀態、灌 miss 紀錄。
revoke execute on function public.eip_sweep_handover() from authenticated, anon;

/* ---------- H-B / H-C：送達確認要看 LINE 的真實回應 ---------- */
-- line-push Edge Function 一律回 HTTP 200（LINE 回 429/500 也一樣），
-- 所以「status_code between 200 and 299」是完全的假訊號。
-- 實測：83 筆 status_code=200 裡，LINE 真的 200 的只有 10 筆，
-- 69 筆是 429（月額度用盡）、4 筆是 500。
-- 改成同時驗證回應內容裡的 line_status。
-- 429（額度用盡）特別處理：不消耗重試次數，因為重試也不會成功。
create or replace function public.eip_confirm_line_delivery()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_ok int := 0;
begin
  -- 真正送達：Edge Function 2xx 且 LINE 也回 2xx
  with done as (
    update public.notification n
       set line_pending = false, line_sent_at = now(), line_error = null,
           line_request_id = null
      from net._http_response r
     where r.id = n.line_request_id and n.line_pending
       and r.status_code between 200 and 299
       and coalesce((r.content::jsonb->>'line_status')::int, 0) between 200 and 299
    returning 1)
  select count(*) into v_ok from done;

  -- LINE 429 月額度用盡：重試無意義，保留在佇列但不消耗次數，並標明原因
  update public.notification n
     set line_request_id = null,
         line_error = 'LINE 月推播額度已用盡（429），等額度重置或升級方案後會自動重送'
    from net._http_response r
   where r.id = n.line_request_id and n.line_pending
     and coalesce((r.content::jsonb->>'line_status')::int, 0) = 429;

  -- 其他失敗且還有重試額度
  update public.notification n
     set line_request_id = null,
         line_error = left(coalesce(
           'LINE ' || (r.content::jsonb->>'line_status'),
           r.error_msg,
           'HTTP ' || r.status_code::text), 200)
    from net._http_response r
   where r.id = n.line_request_id and n.line_pending
     and coalesce((r.content::jsonb->>'line_status')::int, 0) <> 429
     and (r.status_code is null or r.status_code >= 300
          or coalesce((r.content::jsonb->>'line_status')::int, 0) >= 300)
     and n.line_attempts < 3;

  -- 重試耗盡
  update public.notification n
     set line_pending = false,
         line_error = left(coalesce(
           'LINE ' || (r.content::jsonb->>'line_status'),
           r.error_msg,
           'HTTP ' || r.status_code::text), 180) || '（已重試 3 次）'
    from net._http_response r
   where r.id = n.line_request_id and n.line_pending
     and coalesce((r.content::jsonb->>'line_status')::int, 0) <> 429
     and (r.status_code is null or r.status_code >= 300
          or coalesce((r.content::jsonb->>'line_status')::int, 0) >= 300)
     and n.line_attempts >= 3;

  -- H-D：net._http_response 是 UNLOGGED 表，重啟或 crash recovery 會被清空。
  -- 回應遺失的通知會永遠卡在 line_pending=true 且 request_id 指向不存在的列，
  -- 兩個排程都碰不到它。15 分鐘沒有對應回應就重新排入。
  update public.notification n
     set line_request_id = null,
         line_error = coalesce(n.line_error || '；', '') || '推播回應遺失，重新排入'
   where n.line_pending and n.line_request_id is not null
     and n.line_attempts < 3
     and n.created_at < now() - interval '15 minutes'
     and not exists (select 1 from net._http_response r where r.id = n.line_request_id);

  update public.notification n
     set line_pending = false,
         line_error = coalesce(n.line_error || '；', '') || '推播回應遺失且重試耗盡'
   where n.line_pending and n.line_request_id is not null
     and n.line_attempts >= 3
     and n.created_at < now() - interval '15 minutes'
     and not exists (select 1 from net._http_response r where r.id = n.line_request_id);

  return v_ok;
end;
$function$;

revoke all on function public.eip_confirm_line_delivery() from public, anon, authenticated;
;
