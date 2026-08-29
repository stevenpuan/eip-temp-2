-- doc_pages 的寫入政策原本寫死 eip_has_perm('system_docs','edit')，
-- 但前端 DocPage 是用該頁自己的 key（system_docs / user_manual）判斷可否編輯。
-- 權限表裡「管理者」是 user_manual.can_edit=true、system_docs.can_edit=false，
-- 導致管理者編輯使用手冊時看得到按鈕、按儲存卻更新 0 筆且不報錯 → 靜默遺失。
-- 改成依該列自己的 key 判斷，與前端口徑一致。
drop policy if exists "doc admin write" on public.doc_pages;

create policy doc_write on public.doc_pages for all to authenticated
using      (public.eip_has_perm(key, 'edit') or current_role_name() = 'company_admin'::user_role)
with check (public.eip_has_perm(key, 'edit') or current_role_name() = 'company_admin'::user_role);
;
