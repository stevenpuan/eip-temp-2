-- 0102 覆檢後補兩個缺口
--
-- ① 緊急／高優先被事件層的 LINE 開關擋掉了
--    現況通知設定裡有三個事件的 line_enabled = false：
--      task_status_changed、recurring_due_soon、recurring_overdue
--    而 0097 的立即推播條件是 (v_urgent and rec.line_enabled)，
--    所以「緊急任務的狀態變更」「緊急常態工作逾期」都不會即時推 LINE，
--    與使用者定的規則「緊急或高＝立即發送」不符。
--    修法：緊急／高改成無條件嘗試推播，只要該收件人綁了 LINE 就送。
--    eip_line_push_now() 本身會檢查綁定與在職狀態，沒綁的自然回 false，
--    所以不需要再依賴事件層開關。
--    語意：事件層的 LINE 開關管的是「日常彙整要不要納入」，
--          緊急／高是例外通道，蓋過該開關。
--
-- ② eip_notify_user() 沒檢查收件人是否在職
--    交接待辦的通知會發給已離職的部門主管。

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
      v_sent := false;
      -- 緊急／高：不看事件層的 LINE 開關，只要人有綁 LINE 就立即推
      if v_urgent then
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
          and n.type = p_notif_type and n.message = p_message
          and n.created_at > now() - interval '1 day');
      get diagnostics v_ins = row_count;
      v_n := v_n + v_ins;
    end if;
  end loop;
  return v_n;
end;
$function$;

revoke all on function public.eip_emit_notification(text, uuid, uuid, uuid, notification_entity, uuid, notification_type, text, text) from public, anon, authenticated;

-- ② 收件人必須在職
create or replace function public.eip_notify_user(
  p_user_id uuid, p_type notification_type, p_entity_type notification_entity,
  p_entity_id uuid, p_message text, p_priority text default 'normal')
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid; v_n int := 0; v_has_line boolean; v_active boolean; v_sent boolean := false;
  v_urgent boolean := coalesce(p_priority,'normal') in ('high','urgent');
  v_prefix text := case p_priority when 'urgent' then '【緊急】' when 'high' then '【重要】' else '' end;
begin
  if p_user_id is null then return 0; end if;

  select tenant_id, (line_user_id is not null), (status = 'active')
    into v_tenant, v_has_line, v_active
    from public.app_user where id = p_user_id;

  if not coalesce(v_active, false) then return 0; end if;   -- 已停用或查無此人，不發
  v_tenant := coalesce(v_tenant, '00000000-0000-0000-0000-000000000001');

  if v_urgent and coalesce(v_has_line, false) then
    v_sent := public.eip_line_push_now(p_user_id, v_prefix || p_message);
  end if;

  insert into public.notification(tenant_id, user_id, type, entity_type, entity_id,
                                  message, line_pending, priority, line_sent_at)
  select v_tenant, p_user_id, p_type, p_entity_type, p_entity_id, p_message,
         case when v_sent then false else coalesce(v_has_line, false) end,
         coalesce(p_priority,'normal'),
         case when v_sent then now() else null end
  where not exists (
    select 1 from public.notification n
    where n.user_id = p_user_id and n.entity_id = p_entity_id
      and n.type = p_type and n.message = p_message
      and n.created_at > now() - interval '1 day');
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function public.eip_notify_user(uuid, notification_type, notification_entity, uuid, text, text) from public, anon, authenticated;
;
