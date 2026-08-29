-- 對齊全庫慣例：SECURITY DEFINER RPC 不開放 anon（未登入）執行。
-- 建立函式時 Supabase 預設權限自動塞了 anon=EXECUTE，revoke from public 收不到，需明確 revoke。
revoke execute on function public.eip_worklog_supervised_members() from anon;;
