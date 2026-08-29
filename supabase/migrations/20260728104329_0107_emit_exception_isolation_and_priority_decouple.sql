-- 0107 修 H-G（例外隔離）、H-F（urgent 前綴與獨立重試）、M-11（優先級解耦）、
--      M-1（會議自邀誤報）、M-5（收件人為 null 也要留紀錄）

/* ---------- H-G：通知失敗絕不能讓業務交易失敗 ---------- */
-- 被移除的舊 trigger notify_line_on_notification() 有 exception when others then return new，
-- 收攏的過程反而把這層保護拿掉了。
-- 現在 eip_emit_notification 在業務 trigger 內同步執行，
-- 若 net.http_post 拋例外（pg_net 不可用、URL 格式錯誤、佇列異常），
-- 使用者「建立任務」會整個失敗。
--
-- H-F：把【緊急】【重要】前綴寫進 notification.message 本身，
-- 這樣重送（走彙整）時前綴不會消失。去重比對的是含前綴的訊息，一致。

create or replace function public.eip_emit_notification(
  p_event_code text, p_department_id uuid, p_owner_id uuid, p_actor_id uuid,
  p_entity_type notification_entity, p_entity_id uuid, p_notif_type notification_type,
  p_message text,
  p_priority text default 'normal',
  p_extra_user_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n int := 0; rec record; v_tenant uuid; v_new_id uuid; v_req bigint;
  v_urgent boolean := coalesce(p_priority,'normal') in ('high','urgent');
  v_msg text := case p_priority
                  when 'urgent' then '【緊急】' when 'high' then '【重要】' else '' end
                || p_message;
begin
  select tenant_id into v_tenant from public.department where id = p_department_id;
  if v_tenant is null and p_owner_id is not null then
    select tenant_id into v_tenant from public.app_user where id = p_owner_id;
  end if;
  v_tenant := coalesce(v_tenant, '00000000-0000-0000-0000-000000000001');

  for rec in
    select * from public.eip_notification_recipients(
      p_event_code, p_department_id, p_owner_id, p_actor_id, p_extra_user_ids)
  loop
    if rec.in_app then
      v_new_id := null;

      insert into public.notification(tenant_id, user_id, type, entity_type, entity_id,
                                      message, line_pending, priority)
      select v_tenant, rec.user_id, p_notif_type, p_entity_type, p_entity_id,
             v_msg, rec.line_enabled, coalesce(p_priority,'normal')
      where not exists (
        select 1 from public.notification n
        where n.user_id = rec.user_id and n.entity_id = p_entity_id
          and n.type = p_notif_type and n.message = v_msg
          and n.created_at > now() - interval '20 hours')
      returning id into v_new_id;

      if v_new_id is not null then
        v_n := v_n + 1;
        -- 緊急／高：立即推播。整段包例外，推播壞掉不能影響業務交易
        if v_urgent then
          begin
            v_req := public.eip_line_push_now(rec.user_id, v_msg);
            if v_req is not null then
              update public.notification
                 set line_request_id = v_req, line_attempts = 1, line_pending = true
               where id = v_new_id;
            end if;
          exception when others then
            update public.notification
               set line_error = left('立即推播失敗：' || sqlerrm, 200),
                   line_pending = true, line_request_id = null
             where id = v_new_id;
          end;
        end if;
      end if;
    end if;
  end loop;

  -- 收件人真的解析為 0 人才記錄（去重擋掉不算）。整段包例外。
  if v_n = 0 then
    begin
      if not exists (
        select 1 from public.eip_notification_recipients(
          p_event_code, p_department_id, p_owner_id, p_actor_id, p_extra_user_ids))
      then
        insert into public.eip_notification_miss(event_code, entity_type, entity_id, reason)
        values (p_event_code, p_entity_type::text, p_entity_id, '收件人解析為 0 人');
      end if;
    exception when others then null;
    end;
  end if;

  return v_n;
end;
$function$;

revoke all on function public.eip_emit_notification(text, uuid, uuid, uuid, notification_entity, uuid, notification_type, text, text, uuid[]) from public, anon, authenticated;

/* ---------- M-5：指定收件人為 null 也要留下可查紀錄 ---------- */
create or replace function public.eip_notify_user(
  p_user_id uuid, p_type notification_type, p_entity_type notification_entity,
  p_entity_id uuid, p_message text, p_priority text default 'normal')
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_dept uuid;
begin
  if p_user_id is null then
    begin
      insert into public.eip_notification_miss(event_code, entity_type, entity_id, reason)
      values ('direct_notify', p_entity_type::text, p_entity_id, '指定收件人為 null（部門可能沒有主管）');
    exception when others then null;
    end;
    return 0;
  end if;
  select department_id into v_dept from public.app_user where id = p_user_id;
  return public.eip_emit_notification(
    'direct_notify', v_dept, p_user_id, null,
    p_entity_type, p_entity_id, p_type, p_message, p_priority,
    array[p_user_id]);
end;
$function$;

revoke all on function public.eip_notify_user(uuid, notification_type, notification_entity, uuid, text, text) from public, anon, authenticated;

/* ---------- M-11：通知優先級與任務優先級解耦 ---------- */
-- 任務的「重要程度」不等於通知的「緊急程度」。
-- 一個 urgent 任務每次狀態變更都立即推 LINE 給 3 個人，會直接打光額度。
-- 狀態變更一律 normal；指派只有 urgent 才升級，high 走彙整。
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
    'normal');   -- 狀態變更不因任務優先級而即時推播
  return new;
end;
$function$;

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
    -- 只有「緊急」才即時推播；「高」走彙整，避免 LINE 額度被打光
    case when new.priority::text = 'urgent' then 'urgent' else 'normal' end);
  return new;
end;
$function$;

/* ---------- M-1：會議建立者把自己列為出席者，不該產生通知也不該記 miss ---------- */
create or replace function public.eip_notify_meeting_invited()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_m public.meeting; v_when text;
begin
  select * into v_m from public.meeting where id = NEW.meeting_id;
  if v_m.id is null then return NEW; end if;
  -- 26 個會議全部把建立者列為出席者，這一列必然解析出 0 人，
  -- 會讓 miss 表 100% 誤報。直接跳過。
  if NEW.user_id = v_m.created_by then return NEW; end if;

  v_when := coalesce(to_char(v_m.meeting_date, 'MM/DD'), '');
  perform public.eip_emit_notification(
    'meeting_invited', v_m.department_id, NEW.user_id, v_m.created_by,
    'meeting'::notification_entity, v_m.id, 'assigned'::notification_type,
    '【會議邀請】' || coalesce(v_m.title,'') ||
      case when v_when <> '' then '（' || v_when || '）' else '' end,
    'normal', array[NEW.user_id]);
  return NEW;
end;
$function$;

/* ---------- 觀測表加索引與清理 ---------- */
create index if not exists idx_notification_miss_created on public.eip_notification_miss (created_at desc);
;
