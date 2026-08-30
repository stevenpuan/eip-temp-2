-- 承上：doc_pages 的 doc_write 是 FOR ALL，而 FOR ALL 也涵蓋 SELECT，
-- 所以 3 位管理者（eip_derive_app_role 把 manager 映射成 company_admin）
-- 仍然繞過新的 doc_read 讀得到 4 份 *_bak_* 備份。
-- 拆成 insert / update / delete 三條，寫入權限完全不變，只是不再附帶讀取權。
drop policy if exists doc_write on public.doc_pages;

create policy doc_insert on public.doc_pages
  for insert to authenticated
  with check (
    public.eip_has_perm(key, 'edit')
    or public.current_role_name() = 'company_admin'::user_role
  );

create policy doc_update on public.doc_pages
  for update to authenticated
  using (
    public.eip_has_perm(key, 'edit')
    or public.current_role_name() = 'company_admin'::user_role
  )
  with check (
    public.eip_has_perm(key, 'edit')
    or public.current_role_name() = 'company_admin'::user_role
  );

create policy doc_delete on public.doc_pages
  for delete to authenticated
  using (
    public.eip_has_perm(key, 'edit')
    or public.current_role_name() = 'company_admin'::user_role
  );;
