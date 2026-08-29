-- 0132 收掉最後兩支 anon 可呼叫的 SECURITY DEFINER 函式。
-- 兩支本來就 fail-closed（auth.uid() 為 null 時一律回 false），
-- 但 storage 政策全部是 TO authenticated，anon 根本不需要 EXECUTE。
revoke all on function public.eip_has_perm(text, text) from anon;
revoke all on function public.eip_worklog_file_access(text, boolean) from anon;

-- eip_docfiles_update 是唯一一條 roles={public} 的 storage 政策（其餘 11 條都是 authenticated），
-- 對齊成 authenticated，避免未登入請求走進政策運算。
drop policy if exists eip_docfiles_update on storage.objects;
create policy eip_docfiles_update on storage.objects
  for update to authenticated
  using (bucket_id = 'eip-docs' and public.eip_has_perm('eip_documents', 'edit'))
  with check (bucket_id = 'eip-docs' and public.eip_has_perm('eip_documents', 'edit'));;
