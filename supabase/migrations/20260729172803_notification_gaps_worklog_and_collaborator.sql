-- ============================================================
-- 補齊三個通知缺漏（2026-07-29）
--  A. 工作日誌送出：原本 is_active=false，主管完全收不到 → 開站內、不開 LINE
--  B. 主管審核完日誌：完全沒有通知事件 → 新增 worklog_reviewed
--  C. 被加為任務協作者：task_collaborator 只有變更紀錄、沒有通知
-- 另補：work_log.department_id 沒有預設也沒有 trigger，會產生 NULL 列
-- ============================================================

-- ---------- A. 工作日誌送出 ----------
update public.notification_setting
   set is_active = true, in_app_enabled = true, line_enabled = false, updated_at = now()
 where event_code = 'worklog_submitted' and department_id is null;

-- ---------- B. 主管審核完成 ----------
insert into public.notification_setting
  (tenant_id, event_code, department_id, recipient_scopes, notif_type,
   in_app_enabled, line_enabled, is_active)
select '00000000-0000-0000-0000-000000000001', 'worklog_reviewed', null,
       array['owner'], 'worklog_reviewed', true, false, true
where not exists (
  select 1 from public.notification_setting
   where event_code = 'worklog_reviewed' and department_id is null);

create or replace function public.eip_notify_worklog_reviewed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare w record; v_reviewer text;
begin
  select * into w from public.work_log where id = new.work_log_id;
  if w is null or w.deleted_at is not null then return new; end if;

  -- 內容沒變就不重複通知（主管改錯字不該再叫人一次）
  if tg_op = 'UPDATE' and new.comment is not distinct from old.comment then
    return new;
  end if;

  select name into v_reviewer from public.app_user where id = new.reviewer_id;

  perform public.eip_emit_notification(
    'worklog_reviewed', w.department_id, w.user_id, new.reviewer_id,
    'work_log'::notification_entity, w.id,
    'worklog_reviewed'::notification_type,
    '你 ' || to_char(w.log_date, 'MM/DD') || ' 的工作日誌已由 '
      || coalesce(v_reviewer, '主管') || ' 審核：' || left(new.comment, 120));
  return new;
end;
$$;

drop trigger if exists trg_worklog_reviewed_notify on public.work_log_review;
create trigger trg_worklog_reviewed_notify
  after insert or update on public.work_log_review
  for each row execute function public.eip_notify_worklog_reviewed();

-- work_log_review 少了 updated_at trigger（原本 updated_at 永遠停在建立時間）
drop trigger if exists trg_worklog_review_updated on public.work_log_review;
create trigger trg_worklog_review_updated
  before update on public.work_log_review
  for each row execute function public.set_updated_at();

-- ---------- C. 被加為任務協作者 ----------
create or replace function public.eip_notify_task_collaborator_added()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare t record;
begin
  select * into t from public.task where id = new.task_id;
  if t is null or t.deleted_at is not null then return new; end if;

  -- 沿用 task_assigned 的設定（站內／LINE 開關與去重都一致）；
  -- p_owner_id 指向被加入的人，p_actor_id 讓加人的自己不會收到。
  perform public.eip_emit_notification(
    'task_assigned', t.department_id, new.user_id, (select auth.uid()),
    'task'::notification_entity, t.id,
    'assigned'::notification_type,
    '你被加入任務「' || coalesce(t.title, '') || '」的協作者');
  return new;
end;
$$;

drop trigger if exists trg_task_collab_notify on public.task_collaborator;
create trigger trg_task_collab_notify
  after insert on public.task_collaborator
  for each row execute function public.eip_notify_task_collaborator_added();

-- ---------- 補：work_log.department_id 自動帶入 ----------
create or replace function public.eip_fill_work_log_department()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.department_id is null then
    select department_id into new.department_id
      from public.app_user where id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_work_log_fill_dept on public.work_log;
create trigger trg_work_log_fill_dept
  before insert or update on public.work_log
  for each row execute function public.eip_fill_work_log_department();
;
