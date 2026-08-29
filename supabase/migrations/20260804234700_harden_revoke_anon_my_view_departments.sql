-- eip_my_view_departments 是前端 RPC、非 RLS 政策述詞，不需 anon 可執行。
-- 收回 anon（default privileges 自動掛的），與「RPC 只給 authenticated」的控管一致。
-- 保留 eip_can_view_dept_shared 的 anon（它是政策述詞，比照 eip_can_view_dept_record/eip_is_dept_supervisor）。
revoke execute on function public.eip_my_view_departments() from anon;;
