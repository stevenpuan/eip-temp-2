
-- 統一補：使用者建立的表，自動填 tenant_id（+owner），避免前端漏帶被 RLS 擋。
-- 採 coalesce：authenticated 由 JWT 推導覆寫；service role(auth.uid()/tenant 為 null) 保留原值，不破壞後端寫入。

-- attachment
create or replace function public.eip_fill_attachment_defaults() returns trigger
language plpgsql security definer set search_path to 'public' as $f$
begin
  new.tenant_id   := coalesce(current_tenant_id(), new.tenant_id);
  new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
  return new;
end$f$;
drop trigger if exists trg_attachment_defaults on public.attachment;
create trigger trg_attachment_defaults before insert on public.attachment
  for each row execute function public.eip_fill_attachment_defaults();

-- comment
create or replace function public.eip_fill_comment_defaults() returns trigger
language plpgsql security definer set search_path to 'public' as $f$
begin
  new.tenant_id := coalesce(current_tenant_id(), new.tenant_id);
  new.user_id   := coalesce(auth.uid(), new.user_id);
  return new;
end$f$;
drop trigger if exists trg_comment_defaults on public.comment;
create trigger trg_comment_defaults before insert on public.comment
  for each row execute function public.eip_fill_comment_defaults();

-- task_update
create or replace function public.eip_fill_task_update_defaults() returns trigger
language plpgsql security definer set search_path to 'public' as $f$
begin
  new.tenant_id := coalesce(current_tenant_id(), new.tenant_id);
  new.user_id   := coalesce(auth.uid(), new.user_id);
  return new;
end$f$;
drop trigger if exists trg_task_update_defaults on public.task_update;
create trigger trg_task_update_defaults before insert on public.task_update
  for each row execute function public.eip_fill_task_update_defaults();

-- eip_document（owner_id 由前端決定，不動；只補 tenant 與 created_by 預設）
create or replace function public.eip_fill_document_defaults() returns trigger
language plpgsql security definer set search_path to 'public' as $f$
begin
  new.tenant_id  := coalesce(current_tenant_id(), new.tenant_id);
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end$f$;
drop trigger if exists trg_document_defaults on public.eip_document;
create trigger trg_document_defaults before insert on public.eip_document
  for each row execute function public.eip_fill_document_defaults();

-- eip_document_version
create or replace function public.eip_fill_docver_defaults() returns trigger
language plpgsql security definer set search_path to 'public' as $f$
begin
  new.tenant_id  := coalesce(current_tenant_id(), new.tenant_id);
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end$f$;
drop trigger if exists trg_docver_defaults on public.eip_document_version;
create trigger trg_docver_defaults before insert on public.eip_document_version
  for each row execute function public.eip_fill_docver_defaults();
;
