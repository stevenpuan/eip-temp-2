create or replace function public.eip_notify_worklog_submitted()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_name text;
begin
  if NEW.status = 'submitted' and (TG_OP = 'INSERT' or OLD.status is distinct from 'submitted') then
    select name into v_name from public.app_user where id = NEW.user_id;
    perform public.eip_emit_notification(
      'worklog_submitted', NEW.department_id, NEW.user_id, NEW.user_id,
      'work_log'::public.notification_entity, NEW.id, 'review_needed'::public.notification_type,
      format('【工作日誌】%s 送出 %s 的工作日誌，待批示', coalesce(v_name, '同仁'), NEW.log_date)
    );
    -- 保險：本人即該部門主管時，移除發給自己的通知（自己的日誌無需自己批示）
    delete from public.notification
     where entity_id = NEW.id and user_id = NEW.user_id
       and type = 'review_needed'::public.notification_type;
  end if;
  return NEW;
end $$;;
