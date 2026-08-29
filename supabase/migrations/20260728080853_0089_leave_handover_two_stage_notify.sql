-- 0089 請假代辦：取消兩段簽核，改兩段通知（代辦產生 / 代辦完成，主管不按鈕）
-- 依 2026-07-28 11:30 追加需求第 3 項。另補 submitted_at 送出日期時間。

-- ① 欄位
alter table public.eip_quick_report
  add column if not exists submitted_at timestamptz,
  add column if not exists done_at timestamptz,
  add column if not exists done_by uuid references public.app_user(id) on delete set null,
  add column if not exists handover_note text;

-- 既有資料用 created_at 回填，之後由 default 接手
update public.eip_quick_report set submitted_at = created_at where submitted_at is null;
alter table public.eip_quick_report
  alter column submitted_at set default now(),
  alter column submitted_at set not null;

comment on column public.eip_quick_report.submitted_at is '送出日期時間（追加需求第3項）';
comment on column public.eip_quick_report.done_at is '代辦完成時間。status=done 時填。';
comment on column public.eip_quick_report.handover_note is '代理人接手處理的備註';
comment on column public.eip_quick_report.status is
  'open=代辦產生待完成／done=代辦完成／acknowledged=2026-07-28 前舊制「主管已確認」，視同已完成。無簽核動作。';

-- ② 兩個新事件的通知設定（全公司預設）
insert into public.notification_setting
  (tenant_id, event_code, department_id, recipient_scopes, notif_type, in_app_enabled, line_enabled, is_active)
select '00000000-0000-0000-0000-000000000001', 'leave_handover_created', null,
       array['deputy','dept_manager']::text[], 'handover_created', true, true, true
where not exists (select 1 from public.notification_setting
                  where event_code='leave_handover_created' and department_id is null);

insert into public.notification_setting
  (tenant_id, event_code, department_id, recipient_scopes, notif_type, in_app_enabled, line_enabled, is_active)
select '00000000-0000-0000-0000-000000000001', 'leave_handover_completed', null,
       array['owner','dept_manager']::text[], 'handover_completed', true, false, true
where not exists (select 1 from public.notification_setting
                  where event_code='leave_handover_completed' and department_id is null);

-- 0088 已移除 worklog_submitted 的 trigger，這筆設定成為孤兒，停用避免通知設定頁誤導
update public.notification_setting set is_active = false, updated_at = now()
 where event_code = 'worklog_submitted';

-- ③ 第一段通知：代辦產生。請假走 leave_handover_created，其餘維持原本的 quick_report_submitted
create or replace function public.eip_notify_quick_report()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
             case when ltname is not null then '（'||ltname||'）' else '' end));
  else
    perform public.eip_emit_notification(
      'quick_report_submitted', new.department_id, new.submitter_id, new.submitter_id,
      'quick_report'::notification_entity, new.id, 'quick_report'::notification_type,
      (case new.type when 'late' then '【遲到回報】' else '【事件回報】' end)
        || coalesce(sname,'') || ' ' || coalesce(new.detail,''));
  end if;
  return new;
end;
$function$;

-- ④ 第二段通知：代辦完成。狀態轉 done 時通知請假者本人與部門主管
create or replace function public.eip_notify_leave_handover_done()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare sname text; dname text;
begin
  if new.type <> 'leave' then return new; end if;
  if new.status <> 'done' or old.status = 'done' then return new; end if;

  select name into sname from public.app_user where id = new.submitter_id;
  select name into dname from public.app_user where id = new.done_by;

  perform public.eip_emit_notification(
    'leave_handover_completed', new.department_id, new.submitter_id, new.done_by,
    'leave_handover'::notification_entity, new.id, 'handover_completed'::notification_type,
    format('【請假代辦完成】%s %s 的請假代辦已由 %s 處理完成',
           coalesce(sname,'同仁'), to_char(new.report_date, 'MM/DD'),
           coalesce(dname,'代理人')));
  return new;
end;
$function$;

revoke all on function public.eip_notify_leave_handover_done() from public, anon, authenticated;

drop trigger if exists trg_qr_handover_done on public.eip_quick_report;
create trigger trg_qr_handover_done
  after update on public.eip_quick_report
  for each row execute function public.eip_notify_leave_handover_done();

-- ⑤ 代辦完成的更新政策：本人、代理人、部門主管、管理者皆可標記完成（主管不需按鈕，但不禁止）
drop policy if exists qr_update_done on public.eip_quick_report;
create policy qr_update_done on public.eip_quick_report
  for update using (
    submitter_id = (select auth.uid())
    or (select auth.uid()) in (select id from public.app_user where deputy_id = eip_quick_report.submitter_id)
    or public.eip_is_dept_supervisor(department_id)
    or public.current_role_name() = 'company_admin'::public.user_role
  );
;
