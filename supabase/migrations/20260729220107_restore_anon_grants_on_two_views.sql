-- 同一個誤判的另一半：我也收回了這兩個 view 的 anon 權限。
-- 兩者都是 security_invoker，底層表的 RLS 會擋住未登入者（實測 0 筆），
-- 收回只會把「空結果」變成「permission denied for view」。一併回復。
grant select on public.eip_org_chart          to anon;
grant select on public.eip_recurring_overview to anon;
;
