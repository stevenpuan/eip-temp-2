-- 稽核發現：notification_setting 有 worklog_submitted 這個事件，
-- 但全庫沒有任何地方會 emit 它（work_log 上只有 soft_delete_guard / materialize_items）。
-- 也就是說即使把設定打開，主管還是永遠收不到。這裡補上真正的發送點。
create or replace function public.eip_notify_worklog_submitted()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_name text;
begin
  -- 只在「草稿 → 送出」這一次轉換時發，撤回後再送出會再發一次（符合預期）
  if new.status is distinct from 'submitted' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'submitted' then return new; end if;
  if new.deleted_at is not null then return new; end if;

  select name into v_name from public.app_user where id = new.user_id;

  perform public.eip_emit_notification(
    'worklog_submitted', new.department_id, new.user_id, new.user_id,
    'work_log'::notification_entity, new.id,
    'status_changed'::notification_type,
    coalesce(v_name, '同仁') || ' 已送出 ' || to_char(new.log_date, 'MM/DD') || ' 的工作日誌');
  return new;
end;
$$;

revoke all on function public.eip_notify_worklog_submitted() from public, anon, authenticated;
grant execute on function public.eip_notify_worklog_submitted() to postgres, service_role;

drop trigger if exists trg_worklog_submitted_notify on public.work_log;
create trigger trg_worklog_submitted_notify
  after insert or update of status on public.work_log
  for each row execute function public.eip_notify_worklog_submitted();
;
