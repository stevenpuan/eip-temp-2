-- eip_document_file_access：owner_id / created_by 為 NULL 時原本會回傳 NULL。
-- RLS 把 NULL 當作不通過所以行為安全，但明確 coalesce 成 false 才不會在別處被 NOT 反轉。
create or replace function public.eip_document_file_access(p_path text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_doc uuid; d record; v_me uuid := (select auth.uid());
begin
  if v_me is null then return false; end if;

  if (storage.foldername(p_path))[1] is distinct from current_tenant_id()::text then
    return false;
  end if;

  begin
    v_doc := (storage.foldername(p_path))[2]::uuid;
  exception when others then
    return false;
  end;

  select * into d from public.eip_document
   where id = v_doc and deleted_at is null;
  if d is null then return false; end if;
  if d.tenant_id is distinct from current_tenant_id() then return false; end if;

  if p_write then
    return coalesce(
        current_role_name() = 'company_admin'::user_role
     or d.owner_id   = v_me
     or d.created_by = v_me
     or (current_role_name() = 'dept_manager'::user_role
         and d.department_id is not null
         and public.eip_user_can_scope_dept(d.department_id))
    , false);
  end if;

  return coalesce(
      current_role_name() = 'company_admin'::user_role
   or d.status = 'published'
   or d.owner_id   = v_me
   or d.created_by = v_me
   or (d.department_id is not null and public.eip_can_view_dept_record(d.department_id))
  , false);
end;
$$;

revoke all on function public.eip_document_file_access(text, boolean) from public, anon;
grant execute on function public.eip_document_file_access(text, boolean) to authenticated, service_role;
;
