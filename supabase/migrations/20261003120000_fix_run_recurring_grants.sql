-- 修正（2026-10-03，純 bug）：
-- 1) 常態工作頁「立即產生/檢查」按鈕呼叫 rpc("eip_run_recurring", {})，PostgREST 會對到
--    無參數版 eip_run_recurring()；但 20260919 的 migration 把它從 authenticated 收回、
--    同時帶參數版又失去 DEFAULT → 按鈕一律 403「permission denied」（log 2026-10-03 13:11 實際發生）。
--    → 把無參數版的 EXECUTE 給 authenticated。角色閘門在帶參數版內（auth.uid() 會帶進去），
--      一般成員仍會被擋「權限不足」，已實測。
-- 2) 帶參數版 eip_run_recurring(date) 原本 anon（未登入）可執行；未登入時 auth.uid() 為 null
--    會被當成排程、跑全公司，且可指定任意日期。→ 收回 public / anon。
--    排程走 eip_cron_guarded（postgres 身分），不受影響。
-- 註：正式庫以 execute_sql 套用（apply_migration 逾時），內容相同。
grant execute on function public.eip_run_recurring() to authenticated;
revoke execute on function public.eip_run_recurring(date) from public, anon;
