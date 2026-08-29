-- 0129 用 DROP + CREATE 重建這兩支函式，
-- 新建函式會吃到 public schema 的 default privileges（其中含 anon 的 EXECUTE），
-- 所以 revoke from public 之後 anon 仍然帶著明確授權回來。這裡補收。
revoke all on function public.eip_performance_summary(date, date, uuid, uuid) from anon;
revoke all on function public.eip_performance_by_dept(date, date) from anon;;
