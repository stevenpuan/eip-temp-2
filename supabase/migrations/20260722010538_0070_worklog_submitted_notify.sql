-- 通知設定：工作日誌送出 → 通知部門主管(含上層)，站內+LINE 每日彙整
insert into public.notification_setting (event_code, department_id, recipient_scopes, notif_type, in_app_enabled, line_enabled, is_active, tenant_id)
select 'worklog_submitted', null, array['dept_manager','parent_dept_manager']::text[], 'review_needed', true, true, true, '00000000-0000-0000-0000-000000000001'
where not exists (select 1 from public.notification_setting where event_code='worklog_submitted' and department_id is null);

-- 觸發函式：狀態變為 submitted 時發送
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
  end if;
  return NEW;
end $$;

revoke execute on function public.eip_notify_worklog_submitted() from public;

drop trigger if exists trg_worklog_submitted on public.work_log;
create trigger trg_worklog_submitted
  after insert or update on public.work_log
  for each row execute function public.eip_notify_worklog_submitted();;
