-- 任務變更紀錄（自動記錄每次異動）
create table if not exists public.task_change_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000001',
  task_id uuid not null references public.task(id) on delete cascade,
  changed_by uuid references public.app_user(id) on delete set null,
  field text not null,
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);
create index if not exists ix_task_change_log_task on public.task_change_log(task_id, created_at desc);

alter table public.task_change_log enable row level security;
drop policy if exists tcl_read on public.task_change_log;
create policy tcl_read on public.task_change_log for select to authenticated
  using (public.eip_can_see_task(task_id));
grant select on public.task_change_log to authenticated;

-- 優先級中文
create or replace function public.eip_priority_label(p text)
returns text language sql immutable as $$
  select case p when 'low' then '低' when 'normal' then '一般' when 'high' then '高' when 'urgent' then '緊急' else coalesce(p,'') end;
$$;

-- 記錄任務欄位異動
create or replace function public.eip_log_task_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_actor uuid := auth.uid();
begin
  if NEW.title is distinct from OLD.title then
    insert into task_change_log(task_id,changed_by,field,old_value,new_value) values (NEW.id,v_actor,'標題',OLD.title,NEW.title);
  end if;
  if NEW.status_id is distinct from OLD.status_id then
    insert into task_change_log(task_id,changed_by,field,old_value,new_value)
      values (NEW.id,v_actor,'狀態',(select name from task_status where id=OLD.status_id),(select name from task_status where id=NEW.status_id));
  end if;
  if NEW.owner_id is distinct from OLD.owner_id then
    insert into task_change_log(task_id,changed_by,field,old_value,new_value)
      values (NEW.id,v_actor,'負責人',(select name from app_user where id=OLD.owner_id),(select name from app_user where id=NEW.owner_id));
  end if;
  if NEW.priority is distinct from OLD.priority then
    insert into task_change_log(task_id,changed_by,field,old_value,new_value)
      values (NEW.id,v_actor,'優先級',eip_priority_label(OLD.priority::text),eip_priority_label(NEW.priority::text));
  end if;
  if NEW.due_date is distinct from OLD.due_date then
    insert into task_change_log(task_id,changed_by,field,old_value,new_value) values (NEW.id,v_actor,'到期日',OLD.due_date::text,NEW.due_date::text);
  end if;
  if NEW.progress is distinct from OLD.progress then
    insert into task_change_log(task_id,changed_by,field,old_value,new_value) values (NEW.id,v_actor,'進度',OLD.progress||'%',NEW.progress||'%');
  end if;
  if NEW.project_id is distinct from OLD.project_id then
    insert into task_change_log(task_id,changed_by,field,old_value,new_value)
      values (NEW.id,v_actor,'專案',(select name from project where id=OLD.project_id),(select name from project where id=NEW.project_id));
  end if;
  if NEW.department_id is distinct from OLD.department_id then
    insert into task_change_log(task_id,changed_by,field,old_value,new_value)
      values (NEW.id,v_actor,'部門',(select name from department where id=OLD.department_id),(select name from department where id=NEW.department_id));
  end if;
  if NEW.description is distinct from OLD.description then
    insert into task_change_log(task_id,changed_by,field,old_value,new_value)
      values (NEW.id,v_actor,'說明',left(coalesce(OLD.description,''),80),left(coalesce(NEW.description,''),80));
  end if;
  return null;
end $$;
revoke execute on function public.eip_log_task_change() from public;
drop trigger if exists trg_task_change_log on public.task;
create trigger trg_task_change_log after update on public.task
  for each row execute function public.eip_log_task_change();

-- 記錄協作者增減
create or replace function public.eip_log_task_collab_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if TG_OP='INSERT' then
    insert into task_change_log(task_id,changed_by,field,old_value,new_value)
      values (NEW.task_id, auth.uid(), '協作者', null, (select name from app_user where id=NEW.user_id));
  elsif TG_OP='DELETE' then
    insert into task_change_log(task_id,changed_by,field,old_value,new_value)
      values (OLD.task_id, auth.uid(), '協作者', (select name from app_user where id=OLD.user_id), null);
  end if;
  return null;
end $$;
revoke execute on function public.eip_log_task_collab_change() from public;
drop trigger if exists trg_task_collab_change on public.task_collaborator;
create trigger trg_task_collab_change after insert or delete on public.task_collaborator
  for each row execute function public.eip_log_task_collab_change();;
