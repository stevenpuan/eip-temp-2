-- Supabase 的 default privileges 會自動把新函式的 EXECUTE 發給 anon，
-- 寫入型 RPC 一律收回（與 eip_soft_delete / eip_nudge_worklog 同慣例）。
-- 補充：trg_lhi_edit_guard 對「無 JWT」的呼叫者是直接放行（service_role / 排程用），
-- 擋 anon 的只剩 RLS，所以這裡一定要收掉 EXECUTE，不能只靠 RLS。
revoke execute on function public.eip_reorder_leave_handover_items(uuid[]) from anon;;
