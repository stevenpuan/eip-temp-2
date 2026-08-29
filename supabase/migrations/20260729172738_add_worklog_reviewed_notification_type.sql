-- 主管審核完工作日誌要通知員工，需要獨立型別（不借用語意不符的 review_needed）。
-- ALTER TYPE ADD VALUE 必須自成一支 migration。
alter type public.notification_type add value if not exists 'worklog_reviewed';
;
