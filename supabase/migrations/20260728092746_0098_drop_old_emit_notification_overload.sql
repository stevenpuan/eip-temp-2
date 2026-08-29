-- 0098 移除 eip_emit_notification 的舊 8 參數版本
-- 0097 新增了帶 p_priority 的 9 參數版，但舊版沒被移除，
-- 導致以 8 個參數呼叫的 4 個 trigger 函式（quick_report、worklog、leave_handover、run_recurring）
-- 會精確匹配到舊版，完全跳過新的優先級分流與 priority 欄位寫入。
-- 移除舊版後，8 參數呼叫會透過預設值落到新版，行為統一。

drop function if exists public.eip_emit_notification(
  text, uuid, uuid, uuid, notification_entity, uuid, notification_type, text);
;
