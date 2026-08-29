-- 排程失敗告警需要一個獨立的通知型別，才不會借用語意不符的既有型別（例如「逾期」）。
-- ALTER TYPE ADD VALUE 必須自成一支 migration：新值在同一個交易內還不能使用。
alter type public.notification_type add value if not exists 'system_alert';
;
