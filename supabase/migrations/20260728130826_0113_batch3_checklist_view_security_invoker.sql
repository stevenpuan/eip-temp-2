-- 0113 修正 0112 的漏洞：view 預設以「建立者權限」執行，會繞過 task_checklist 的 RLS，
-- 讓任何 authenticated 使用者讀到全公司所有任務的子項統計。
-- PG15+ 用 security_invoker 讓 view 以呼叫者身分執行，RLS 照常生效。
alter view public.task_checklist_summary set (security_invoker = true);;
