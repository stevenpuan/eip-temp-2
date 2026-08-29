-- 私有儲存桶（限 PDF/Word/Excel/圖片，單檔 10MB）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('worklog', 'worklog', false, 10485760, array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png','image/jpeg','image/gif','image/webp'
])
on conflict (id) do nothing;

-- 附件紀錄表
create table if not exists public.work_log_attachment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000001',
  work_log_id uuid not null references public.work_log(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.app_user(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  file_size bigint,
  created_at timestamptz not null default now()
);
create index if not exists ix_wla_worklog on public.work_log_attachment(work_log_id);
create index if not exists ix_wla_user on public.work_log_attachment(user_id);

alter table public.work_log_attachment enable row level security;
-- 讀：日誌本人或其部門主管
drop policy if exists wla_read on public.work_log_attachment;
create policy wla_read on public.work_log_attachment for select to authenticated
  using (tenant_id = current_tenant_id() and exists (
    select 1 from public.work_log wl where wl.id = work_log_id
      and (wl.user_id = (select auth.uid()) or public.eip_is_dept_supervisor(wl.department_id))));
-- 寫/刪：僅日誌本人（或 company_admin）
drop policy if exists wla_insert on public.work_log_attachment;
create policy wla_insert on public.work_log_attachment for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.work_log wl where wl.id = work_log_id and wl.user_id = (select auth.uid())));
drop policy if exists wla_delete on public.work_log_attachment;
create policy wla_delete on public.work_log_attachment for delete to authenticated
  using (user_id = (select auth.uid()) or current_role_name() = 'company_admin');
grant select, insert, delete on public.work_log_attachment to authenticated;

-- 檔案存取判斷（路徑首段=work_log_id）
create or replace function public.eip_worklog_file_access(p_path text, p_write boolean)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare v_id uuid; v_owner uuid; v_dept uuid;
begin
  begin v_id := split_part(p_path, '/', 1)::uuid; exception when others then return false; end;
  select user_id, department_id into v_owner, v_dept from public.work_log where id = v_id;
  if v_owner is null then return false; end if;
  if p_write then
    return v_owner = (select auth.uid());
  end if;
  return v_owner = (select auth.uid())
      or public.eip_is_dept_supervisor(v_dept)
      or current_role_name() = 'company_admin';
end $$;
revoke execute on function public.eip_worklog_file_access(text, boolean) from public;
grant execute on function public.eip_worklog_file_access(text, boolean) to authenticated;

-- Storage 物件層權限（限 worklog 桶）
drop policy if exists worklog_read on storage.objects;
create policy worklog_read on storage.objects for select to authenticated
  using (bucket_id = 'worklog' and public.eip_worklog_file_access(name, false));
drop policy if exists worklog_insert on storage.objects;
create policy worklog_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'worklog' and public.eip_worklog_file_access(name, true));
drop policy if exists worklog_update on storage.objects;
create policy worklog_update on storage.objects for update to authenticated
  using (bucket_id = 'worklog' and public.eip_worklog_file_access(name, true));
drop policy if exists worklog_delete on storage.objects;
create policy worklog_delete on storage.objects for delete to authenticated
  using (bucket_id = 'worklog' and public.eip_worklog_file_access(name, true));;
