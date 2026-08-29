-- 0097 LINE 發送規則依優先級分流
--   緊急 / 高 → 立即單獨推播
--   其他       → 維持每 30 分鐘依個人彙整（0091）
--
-- 做法：notification 加 priority 欄位；eip_emit_notification 多一個可選參數
-- （有預設值，既有 6 個呼叫端不用改就能繼續運作）。
-- 高優先的在寫入通知的同一個交易裡就直接 http_post 出去，並把 line_pending 設 false，
-- 所以不會又被 30 分鐘的彙整重複發一次。

/* ---------- ① 通知加優先級 ---------- */

alter table public.notification
  add column if not exists priority text not null default 'normal';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notification_priority_check') then
    alter table public.notification
      add constraint notification_priority_check
      check (priority in ('low','normal','high','urgent'));
  end if;
end $$;

create index if not exists idx_notification_line_pending
  on public.notification (user_id) where line_pending;

comment on column public.notification.priority is
  '沿用 task_priority 的值。high / urgent 會立即單獨推播 LINE，其餘進 30 分鐘彙整。';

/* ---------- ② 立即推播單一訊息 ---------- */

create or replace function public.eip_line_push_now(p_user_id uuid, p_message text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_url text; v_key text; v_line text;
begin
  select value into v_url from public.app_config where key = 'line_push_url';
  select value into v_key from public.app_config where key = 'line_push_secret';
  if v_url is null or v_key is null then return false; end if;

  select line_user_id into v_line from public.app_user
   where id = p_user_id and status = 'active';
  if v_line is null then return false; end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type','application/json','x-push-key', v_key),
    body    := jsonb_build_object('user_id', p_user_id, 'message', left(p_message, 4800))
  );
  return true;
end;
$function$;

revoke all on function public.eip_line_push_now(uuid, text) from public, anon, authenticated;

/* ---------- ③ 發送分流 ---------- */

create or replace function public.eip_emit_notification(
  p_event_code text, p_department_id uuid, p_owner_id uuid, p_actor_id uuid,
  p_entity_type notification_entity, p_entity_id uuid, p_notif_type notification_type,
  p_message text, p_priority text default 'normal')
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n int := 0; v_ins int; rec record; v_tenant uuid;
  v_urgent boolean := coalesce(p_priority,'normal') in ('high','urgent');
  v_prefix text := case p_priority when 'urgent' then '【緊急】' when 'high' then '【重要】' else '' end;
  v_sent boolean;
begin
  select tenant_id into v_tenant from public.department where id = p_department_id;
  if v_tenant is null and p_owner_id is not null then
    select tenant_id into v_tenant from public.app_user where id = p_owner_id;
  end if;
  v_tenant := coalesce(v_tenant, '00000000-0000-0000-0000-000000000001');

  for rec in
    select * from public.eip_notification_recipients(p_event_code, p_department_id, p_owner_id, p_actor_id)
  loop
    if rec.in_app then
      -- 高優先且該收件人開了 LINE：立即推，推成功就不再進彙整佇列
      v_sent := false;
      if v_urgent and rec.line_enabled then
        v_sent := public.eip_line_push_now(rec.user_id, v_prefix || p_message);
      end if;

      insert into public.notification(tenant_id, user_id, type, entity_type, entity_id,
                                      message, line_pending, priority, line_sent_at)
      select v_tenant, rec.user_id, p_notif_type, p_entity_type, p_entity_id,
             p_message,
             case when v_sent then false else rec.line_enabled end,
             coalesce(p_priority,'normal'),
             case when v_sent then now() else null end
      where not exists (
        select 1 from public.notification n
        where n.user_id = rec.user_id and n.entity_id = p_entity_id
          and n.type = p_notif_type and n.created_at::date = current_date);
      get diagnostics v_ins = row_count;
      v_n := v_n + v_ins;
    end if;
  end loop;
  return v_n;
end;
$function$;

revoke all on function public.eip_emit_notification(text, uuid, uuid, uuid, notification_entity, uuid, notification_type, text, text) from public, anon, authenticated;

/* ---------- ④ 任務相關通知帶上優先級 ---------- */

create or replace function public.eip_notify_task_assigned()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.recurring_rule_id is not null then return new; end if;
  if new.owner_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.owner_id is not distinct from old.owner_id then return new; end if;
  perform public.eip_emit_notification(
    'task_assigned', new.department_id, new.owner_id, auth.uid(),
    'task'::notification_entity, new.id, 'assigned'::notification_type,
    '【任務】' || coalesce(new.title,'') || ' 已指派給你',
    new.priority::text);
  return new;
end;
$function$;

create or replace function public.eip_notify_task_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_status text;
begin
  if new.status_id is not distinct from old.status_id then return new; end if;
  select name into v_status from public.task_status where id = new.status_id;
  perform public.eip_emit_notification(
    'task_status_changed', new.department_id, new.owner_id, auth.uid(),
    'task'::notification_entity, new.id, 'status_changed'::notification_type,
    '【狀態更新】' || coalesce(new.title,'') || ' → ' || coalesce(v_status,''),
    new.priority::text);
  return new;
end;
$function$;

comment on function public.eip_emit_notification(text, uuid, uuid, uuid, notification_entity, uuid, notification_type, text, text) is
  '寫入站內通知並決定 LINE 發送方式：p_priority = high/urgent 立即單獨推播，其餘進每 30 分鐘的個人彙整（0091）。';
;
