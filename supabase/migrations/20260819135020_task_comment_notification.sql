
-- 任務有新留言／回覆時發站內通知（負責人＋所有協作者，留言者本人不收，不走 LINE）
-- 沿用既有通知管線：type=mentioned、entity=task，前端通知中心自動顯示「提及」並可點擊開啟該任務卡片，無需改前端。

-- 1) 事件設定：owner 走 scope；協作者由觸發器以 extra_user_ids 帶入
insert into public.notification_setting
  (tenant_id, event_code, department_id, recipient_scopes, notif_type, in_app_enabled, line_enabled, is_active)
select '00000000-0000-0000-0000-000000000001', 'task_comment_added', null,
       array['owner']::text[], 'mentioned', true, false, true
where not exists (
  select 1 from public.notification_setting
  where tenant_id = '00000000-0000-0000-0000-000000000001'
    and event_code = 'task_comment_added'
    and department_id is null
);

-- 2) 留言觸發器函式
create or replace function public.eip_notify_task_comment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  t record;
  v_actor   text;
  v_collabs uuid[];
  v_snippet text;
begin
  -- 只處理任務的留言（comment 表同時服務 task/meeting/project）
  if new.entity_type::text <> 'task' then
    return new;
  end if;

  select * into t from public.task where id = new.entity_id;
  if t is null or t.deleted_at is not null then
    return new;
  end if;

  -- 負責人以 owner scope 帶入；這裡補上所有協作者
  v_collabs := array(select user_id from public.task_collaborator where task_id = t.id);

  select name into v_actor from public.app_user where id = new.user_id;

  v_snippet := regexp_replace(coalesce(new.body, ''), '\s+', ' ', 'g');
  if length(v_snippet) > 40 then
    v_snippet := left(v_snippet, 40) || '…';
  end if;

  perform public.eip_emit_notification(
    'task_comment_added', t.department_id, t.owner_id, new.user_id,
    'task'::notification_entity, t.id, 'mentioned'::notification_type,
    coalesce(v_actor, '有人') || ' 在任務「' || coalesce(t.title, '') || '」留言：' || v_snippet,
    'normal', v_collabs);

  return new;
end;
$$;

-- 3) 綁定 AFTER INSERT 觸發器
drop trigger if exists trg_comment_notify_task on public.comment;
create trigger trg_comment_notify_task
  after insert on public.comment
  for each row execute function public.eip_notify_task_comment();
;
