-- 通用通知發送輔助：依事件解析收件人，只為 in_app=true 者建 notification 列（同用戶/同實體/同日去重）
create or replace function public.eip_emit_notification(
  p_event_code   text,
  p_department_id uuid,
  p_owner_id     uuid,
  p_actor_id     uuid,
  p_entity_type  notification_entity,
  p_entity_id    uuid,
  p_notif_type   notification_type,
  p_message      text
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n int := 0;
  rec record;
  v_tenant uuid;
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
      insert into public.notification(tenant_id, user_id, type, entity_type, entity_id, message)
      select v_tenant, rec.user_id, p_notif_type, p_entity_type, p_entity_id, p_message
      where not exists (
        select 1 from public.notification n
        where n.user_id = rec.user_id and n.entity_id = p_entity_id
          and n.type = p_notif_type and n.created_at::date = current_date);
      v_n := v_n + 1;
    end if;
    -- LINE 分派待後續（rec.line_enabled）
  end loop;
  return v_n;
end;
$function$;

revoke execute on function public.eip_emit_notification(text,uuid,uuid,uuid,notification_entity,uuid,notification_type,text) from public;
revoke execute on function public.eip_emit_notification(text,uuid,uuid,uuid,notification_entity,uuid,notification_type,text) from anon;
grant execute on function public.eip_emit_notification(text,uuid,uuid,uuid,notification_entity,uuid,notification_type,text) to service_role;

-- 補預設事件：循環「提醒」（給負責人）；並讓循環「逾期」也通知負責人
insert into public.notification_setting (event_code, notif_type, recipient_scopes, in_app_enabled, line_enabled)
select 'recurring_due_soon', 'due_soon', array['owner']::text[], true, false
where not exists (select 1 from public.notification_setting
  where tenant_id='00000000-0000-0000-0000-000000000001' and event_code='recurring_due_soon' and department_id is null);

update public.notification_setting
set recipient_scopes = array['owner','dept_manager','parent_dept_manager']
where tenant_id='00000000-0000-0000-0000-000000000001'
  and event_code='recurring_overdue' and department_id is null;

-- 1) 請假/遲到/事件回報：改為依部門層級解析（原本是通知全公司所有主管）
create or replace function public.eip_notify_quick_report()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare sname text;
begin
  select name into sname from public.app_user where id = new.submitter_id;
  perform public.eip_emit_notification(
    'quick_report_submitted', new.department_id, new.submitter_id, new.submitter_id,
    'quick_report'::notification_entity, new.id, 'quick_report'::notification_type,
    (case new.type when 'late' then '【遲到回報】' when 'leave' then '【請假回報】' else '【事件回報】' end)
      || coalesce(sname,'') || ' ' || coalesce(new.detail,''));
  return new;
end;
$function$;

-- 2) 常態工作（循環）到期/逾期提醒：改走解析函式
create or replace function public.eip_run_recurring(p_date date DEFAULT CURRENT_DATE)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r recurring_rule; d date; horizon int; due date; ndays int; t record; sid uuid;
begin
  if auth.uid() is not null
     and coalesce(current_role_name()::text, '') not in ('company_admin','dept_manager') then
    raise exception '權限不足：僅管理者或部門主管可手動產生常態任務';
  end if;

  for r in select * from recurring_rule where is_active loop
    horizon := coalesce((select max(x) from unnest(r.advance_days) x), 0);
    select id into sid from task_status
      where tenant_id = r.tenant_id and is_default and not is_done_state
      order by sort_order limit 1;

    d := p_date;
    while d <= p_date + horizon loop
      if eip_rule_due_on(r, d) then
        if not exists (select 1 from task where recurring_rule_id = r.id and occurrence_date = d) then
          insert into task (tenant_id, title, description, owner_id, department_id, priority,
                            status_id, progress, due_date, created_by, recurring_rule_id, occurrence_date)
          values (r.tenant_id, r.title, r.description, r.owner_id, r.department_id, r.priority,
                  sid, 0, d, r.owner_id, r.id, d);
        end if;
      end if;
      d := d + 1;
    end loop;

    for t in
      select tk.* from task tk
      where tk.recurring_rule_id = r.id and tk.occurrence_date is not null
        and tk.status_id not in (select id from task_status where is_done_state)
    loop
      due := t.occurrence_date; ndays := due - p_date;
      if (ndays >= 0 and ndays = any(r.advance_days))
         or (p_date = due)
         or (p_date > due and r.remind_until_done and r.repeat_every_days is not null
             and ((p_date - due) % r.repeat_every_days) = 0)
      then
        perform public.eip_emit_notification(
          case when p_date > due then 'recurring_overdue' else 'recurring_due_soon' end,
          t.department_id, t.owner_id, null,
          'task'::notification_entity, t.id,
          (case when p_date > due then 'overdue' else 'due_soon' end)::notification_type,
          (case when p_date > due then '【逾期】' else '【提醒】' end)
            || r.title || '(期限 ' || to_char(due,'MM/DD') || ')');
      end if;
    end loop;

    update recurring_rule set last_run_on = p_date where id = r.id;
  end loop;
end;
$function$;

-- 3) 任務指派：INSERT 或改負責人時通知（略過常態工作自動產生的任務）
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
    '【任務】' || coalesce(new.title,'') || ' 已指派給你');
  return new;
end;
$function$;

drop trigger if exists trg_task_notify_assigned on public.task;
create trigger trg_task_notify_assigned
  after insert on public.task for each row execute function public.eip_notify_task_assigned();
drop trigger if exists trg_task_notify_reassigned on public.task;
create trigger trg_task_notify_reassigned
  after update of owner_id on public.task for each row execute function public.eip_notify_task_assigned();

-- 4) 任務狀態變更：通知（負責人 + 部門主管）
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
    '【狀態更新】' || coalesce(new.title,'') || ' → ' || coalesce(v_status,''));
  return new;
end;
$function$;

drop trigger if exists trg_task_notify_status on public.task;
create trigger trg_task_notify_status
  after update of status_id on public.task for each row execute function public.eip_notify_task_status();;
