-- eip_admin_create_user 內部已有 company_admin 防護；再關掉 anon REST 入口（保留 authenticated）。
revoke execute on function public.eip_admin_create_user(text,text,text,uuid) from public, anon;
grant  execute on function public.eip_admin_create_user(text,text,text,uuid) to authenticated;;
