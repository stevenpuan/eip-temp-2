-- 0099 交接待辦通知接上 LINE，並讓「逾期 7 天」走緊急即時推播
--
-- 發現的問題：eip_notify_user() 把 line_pending 寫死成 false，
-- 所以交接待辦的所有通知（產生、逾期 3 天、逾期 7 天）從來只有站內通知，
-- 一次都沒有進過 LINE 佇列。使用者完全不會在 LINE 上看到人員異動的事。
--
-- 修正：
--   1. line_pending 改成看該收件人有沒有綁 LINE
--   2. 加 p_priority；high/urgent 立即單獨推播（與 0097 的任務規則一致）
--   3. 逾期 7 天升級給管理者 → urgent（立即推）
--      逾期 3 天通知部門主管 → high（立即推，因為 3 天沒動已經是要介入的訊號）

create or replace function public.eip_notify_user(
  p_user_id uuid, p_type notification_type, p_entity_type notification_entity,
  p_entity_id uuid, p_message text, p_priority text default 'normal')
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid; v_n int := 0; v_has_line boolean; v_sent boolean := false;
  v_urgent boolean := coalesce(p_priority,'normal') in ('high','urgent');
  v_prefix text := case p_priority when 'urgent' then '【緊急】' when 'high' then '【重要】' else '' end;
begin
  if p_user_id is null then return 0; end if;

  select tenant_id, (line_user_id is not null) into v_tenant, v_has_line
    from public.app_user where id = p_user_id;
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
      and n.type = p_type and n.created_at::date = current_date);
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function public.eip_notify_user(uuid, notification_type, notification_entity, uuid, text, text) from public, anon, authenticated;

-- 逾期升級改帶優先級
create or replace function public.eip_sweep_handover()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare h record; v_done boolean; v_closed int := 0; v_mgr uuid; v_adm uuid;
begin
  for h in select * from public.eip_handover_item where status = 'pending' loop
    v_done := case h.entity_type
      when 'task' then not exists (
        select 1 from public.task t join public.task_status s on s.id=t.status_id
         where t.id=h.entity_id and t.owner_id=h.leaver_id and not s.is_done_state)
      when 'task_collaborator' then not exists (
        select 1 from public.task_collaborator tc
          join public.task t on t.id=tc.task_id
          join public.task_status s on s.id=t.status_id
         where tc.task_id=h.entity_id and tc.user_id=h.leaver_id and not s.is_done_state)
      when 'project' then not exists (
        select 1 from public.project p where p.id=h.entity_id and p.owner_id=h.leaver_id)
      when 'recurring_rule' then not exists (
        select 1 from public.recurring_rule r where r.id=h.entity_id and r.owner_id=h.leaver_id)
      when 'meeting_action_item' then not exists (
        select 1 from public.meeting_action_item a
         where a.id=h.entity_id and a.owner_id=h.leaver_id and a.status <> 'done')
      else true end;

    if v_done then
      update public.eip_handover_item
         set status='resolved', resolution='系統偵測已完成交接或原項目已結案', resolved_at=now()
       where id = h.id;
      v_closed := v_closed + 1;
      continue;
    end if;

    -- 逾期升級：3 天通知部門主管（重要）、7 天通知管理者（緊急），各只做一次
    if h.escalated_level < 1 and h.created_at < now() - interval '3 days' then
      select manager_id into v_mgr from public.department where id = h.department_id;
      perform public.eip_notify_user(v_mgr, 'reassign_needed'::notification_type, 'handover'::notification_entity,
        h.id, '【交接逾期】「' || coalesce(h.entity_title,'') || '」已超過 3 天未重新指派，請協助處理', 'high');
      update public.eip_handover_item set escalated_level = 1 where id = h.id;
    elsif h.escalated_level < 2 and h.created_at < now() - interval '7 days' then
      select id into v_adm from public.app_user
        where status='active' and role='company_admin' order by created_at limit 1;
      perform public.eip_notify_user(v_adm, 'reassign_needed'::notification_type, 'handover'::notification_entity,
        h.id, '【交接嚴重逾期】「' || coalesce(h.entity_title,'') || '」已超過 7 天未重新指派', 'urgent');
      update public.eip_handover_item set escalated_level = 2 where id = h.id;
    end if;
  end loop;
  return v_closed;
end;
$function$;

comment on function public.eip_notify_user(uuid, notification_type, notification_entity, uuid, text, text) is
  '寄給特定一個人的通知（不走通知設定的收件範圍）。high/urgent 立即單獨推 LINE，其餘進 30 分鐘彙整。';
;
