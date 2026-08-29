
-- 任務留言其實寫進 task_update.comment（不是 comment 表）。改掛觸發器到正確的表。
create or replace function public.eip_notify_task_update_comment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  t record;
  v_actor   text;
  v_collabs uuid[];
  v_snip    text;
begin
  -- 只在「真的有留言文字」時發；純進度／狀態更新（comment 空）不發
  if new.comment is null or btrim(new.comment) = '' then
    return new;
  end if;

  select * into t from public.task where id = new.task_id;
  if t is null or t.deleted_at is not null then
    return new;
  end if;

  v_collabs := array(select user_id from public.task_collaborator where task_id = t.id);
  select name into v_actor from public.app_user where id = new.user_id;

  v_snip := regexp_replace(new.comment, '\s+', ' ', 'g');
  if length(v_snip) > 40 then
    v_snip := left(v_snip, 40) || '…';
  end if;

  perform public.eip_emit_notification(
    'task_comment_added', t.department_id, t.owner_id, new.user_id,
    'task'::notification_entity, t.id, 'mentioned'::notification_type,
    coalesce(v_actor, '有人') || ' 在任務「' || coalesce(t.title, '') || '」留言：' || v_snip,
    'normal', v_collabs);

  return new;
end;
$$;

-- 移除掛錯表（comment）的舊觸發器與函式
drop trigger if exists trg_comment_notify_task on public.comment;
drop function if exists public.eip_notify_task_comment();

-- 掛到正確的表
drop trigger if exists trg_task_update_notify on public.task_update;
create trigger trg_task_update_notify
  after insert on public.task_update
  for each row execute function public.eip_notify_task_update_comment();
;
