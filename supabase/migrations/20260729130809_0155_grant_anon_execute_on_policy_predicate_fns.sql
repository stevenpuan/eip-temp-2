-- ============================================================
-- 0154 的延伸：政策判定函式整族都要開給 anon，否則未登入請求仍會 42501
--
-- 0154 只開了 current_tenant_id / current_role_name，重測後發現同一個病還有 9 支：
--   anon 讀 task              → permission denied for function eip_can_manage_task
--   anon 讀 announcement      → permission denied for function eip_can_see_announcement
--   anon 讀 personal_event    → permission denied for function eip_owns_personal_event
--   ...
-- 原因一樣：85 條政策是 TO public（含 anon），政策運算式以查詢者身分執行，
-- anon 沒有 EXECUTE 就在「判斷之前」先炸。
--
-- 已逐支實測：auth.uid() 為 null 時這 9 支全部回 false（不是 null、不是 true），
-- 所以開給 anon 之後每一條政策都成立不了 → 一律 0 列，寫入一律被拒。
-- 實際可及範圍沒有增加，資訊洩漏為零。
--
-- 這一族都是「政策判定器」，不是業務 RPC。每一支都只看 auth.uid()，
-- 不接受「代表別人查」的參數語意（p_task_id 之類只是要判斷哪一筆）。
--
-- 常設檢查的口徑因此要改：
--   舊：「anon 可呼叫函式 = 0」
--   新：「anon 可呼叫函式 = 11，且全部是政策判定器／身分讀取器，
--        未登入一律回 false/NULL」——業務 RPC 仍必須是 0。
-- 記在這裡免得下一輪看到 11 當成漏洞收回去，把這個 bug 帶回來。
-- ============================================================

grant execute on function public.eip_can_manage_task(uuid)       to anon;
grant execute on function public.eip_can_see_task(uuid)          to anon;
grant execute on function public.eip_is_task_collaborator(uuid)   to anon;
grant execute on function public.eip_can_see_announcement(uuid)   to anon;
grant execute on function public.eip_can_see_meeting(uuid)        to anon;
grant execute on function public.eip_can_see_project(uuid)        to anon;
grant execute on function public.eip_can_view_dept_record(uuid)   to anon;
grant execute on function public.eip_user_can_scope_dept(uuid)    to anon;
grant execute on function public.eip_owns_personal_event(uuid)    to anon;;
