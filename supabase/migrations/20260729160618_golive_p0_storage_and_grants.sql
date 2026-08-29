-- ============================================================
-- 上線前 P0 修補（2026-07-29 稽核）
-- P0-2 documents bucket 檔案級守衛
-- P0-3 eip_docfiles_update 指向不存在的 bucket 'eip-docs'
-- P0-5 收回 12 個 SECURITY DEFINER 函式與 2 個 view 的 anon 權限
-- P0-6 system_configs 全體可讀 / attachment 中繼資料全租戶可讀
-- ============================================================

-- ---------- P0-2 / P0-3：documents bucket ----------
-- 路徑格式：<tenant_id>/<document_id>/<timestamp>_<filename>
-- 前端流程確認：新增與編輯模式都是「先有 eip_document 列 → 才上傳」，
-- 所以用 document_id 當守衛依據不會擋掉正常上傳。
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

  -- 第一段必須是自己公司的 tenant
  if (storage.foldername(p_path))[1] is distinct from current_tenant_id()::text then
    return false;
  end if;

  begin
    v_doc := (storage.foldername(p_path))[2]::uuid;
  exception when others then
    return false;                       -- 路徑不合格式一律拒絕（fail-closed）
  end;

  select * into d from public.eip_document
   where id = v_doc and deleted_at is null;
  if d is null then return false; end if;
  if d.tenant_id <> current_tenant_id() then return false; end if;

  if p_write then
    -- 對齊 document_update / document_delete
    return current_role_name() = 'company_admin'::user_role
        or d.owner_id = v_me
        or d.created_by = v_me
        or (current_role_name() = 'dept_manager'::user_role
            and d.department_id is not null
            and public.eip_user_can_scope_dept(d.department_id));
  end if;

  -- 對齊 document_read
  return current_role_name() = 'company_admin'::user_role
      or d.status = 'published'
      or d.owner_id = v_me
      or d.created_by = v_me
      or (d.department_id is not null and public.eip_can_view_dept_record(d.department_id));
end;
$$;

revoke all on function public.eip_document_file_access(text, boolean) from public, anon;
grant execute on function public.eip_document_file_access(text, boolean) to authenticated, service_role;

drop policy if exists eip_docfiles_read   on storage.objects;
drop policy if exists eip_docfiles_insert on storage.objects;
drop policy if exists eip_docfiles_update on storage.objects;
drop policy if exists eip_docfiles_delete on storage.objects;

create policy eip_docfiles_read on storage.objects for select to authenticated
using (bucket_id = 'documents' and public.eip_document_file_access(name, false));

create policy eip_docfiles_insert on storage.objects for insert to authenticated
with check (bucket_id = 'documents' and public.eip_document_file_access(name, true));

create policy eip_docfiles_update on storage.objects for update to authenticated
using      (bucket_id = 'documents' and public.eip_document_file_access(name, true))
with check (bucket_id = 'documents' and public.eip_document_file_access(name, true));

-- 刪除：文件寫入權，或本人就是當初的上傳者
create policy eip_docfiles_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'documents'
  and (
    public.eip_document_file_access(name, true)
    or exists (select 1 from public.attachment a
                where a.storage_path = storage.objects.name and a.uploaded_by = (select auth.uid()))
    or exists (select 1 from public.eip_document_version v
                where v.storage_path = storage.objects.name and v.created_by = (select auth.uid()))
  )
);

-- ---------- P0-5：收回 anon ----------
revoke execute on function
  public.current_role_name(),
  public.current_tenant_id(),
  public.eip_can_manage_task(uuid),
  public.eip_can_see_announcement(uuid),
  public.eip_can_see_meeting(uuid),
  public.eip_can_see_project(uuid),
  public.eip_can_see_task(uuid),
  public.eip_can_view_dept_record(uuid),
  public.eip_is_dept_supervisor(uuid),
  public.eip_is_task_collaborator(uuid),
  public.eip_owns_personal_event(uuid),
  public.eip_user_can_scope_dept(uuid)
from anon;

revoke all on public.eip_org_chart         from anon;
revoke all on public.eip_recurring_overview from anon;

-- ---------- P0-6a：system_configs 不再全體可讀 ----------
drop policy if exists "cfg read all" on public.system_configs;
create policy cfg_read on public.system_configs for select to authenticated
using (public.eip_has_perm('system_config','view')
       or current_role_name() = 'company_admin'::user_role);

-- ---------- P0-6b：attachment 接上父實體可見範圍 ----------
drop policy if exists attachment_read on public.attachment;
create policy attachment_read on public.attachment for select to authenticated
using (
  tenant_id = current_tenant_id()
  and (
       current_role_name() = 'company_admin'::user_role
    or uploaded_by = (select auth.uid())
    or (entity_type::text = 'task'     and public.eip_can_see_task(entity_id))
    or (entity_type::text = 'meeting'  and public.eip_can_see_meeting(entity_id))
    or (entity_type::text = 'project'  and public.eip_can_see_project(entity_id))
    or (entity_type::text = 'document' and public.eip_link_endpoint_visible('document', entity_id))
    or (entity_type::text = 'announcement' and public.eip_can_see_announcement(entity_id))
  )
);
;
