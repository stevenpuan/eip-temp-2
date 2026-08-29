-- 0120 批5：異常缺失的截圖／附件
-- 追加需求「格式簡易可貼截圖」。比照工作日誌的做法：專用 bucket + 專用附件表 + 一支存取判定函式。
-- 不沿用 attachment 表（它的 entity_type enum 雖然加了 anomaly，
-- 但那張表的 storage 政策綁在 documents bucket 且路徑規則不同，混用會讓政策更難讀）。

insert into storage.buckets (id, name, public)
values ('anomaly', 'anomaly', false)
on conflict (id) do nothing;

create table if not exists public.eip_anomaly_attachment (
  id           uuid primary key default gen_random_uuid(),
  anomaly_id   uuid not null references public.eip_anomaly(id) on delete cascade,
  file_name    text not null,
  storage_path text not null unique,
  mime_type    text,
  file_size    bigint,
  uploaded_by  uuid references public.app_user(id) on delete set null,
  created_at   timestamptz not null default now()
);

comment on table public.eip_anomaly_attachment is
  '異常缺失的截圖／附件。storage 路徑格式 <anomaly_id>/<uuid>，bucket = anomaly';

create index if not exists idx_anomaly_attachment on public.eip_anomaly_attachment(anomaly_id, created_at);

create or replace function public.eip_fill_anomaly_attachment_defaults()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.uploaded_by is null then new.uploaded_by := auth.uid(); end if;
  return new;
end $function$;

revoke execute on function public.eip_fill_anomaly_attachment_defaults() from public, anon, authenticated;

drop trigger if exists trg_anomaly_attachment_defaults on public.eip_anomaly_attachment;
create trigger trg_anomaly_attachment_defaults before insert on public.eip_anomaly_attachment
  for each row execute function public.eip_fill_anomaly_attachment_defaults();

------------------------------------------------------------------
-- 存取判定：
--   讀 —— 看得到那張缺失的人（責任員工／開立者／部門主管／管理者）
--   寫 —— 開立者、責任員工（填報時要能貼圖）、部門主管、管理者
-- auth.uid() 為 null（未登入）一律 false。函式對 anon 也要 grant，
-- 否則 storage 政策在未登入請求時會因為沒有 EXECUTE 而變成 500 而不是正常的 403。
------------------------------------------------------------------
create or replace function public.eip_anomaly_file_access(p_path text, p_write boolean)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_id uuid; a record; v_me uuid := auth.uid();
begin
  if v_me is null then return false; end if;
  begin
    v_id := (storage.foldername(p_path))[1]::uuid;
  exception when others then
    return false;
  end;

  select * into a from public.eip_anomaly where id = v_id and deleted_at is null;
  if a is null then return false; end if;
  if a.tenant_id <> current_tenant_id() then return false; end if;

  if p_write then
    return a.raised_by = v_me
        or a.subject_id = v_me
        or current_role_name() = 'company_admin'::user_role
        or public.eip_is_dept_supervisor(a.department_id);
  end if;

  return a.subject_id = v_me
      or a.raised_by = v_me
      or current_role_name() = 'company_admin'::user_role
      or public.eip_is_dept_supervisor(a.department_id);
end;
$function$;

revoke execute on function public.eip_anomaly_file_access(text, boolean) from public;
grant execute on function public.eip_anomaly_file_access(text, boolean) to authenticated, anon;

------------------------------------------------------------------
-- storage 政策（比照 worklog bucket）
------------------------------------------------------------------
drop policy if exists anomaly_files_read   on storage.objects;
drop policy if exists anomaly_files_insert on storage.objects;
drop policy if exists anomaly_files_update on storage.objects;
drop policy if exists anomaly_files_delete on storage.objects;

create policy anomaly_files_read on storage.objects
  for select using (bucket_id = 'anomaly' and public.eip_anomaly_file_access(name, false));
create policy anomaly_files_insert on storage.objects
  for insert with check (bucket_id = 'anomaly' and public.eip_anomaly_file_access(name, true));
create policy anomaly_files_update on storage.objects
  for update using (bucket_id = 'anomaly' and public.eip_anomaly_file_access(name, true));
create policy anomaly_files_delete on storage.objects
  for delete using (bucket_id = 'anomaly' and public.eip_anomaly_file_access(name, true));

------------------------------------------------------------------
-- 附件表 RLS：與 bucket 同一組判定，避免兩邊規則漂移
------------------------------------------------------------------
alter table public.eip_anomaly_attachment enable row level security;

drop policy if exists anomaly_att_read   on public.eip_anomaly_attachment;
drop policy if exists anomaly_att_write  on public.eip_anomaly_attachment;
drop policy if exists anomaly_att_delete on public.eip_anomaly_attachment;

create policy anomaly_att_read on public.eip_anomaly_attachment
  for select to authenticated
  using (public.eip_anomaly_file_access(storage_path, false));

create policy anomaly_att_write on public.eip_anomaly_attachment
  for insert to authenticated
  with check (public.eip_anomaly_file_access(storage_path, true));

create policy anomaly_att_delete on public.eip_anomaly_attachment
  for delete to authenticated
  using (public.eip_anomaly_file_access(storage_path, true));

revoke all on public.eip_anomaly_attachment from anon;
grant select, insert, delete on public.eip_anomaly_attachment to authenticated;;
