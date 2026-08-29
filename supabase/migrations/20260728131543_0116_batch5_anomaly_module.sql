-- 0116 批5：異常缺失 / CAPA 模組（雙軌：員工自主填報 + 主管開立缺失）
--
-- 需求來源：07/28 訪談 + 11:30 追加需求
--  ・主管開立缺失（記錄開立日期時間、格式簡易可貼截圖）→ 通知員工 → 員工點通知進填報
--  ・狀態機加起始狀態「待填報」，週彙整 KPI 加「未填寫」＝待填報件數
--  ・全系統唯一保留的主管簽核動作＝「確認並追蹤改善」
--
-- 未回覆的 8 題採用建議預設值（已獲指示直接做）：
--  ・主管開立設 3 天限期填報（fill_due_date = 開立日 + 3）
--  ・員工不能退回缺失（沒有 reject 動作，只能填報或請主管作廢）
--  ・異常金額非必填
--  ・遲到回報保留在 eip_quick_report，不併進本模組
--
-- 狀態機
--   pending_fill 待填報 → filled 已填報 → improving 追蹤改善中 → closed 已結案
--   void 作廢（只有主管／管理者）
--   source='self' 直接從 filled 起算

create table if not exists public.eip_anomaly (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  code            text,
  source          text not null,
  subject_id      uuid not null references public.app_user(id) on delete restrict,
  department_id   uuid references public.department(id) on delete set null,
  raised_by       uuid references public.app_user(id) on delete set null,
  raised_at       timestamptz not null default now(),
  title           text not null,
  detail          text,
  severity        text not null default 'normal',
  occurred_on     date,
  amount          numeric(14,2),
  fill_due_date   date,
  filled_at       timestamptz,
  filled_by       uuid references public.app_user(id) on delete set null,
  cause           text,
  action_taken    text,
  prevention      text,
  status          text not null default 'pending_fill',
  confirmed_by    uuid references public.app_user(id) on delete set null,
  confirmed_at    timestamptz,
  confirm_note    text,
  improve_due_date date,
  closed_by       uuid references public.app_user(id) on delete set null,
  closed_at       timestamptz,
  close_note      text,
  void_reason     text,
  deleted_at      timestamptz,
  deleted_by      uuid references public.app_user(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint eip_anomaly_source_chk   check (source in ('self','supervisor')),
  constraint eip_anomaly_status_chk   check (status in ('pending_fill','filled','improving','closed','void')),
  constraint eip_anomaly_severity_chk check (severity in ('low','normal','high','critical')),
  constraint eip_anomaly_amount_chk   check (amount is null or amount >= 0),
  constraint eip_anomaly_self_chk     check (not (source = 'self' and status = 'pending_fill'))
);

comment on table public.eip_anomaly is
  '異常缺失 / CAPA。source=supervisor 為主管開立（起始 pending_fill），source=self 為員工自主填報（起始 filled）。'
  'subject_id 用 ON DELETE RESTRICT —— 有缺失紀錄的員工不允許硬刪（H6 的教訓）';
comment on column public.eip_anomaly.fill_due_date is '主管開立時 = 開立日 + 3 天（採用建議預設值）';

create index if not exists idx_anomaly_subject   on public.eip_anomaly(subject_id, status) where deleted_at is null;
create index if not exists idx_anomaly_dept      on public.eip_anomaly(department_id, occurred_on) where deleted_at is null;
create index if not exists idx_anomaly_status    on public.eip_anomaly(status) where deleted_at is null;
create index if not exists idx_anomaly_fill_due  on public.eip_anomaly(fill_due_date)
  where deleted_at is null and status = 'pending_fill';
create index if not exists idx_anomaly_raised    on public.eip_anomaly(raised_at desc) where deleted_at is null;

------------------------------------------------------------------
-- 預設值與狀態流轉一致性由 trigger 保證，前端不用（也不該）自己算
------------------------------------------------------------------
create or replace function public.eip_fill_anomaly_defaults()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_seq int;
begin
  if tg_op = 'INSERT' then
    if new.tenant_id is null then
      select tenant_id into new.tenant_id from public.app_user where id = new.subject_id;
      new.tenant_id := coalesce(new.tenant_id, '00000000-0000-0000-0000-000000000001');
    end if;
    if new.raised_by is null then new.raised_by := auth.uid(); end if;
    if new.department_id is null then
      select department_id into new.department_id from public.app_user where id = new.subject_id;
    end if;
    if new.occurred_on is null then
      new.occurred_on := (new.raised_at at time zone 'Asia/Taipei')::date;
    end if;

    if new.code is null then
      select count(*) + 1 into v_seq from public.eip_anomaly
       where tenant_id = new.tenant_id
         and date_trunc('month', raised_at) = date_trunc('month', new.raised_at);
      new.code := 'AN-' || to_char(new.raised_at at time zone 'Asia/Taipei', 'YYYYMM')
                        || '-' || lpad(v_seq::text, 3, '0');
    end if;

    if new.source = 'supervisor' then
      new.status := coalesce(nullif(new.status,''), 'pending_fill');
      if new.fill_due_date is null then
        new.fill_due_date := (new.raised_at at time zone 'Asia/Taipei')::date + 3;
      end if;
    else
      new.status    := 'filled';
      new.filled_at := coalesce(new.filled_at, now());
      new.filled_by := coalesce(new.filled_by, new.subject_id);
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'pending_fill' and new.status = 'filled' then
      new.filled_at := coalesce(new.filled_at, now());
      new.filled_by := coalesce(new.filled_by, auth.uid());
    end if;
    if old.status <> 'improving' and new.status = 'improving' then
      new.confirmed_at := coalesce(new.confirmed_at, now());
      new.confirmed_by := coalesce(new.confirmed_by, auth.uid());
    end if;
    if old.status <> 'closed' and new.status = 'closed' then
      new.closed_at := coalesce(new.closed_at, now());
      new.closed_by := coalesce(new.closed_by, auth.uid());
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

revoke execute on function public.eip_fill_anomaly_defaults() from anon, authenticated;

drop trigger if exists trg_anomaly_defaults on public.eip_anomaly;
create trigger trg_anomaly_defaults before insert or update on public.eip_anomaly
  for each row execute function public.eip_fill_anomaly_defaults();

------------------------------------------------------------------
-- 通知：全部走 eip_emit_notification 統一入口，不直接呼叫 net.http_post
------------------------------------------------------------------
create or replace function public.eip_notify_anomaly()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_name text;
begin
  select name into v_name from public.app_user where id = new.subject_id;

  if tg_op = 'INSERT' then
    if new.source = 'supervisor' then
      perform public.eip_emit_notification(
        'anomaly_opened', new.department_id, new.subject_id, new.raised_by,
        'anomaly'::notification_entity, new.id, 'anomaly_opened'::notification_type,
        '【異常缺失】' || coalesce(new.code,'') || '「' || new.title || '」已開立，'
          || '請於 ' || to_char(new.fill_due_date, 'MM/DD') || ' 前完成填報',
        'urgent');
    else
      perform public.eip_emit_notification(
        'anomaly_filled', new.department_id, new.subject_id, new.subject_id,
        'anomaly'::notification_entity, new.id, 'anomaly_filled'::notification_type,
        '【異常缺失】' || coalesce(v_name,'') || ' 自主填報「' || new.title || '」，請確認',
        'normal');
    end if;
    return new;
  end if;

  if old.status = 'pending_fill' and new.status = 'filled' then
    perform public.eip_emit_notification(
      'anomaly_filled', new.department_id, new.subject_id, new.filled_by,
      'anomaly'::notification_entity, new.id, 'anomaly_filled'::notification_type,
      '【異常缺失】' || coalesce(new.code,'') || '「' || new.title || '」已完成填報，請確認',
      'normal',
      case when new.raised_by is not null then array[new.raised_by] else null end);

  elsif old.status <> 'improving' and new.status = 'improving' then
    perform public.eip_emit_notification(
      'anomaly_confirmed', new.department_id, new.subject_id, new.confirmed_by,
      'anomaly'::notification_entity, new.id, 'anomaly_confirmed'::notification_type,
      '【異常缺失】' || coalesce(new.code,'') || '「' || new.title || '」主管已確認，進入改善追蹤'
        || case when new.improve_due_date is not null
                then '（改善期限 ' || to_char(new.improve_due_date,'MM/DD') || '）' else '' end,
      'normal');

  elsif old.status <> 'closed' and new.status = 'closed' then
    perform public.eip_emit_notification(
      'anomaly_closed', new.department_id, new.subject_id, new.closed_by,
      'anomaly'::notification_entity, new.id, 'anomaly_closed'::notification_type,
      '【異常缺失】' || coalesce(new.code,'') || '「' || new.title || '」已結案',
      'normal');
  end if;

  return new;
end;
$function$;

revoke execute on function public.eip_notify_anomaly() from anon, authenticated;

drop trigger if exists trg_anomaly_notify_ins on public.eip_anomaly;
create trigger trg_anomaly_notify_ins after insert on public.eip_anomaly
  for each row execute function public.eip_notify_anomaly();

drop trigger if exists trg_anomaly_notify_upd on public.eip_anomaly;
create trigger trg_anomaly_notify_upd after update of status on public.eip_anomaly
  for each row when (old.status is distinct from new.status)
  execute function public.eip_notify_anomaly();

------------------------------------------------------------------
-- 通知設定：eip_notification_recipients 查不到啟用的設定就「完全不發」，
-- 這些列一定要建，否則整個模組的通知靜默失效。
------------------------------------------------------------------
insert into public.notification_setting
  (tenant_id, event_code, department_id, recipient_scopes, notif_type, in_app_enabled, line_enabled, is_active)
select v.tenant_id, v.event_code, null::uuid, v.scopes, v.notif_type, v.in_app, v.line, true
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid,'anomaly_opened',    array['owner','deputy'],        'anomaly_opened',    true, true ),
  ('00000000-0000-0000-0000-000000000001'::uuid,'anomaly_filled',    array['dept_manager'],          'anomaly_filled',    true, true ),
  ('00000000-0000-0000-0000-000000000001'::uuid,'anomaly_confirmed', array['owner'],                 'anomaly_confirmed', true, true ),
  ('00000000-0000-0000-0000-000000000001'::uuid,'anomaly_closed',    array['owner'],                 'anomaly_closed',    true, false),
  ('00000000-0000-0000-0000-000000000001'::uuid,'anomaly_overdue',   array['owner','dept_manager'],  'anomaly_overdue',   true, true )
) v(tenant_id, event_code, scopes, notif_type, in_app, line)
where not exists (
  select 1 from public.notification_setting s
   where s.tenant_id = v.tenant_id and s.event_code = v.event_code and s.department_id is null);

