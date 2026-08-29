-- 0100 移除 eip_notify_user 的舊 5 參數版本
-- 與 0098 同一類問題：0099 新增了帶 p_priority 的 6 參數版但沒移除舊版，
-- eip_build_handover 以 5 個參數呼叫會精確匹配到舊版，
-- 那個版本 line_pending 寫死 false，交接待辦產生時的通知仍然不會進 LINE。

drop function if exists public.eip_notify_user(
  uuid, notification_type, notification_entity, uuid, text);
;
