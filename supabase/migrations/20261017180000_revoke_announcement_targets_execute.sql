-- 2026-10-17 部署檢查：觸發器函式 eip_notify_announcement_targets 不應開放 anon／authenticated 從 API 呼叫
-- （與 eip_notify_announcement_published 一致，只留 postgres／service_role）。已於正式庫套用。
revoke all on function public.eip_notify_announcement_targets() from public, anon, authenticated;
grant execute on function public.eip_notify_announcement_targets() to service_role;