------------------------------------------------------------------
-- 逾期未填報：每天台北 00:30（UTC 16:30）掃一次。
-- high 走彙整不是即時；靠 eip_emit_notification 的 20 小時去重節流，不會天天重打。
------------------------------------------------------------------
create or replace function public.eip_sweep_anomaly_overdue()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare a record; v_n int := 0;
begin
  for a in
    select * from public.eip_anomaly
     where deleted_at is null
       and status = 'pending_fill'
       and fill_due_date is not null
       and fill_due_date < (now() at time zone 'Asia/Taipei')::date
  loop
    begin
      if public.eip_emit_notification(
           'anomaly_overdue', a.department_id, a.subject_id, null,
           'anomaly'::notification_entity, a.id, 'anomaly_overdue'::notification_type,
           '【異常缺失逾期未填報】' || coalesce(a.code,'') || '「' || a.title
             || '」應於 ' || to_char(a.fill_due_date,'MM/DD') || ' 前填報',
           'high') > 0 then
        v_n := v_n + 1;
      end if;
    exception when others then
      raise warning 'anomaly overdue notify 失敗 %: %', a.id, sqlerrm;
    end;
  end loop;
  return v_n;
end;
$function$;

revoke execute on function public.eip_sweep_anomaly_overdue() from anon, authenticated;

