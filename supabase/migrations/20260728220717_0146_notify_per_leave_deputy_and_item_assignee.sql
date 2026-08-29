-- ============================================================
-- 0146 通知要寄到「這一次請假指定的代理人」與「被逐項指派的人」
--
-- 規格書 H：①代辦產生時 → 通知單位主管＋代理人；②代辦全數完成 → 通知主管＋休假人。
-- 主管不需要按任何按鈕（不核准、不簽核）。
--
-- 現況的漏洞：leave_handover_created 的收件範圍有 'deputy'，但那個 scope 解析的是
-- app_user.deputy_id（靜態代理人，通知副本用）。新流程是「每次請假指定代理人」，
-- 存在 eip_quick_report.deputy_id，完全不在收件人名單裡 ——
-- 指定了代理人，那個人卻收不到通知。
-- ============================================================
create or replace function public.eip_notify_quick_report()
 returns trigger language plpgsql security definer set search_path to 'public' as $$
declare sname text; ltname text; v_range text;
begin
  select name into sname from public.app_user where id = new.submitter_id;

  if new.type = 'leave' then
    if new.leave_type is not null then
      select name into ltname from public.leave_type
       where code = new.leave_type and tenant_id = new.tenant_id;
    end if;
    v_range := case
      when new.leave_from is not null and new.leave_to is not null
        then to_char(new.leave_from at time zone 'Asia/Taipei', 'MM/DD HH24:MI')
             || '～' || to_char(new.leave_to at time zone 'Asia/Taipei', 'MM/DD HH24:MI')
      else to_char(new.report_date, 'MM/DD') end;

    perform public.eip_emit_notification(
      'leave_handover_created', new.department_id, new.submitter_id, new.submitter_id,
      'leave_handover'::notification_entity, new.id, 'handover_created'::notification_type,
      format('【請假代辦】%s %s%s 請假，期間工作請協助接手',
             coalesce(sname,'同仁'), v_range,
             case when ltname is not null then '（'||ltname||'）' else '' end),
      'normal',
      -- 這一次指定的代理人：靜態 deputy scope 抓不到他
      case when new.deputy_id is not null then array[new.deputy_id] else null end);
  else
    perform public.eip_emit_notification(
      'quick_report_submitted', new.department_id, new.submitter_id, new.submitter_id,
      'quick_report'::notification_entity, new.id, 'quick_report'::notification_type,
      (case new.type when 'late' then '【遲到回報】' else '【事件回報】' end)
        || coalesce(sname,'') || ' ' || coalesce(new.detail,''));
  end if;
  return new;
end $$;
revoke all on function public.eip_notify_quick_report() from public, anon, authenticated;

-- 代辦項目是在請假單建立之後才逐項加的，被指派者當下不會收到上面那封。
-- 補一個「指派到你」的通知；同一人多項會被 eip_emit_notification 的去重吃掉，
-- 不會一次塞十封。
create or replace function public.eip_notify_lhi_assigned()
 returns trigger language plpgsql security definer set search_path to 'public' as $$
declare r public.eip_quick_report; sname text; v_range text;
begin
  if new.assignee_id is null then return new; end if;

  select * into r from public.eip_quick_report where id = new.quick_report_id;
  if r.id is null then return new; end if;
  -- 請假人自己指派給自己不用通知
  if new.assignee_id = r.submitter_id then return new; end if;

  select name into sname from public.app_user where id = r.submitter_id;
  v_range := case
    when r.leave_from is not null and r.leave_to is not null
      then to_char(r.leave_from at time zone 'Asia/Taipei', 'MM/DD')
           || '～' || to_char(r.leave_to at time zone 'Asia/Taipei', 'MM/DD')
    else to_char(r.report_date, 'MM/DD') end;

  begin
    perform public.eip_emit_notification(
      'leave_handover_created', r.department_id, new.assignee_id, auth.uid(),
      'leave_handover'::notification_entity, r.id, 'handover_created'::notification_type,
      format('【代辦事項】%s %s 請假期間有代辦事項指派給你，請到「我的工作」查看',
             coalesce(sname,'同仁'), v_range),
      'normal', array[new.assignee_id]);
  exception when others then
    -- 通知失敗不能讓代辦項目建不起來
    raise warning '代辦指派通知失敗 %: %', new.id, sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.eip_notify_lhi_assigned() from public, anon, authenticated;

drop trigger if exists trg_lhi_notify_assigned on public.eip_leave_handover_item;
create trigger trg_lhi_notify_assigned after insert on public.eip_leave_handover_item
  for each row execute function public.eip_notify_lhi_assigned();;
