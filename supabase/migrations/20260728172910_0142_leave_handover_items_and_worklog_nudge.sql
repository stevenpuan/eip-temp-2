-- ============================================================
-- 0142  P1#8 催填  +  P1#9 請假代辦逐項清單
-- ============================================================

/* ---------- P1#9 請假代辦 ----------
   規格書 H：只留區間、每次請假指定代理人、逐項代辦清單（事項／指派／連結／完成時間）、
   完成度即時回傳、三方可見、兩段通知。
   現況只做到「兩段通知＋submitted_at＋單一 handover_note 文字」。
   請假單本身沿用 eip_quick_report（type='leave'），不另建 header 表 ——
   再開一張 leave_handover 會變成兩份請假資料，對不起來更糟。
   這裡補：代理人欄位 + 逐項代辦表。                                     */

alter table public.eip_quick_report
  add column if not exists deputy_id uuid references public.app_user(id) on delete set null;
comment on column public.eip_quick_report.deputy_id is
  '這一次請假指定的代理人。app_user.deputy_id 是靜態代理人（通知副本用），兩者不同。';

create table if not exists public.eip_leave_handover_item (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000001'::uuid,
  quick_report_id uuid not null references public.eip_quick_report(id) on delete cascade,
  title text not null,
  assignee_id uuid references public.app_user(id) on delete set null,
  url text,
  sort_order integer not null default 0,
  done_at timestamptz,
  done_by uuid references public.app_user(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.eip_leave_handover_item is
  '請假期間的代辦事項（逐項）。完成度＝done_at 非空的比例，由 trigger 回寫請假單狀態。';

create index if not exists idx_lhi_report on public.eip_leave_handover_item(quick_report_id);
create index if not exists idx_lhi_assignee on public.eip_leave_handover_item(assignee_id) where done_at is null;

alter table public.eip_leave_handover_item drop constraint if exists lhi_url_shape;
alter table public.eip_leave_handover_item add constraint lhi_url_shape
  check (url is null or (url ~ '^(https?://|file://|\\\\)' and length(url) <= 2000));

create or replace function public.eip_fill_lhi_defaults()
 returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    if new.created_by is null then new.created_by := auth.uid(); end if;
    if new.tenant_id is null then new.tenant_id := coalesce(current_tenant_id(), '00000000-0000-0000-0000-000000000001'); end if;
    -- 沒指定就掛給請假單上的代理人
    if new.assignee_id is null then
      select q.deputy_id into new.assignee_id from public.eip_quick_report q where q.id = new.quick_report_id;
    end if;
    if new.sort_order = 0 then
      select coalesce(max(sort_order), 0) + 1 into new.sort_order
        from public.eip_leave_handover_item where quick_report_id = new.quick_report_id;
    end if;
  end if;
  -- 勾完成／取消完成時自動蓋章，前端不要自己塞
  if tg_op = 'UPDATE' then
    if old.done_at is null and new.done_at is not null and new.done_by is null then
      new.done_by := auth.uid();
    elsif new.done_at is null then
      new.done_by := null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.eip_fill_lhi_defaults() from public, anon, authenticated;

drop trigger if exists trg_lhi_defaults on public.eip_leave_handover_item;
create trigger trg_lhi_defaults before insert or update on public.eip_leave_handover_item
  for each row execute function public.eip_fill_lhi_defaults();

/* 完成度回傳：所有項目都完成時把請假單推到 done，
   由既有的 trg_qr_handover_done 發出第二段「代辦完成」通知。
   反之只要有一項被取消完成就退回 acknowledged，數字不會說謊。 */
create or replace function public.eip_lhi_rollup()
 returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_rid uuid; v_total int; v_done int; v_status text;
begin
  v_rid := coalesce(new.quick_report_id, old.quick_report_id);
  select count(*), count(*) filter (where done_at is not null)
    into v_total, v_done
    from public.eip_leave_handover_item where quick_report_id = v_rid;

  select status into v_status from public.eip_quick_report where id = v_rid;

  if v_total > 0 and v_done = v_total and v_status <> 'done' then
    update public.eip_quick_report
       set status = 'done', done_at = now(),
           done_by = coalesce(new.done_by, auth.uid())
     where id = v_rid;
  elsif v_done < v_total and v_status = 'done' then
    update public.eip_quick_report
       set status = 'acknowledged', done_at = null, done_by = null
     where id = v_rid;
  end if;
  return null;
end $$;
revoke all on function public.eip_lhi_rollup() from public, anon, authenticated;

drop trigger if exists trg_lhi_rollup on public.eip_leave_handover_item;
create trigger trg_lhi_rollup after insert or update or delete on public.eip_leave_handover_item
  for each row execute function public.eip_lhi_rollup();

alter table public.eip_leave_handover_item enable row level security;

-- 三方可見：當事人（請假人）／代理人（被指派者）／單位主管／管理者
create or replace function public.eip_can_see_leave(p_report_id uuid)
 returns boolean language sql stable security definer set search_path to 'public' as $function$
  select exists (
    select 1 from public.eip_quick_report q
     where q.id = p_report_id
       and q.tenant_id = current_tenant_id()
       and q.deleted_at is null
       and (current_role_name() = 'company_admin'
            or q.submitter_id = (select auth.uid())
            or q.deputy_id = (select auth.uid())
            or (q.department_id is not null and public.eip_is_dept_supervisor(q.department_id))
            or exists (select 1 from public.eip_leave_handover_item i
                        where i.quick_report_id = q.id and i.assignee_id = (select auth.uid())))
  );
$function$;
revoke all on function public.eip_can_see_leave(uuid) from public, anon;
grant execute on function public.eip_can_see_leave(uuid) to authenticated, service_role;

drop policy if exists lhi_read on public.eip_leave_handover_item;
create policy lhi_read on public.eip_leave_handover_item
  for select to authenticated
  using (tenant_id = current_tenant_id() and public.eip_can_see_leave(quick_report_id));

-- 只有請假人（或管理者）能編排代辦清單
drop policy if exists lhi_write on public.eip_leave_handover_item;
create policy lhi_write on public.eip_leave_handover_item
  for insert to authenticated
  with check (tenant_id = current_tenant_id()
              and exists (select 1 from public.eip_quick_report q
                           where q.id = quick_report_id and q.deleted_at is null
                             and (q.submitter_id = (select auth.uid())
                                  or current_role_name() = 'company_admin')));

-- 勾完成：被指派者、請假人、管理者都可以
drop policy if exists lhi_update on public.eip_leave_handover_item;
create policy lhi_update on public.eip_leave_handover_item
  for update to authenticated
  using (tenant_id = current_tenant_id() and public.eip_can_see_leave(quick_report_id))
  with check (tenant_id = current_tenant_id() and public.eip_can_see_leave(quick_report_id));

drop policy if exists lhi_delete on public.eip_leave_handover_item;
create policy lhi_delete on public.eip_leave_handover_item
  for delete to authenticated
  using (tenant_id = current_tenant_id()
         and exists (select 1 from public.eip_quick_report q
                      where q.id = quick_report_id
                        and (q.submitter_id = (select auth.uid())
                             or current_role_name() = 'company_admin')));

grant select, insert, update, delete on public.eip_leave_handover_item to authenticated;
revoke all on public.eip_leave_handover_item from anon;


/* ---------- P1#8 催填 ----------
   主管在部門例行彙總頁對「未提交」的人按催填。
   走既有通知機制，不另開一條路；只能催自己管轄範圍內的人，且每人每天最多一次
   （eip_emit_notification 對同訊息會 dedupe，這裡再加一層日期限制講清楚）。 */
create or replace function public.eip_nudge_worklog(p_user_ids uuid[], p_date date default null)
 returns integer
 language plpgsql security definer set search_path to 'public'
as $function$
declare v_me uuid := auth.uid(); u record; v_n int := 0; v_name text;
begin
  if v_me is null then raise exception '需要登入身分'; end if;
  if not public.eip_is_any_dept_supervisor() then
    raise exception '權限不足：只有管理者或部門主管可以催填';
  end if;
  p_date := coalesce(p_date, (now() at time zone 'Asia/Taipei')::date);
  if p_date > (now() at time zone 'Asia/Taipei')::date then
    raise exception '不能催未來日期';
  end if;
  if coalesce(array_length(p_user_ids,1),0) = 0 then return 0; end if;
  if array_length(p_user_ids,1) > 100 then raise exception '一次最多催 100 人'; end if;

  select name into v_name from public.app_user where id = v_me;

  for u in
    select a.id, a.department_id from public.app_user a
     where a.id = any(p_user_ids) and a.status = 'active'
       -- 只能催管轄範圍內的人；不是自己管的直接跳過，不報錯（批次操作不要因一人中斷）
       and (coalesce(current_role_name()::text,'') = 'company_admin'
            or (a.department_id is not null and public.eip_user_can_scope_dept(a.department_id)))
       and a.id <> v_me
  loop
    begin
      if public.eip_emit_notification(
           'worklog_nudge', u.department_id, u.id, v_me,
           'work_log'::notification_entity, null, 'review_needed'::notification_type,
           format('【工作日誌未提交】%s 提醒您補填 %s 的工作日誌',
                  coalesce(v_name,'主管'), to_char(p_date, 'MM/DD')),
           'high') > 0 then
        v_n := v_n + 1;
      end if;
    exception when others then
      raise warning '催填通知失敗 %: %', u.id, sqlerrm;
    end;
  end loop;
  return v_n;
end;
$function$;
revoke all on function public.eip_nudge_worklog(uuid[], date) from public, anon;
grant execute on function public.eip_nudge_worklog(uuid[], date) to authenticated, service_role;

-- 催填屬於例外提醒，預設走 in-app + LINE（主管按了就是真的要人補）
insert into public.notification_setting (tenant_id, event_code, recipient_scopes, notif_type, in_app_enabled, line_enabled, is_active)
select '00000000-0000-0000-0000-000000000001', 'worklog_nudge', array['owner'], 'review_needed', true, true, true
where not exists (select 1 from public.notification_setting
                   where event_code = 'worklog_nudge'
                     and tenant_id = '00000000-0000-0000-0000-000000000001');;