-- 重複套用時先移除舊排程，避免同名 job 疊加
do $$
begin
  perform cron.unschedule('anomaly_overdue_sweep');
exception when others then null;
end $$;
select cron.schedule('anomaly_overdue_sweep', '30 16 * * *',
  $$select public.eip_sweep_anomaly_overdue();$$);

------------------------------------------------------------------
-- RLS
------------------------------------------------------------------
alter table public.eip_anomaly enable row level security;

drop policy if exists anomaly_read   on public.eip_anomaly;
drop policy if exists anomaly_insert on public.eip_anomaly;
drop policy if exists anomaly_fill   on public.eip_anomaly;
drop policy if exists anomaly_manage on public.eip_anomaly;
drop policy if exists anomaly_delete on public.eip_anomaly;

create policy anomaly_read on public.eip_anomaly
  for select to authenticated
  using (tenant_id = current_tenant_id()
         and deleted_at is null
         and (subject_id = (select auth.uid())
              or raised_by = (select auth.uid())
              or current_role_name() = 'company_admin'::user_role
              or public.eip_is_dept_supervisor(department_id)));

create policy anomaly_insert on public.eip_anomaly
  for insert to authenticated
  with check (tenant_id = current_tenant_id()
              and ((source = 'self' and subject_id = (select auth.uid()))
                   or (source = 'supervisor'
                       and (current_role_name() = 'company_admin'::user_role
                            or public.eip_is_dept_supervisor(department_id)))));

