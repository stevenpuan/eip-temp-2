-- ============================================================
-- 未登入／token 過期的請求會炸成「permission denied for function current_tenant_id」
--
-- 現象（正式庫日誌，台北 20:14–21:02 共 25 次，已重現）：
--   anon 讀 task         → 42501 permission denied for function current_tenant_id
--   anon 讀 work_log     → 0 列（乾淨）
--   anon 讀 notification → 42501 permission denied for table notification
-- 三種表三種行為。使用者看到的是紅色錯誤，而不是「請重新登入」。
--
-- 原因：85 條政策是 TO public（含 anon），政策內部呼叫 current_tenant_id()，
-- 但前幾輪為了「anon 可呼叫函式 = 0」把它從 anon 收回了。
-- 政策運算式是以查詢者身分執行的，所以 anon 連判斷都做不到就先 42501。
--
-- 修法：把這兩支「身分讀取器」開回給 anon。
--   current_tenant_id()  → select tenant_id from app_user where id = auth.uid()
--   current_role_name()  → 同樣只看 auth.uid()
-- anon 的 auth.uid() 是 null，兩支都回 NULL，於是每一條 tenant 比對都成立不了
-- → 一律 0 列，寫入一律被拒。實際可及範圍沒有增加，資訊洩漏為零，
--   但錯誤變成安靜的空結果，前端就能正常顯示「請重新登入」而不是紅色例外。
--
-- 這會讓我每輪報的「anon 可呼叫函式 = 0」變成 2。這兩支是身分讀取器、
-- 對 anon 回 NULL，跟「anon 不得呼叫業務邏輯」的初衷不衝突，故意記在這裡，
-- 免得下一輪有人看到 2 就當成漏洞又收回去、把這個 bug 帶回來。
-- ============================================================

grant execute on function public.current_tenant_id() to anon;
grant execute on function public.current_role_name() to anon;

comment on function public.current_tenant_id() is
  '回呼叫者自己的 tenant_id；未登入回 NULL。刻意開放給 anon（0154）：政策 TO public 會呼叫它，收回會讓未登入請求變成 42501 而不是空結果。';
comment on function public.current_role_name() is
  '回呼叫者自己的角色；未登入回 NULL。刻意開放給 anon（0154），理由同 current_tenant_id。';;