-- 責任員工填報。WITH CHECK 也綁 subject_id，避免把單子改到別人頭上
create policy anomaly_fill on public.eip_anomaly
  for update to authenticated
  using (tenant_id = current_tenant_id() and deleted_at is null
         and subject_id = (select auth.uid())
         and status in ('pending_fill','filled','improving'))
  with check (tenant_id = current_tenant_id()
              and subject_id = (select auth.uid())
              and status in ('pending_fill','filled','improving'));

-- 主管：確認追蹤改善、結案、作廢。
-- WITH CHECK 不只驗 tenant，也要求改完之後仍在自己管轄範圍內
-- （M8 的教訓：PERMISSIVE 政策之間是 OR，WITH CHECK 太寬會放寬其他政策的限制）
create policy anomaly_manage on public.eip_anomaly
  for update to authenticated
  using (tenant_id = current_tenant_id() and deleted_at is null
         and (current_role_name() = 'company_admin'::user_role
              or public.eip_is_dept_supervisor(department_id)))
  with check (tenant_id = current_tenant_id()
              and (current_role_name() = 'company_admin'::user_role
                   or public.eip_is_dept_supervisor(department_id)));

create policy anomaly_delete on public.eip_anomaly
  for delete to authenticated
  using (tenant_id = current_tenant_id() and deleted_at is null
         and (current_role_name() = 'company_admin'::user_role
              or raised_by = (select auth.uid())));

revoke all on public.eip_anomaly from anon;
grant select, insert, update, delete on public.eip_anomaly to authenticated;

------------------------------------------------------------------
-- 納入全系統通用的刪除保存機制（軟刪除 + 回收區）
-- purge_role = 'admin'：缺失紀錄涉及稽核，不讓開立者自己永久刪
------------------------------------------------------------------
insert into public.eip_deletion_policy(module_key, table_name, label, creator_col, purge_role, is_active)
values ('eip_anomaly', 'eip_anomaly', '異常缺失', 'raised_by', 'admin', true)
on conflict (module_key) do update
  set table_name = excluded.table_name,
      label = excluded.label,
      creator_col = excluded.creator_col,
      purge_role = excluded.purge_role,
      is_active = excluded.is_active;

drop trigger if exists trg_soft_delete_guard on public.eip_anomaly;
create trigger trg_soft_delete_guard before delete on public.eip_anomaly
  for each row execute function public.eip_soft_delete_guard();

------------------------------------------------------------------
-- 週彙整 KPI（含追加需求的「未填寫」＝待填報件數）
------------------------------------------------------------------
create or replace function public.eip_anomaly_weekly_kpi(
  p_from date, p_to date, p_department_id uuid default null)
 returns table(
   department_id uuid, department_name text,
   total int, unfilled int, filled int, improving int, closed int, voided int,
   overdue_unfilled int, total_amount numeric, avg_close_days numeric)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is not null
     and coalesce(current_role_name()::text,'') not in ('company_admin','dept_manager') then
    raise exception '權限不足：僅管理者或部門主管可查看異常週彙整';
  end if;
  if p_to < p_from then raise exception '日期範圍顛倒'; end if;

  return query
  select a.department_id,
         d.name,
         count(*)::int,
         count(*) filter (where a.status = 'pending_fill')::int,
         count(*) filter (where a.status = 'filled')::int,
         count(*) filter (where a.status = 'improving')::int,
         count(*) filter (where a.status = 'closed')::int,
         count(*) filter (where a.status = 'void')::int,
         count(*) filter (where a.status = 'pending_fill'
                            and a.fill_due_date < (now() at time zone 'Asia/Taipei')::date)::int,
         coalesce(sum(a.amount), 0)::numeric,
         round(avg(extract(epoch from (a.closed_at - a.raised_at)) / 86400)
               filter (where a.closed_at is not null), 1)::numeric
    from public.eip_anomaly a
    left join public.department d on d.id = a.department_id
   where a.deleted_at is null
     and a.occurred_on between p_from and p_to
     and (p_department_id is null or a.department_id = p_department_id)
     and (auth.uid() is null
          or coalesce(current_role_name()::text,'') = 'company_admin'
          or public.eip_is_dept_supervisor(a.department_id))
   group by a.department_id, d.name
   order by d.name nulls last;
end;
$function$;

grant execute on function public.eip_anomaly_weekly_kpi(date, date, uuid) to authenticated;
revoke execute on function public.eip_anomaly_weekly_kpi(date, date, uuid) from anon;;
