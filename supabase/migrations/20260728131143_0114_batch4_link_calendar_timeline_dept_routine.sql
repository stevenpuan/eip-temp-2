-- 0114 批4：eip_link 通用連結、行事曆顯示休假、執行歷程時間軸、部門例行彙總
-- 所有 view 一律 security_invoker=true —— view 預設以建立者權限執行會整段繞過 RLS（0112 已踩過）

------------------------------------------------------------------
-- ① eip_link 通用連結
--    任務↔文件、會議決議↔任務、缺失↔任務… 用一張表表達，不再為每種組合開欄位
------------------------------------------------------------------
create table if not exists public.eip_link (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  from_type  text not null,
  from_id    uuid not null,
  to_type    text not null,
  to_id      uuid not null,
  relation   text not null default 'related',
  note       text,
  created_by uuid references public.app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint eip_link_from_type_chk check (from_type in
    ('task','meeting','meeting_action_item','project','document','quick_report','work_log','announcement','defect','feature_request')),
  constraint eip_link_to_type_chk check (to_type in
    ('task','meeting','meeting_action_item','project','document','quick_report','work_log','announcement','defect','feature_request')),
  constraint eip_link_relation_chk check (relation in ('related','blocks','duplicates','source_of','follow_up')),
  constraint eip_link_no_self check (not (from_type = to_type and from_id = to_id))
);

comment on table public.eip_link is
  '通用實體連結。注意：政策只能做到 tenant 層級 —— 無法在 RLS 內動態檢查兩端實體的可見性，'
  '所以前端解析兩端標題時仍要各自查原表（RLS 會擋），連結本身只是 id 對照。';

create unique index if not exists uq_eip_link
  on public.eip_link(from_type, from_id, to_type, to_id, relation);
create index if not exists idx_eip_link_from on public.eip_link(from_type, from_id);
create index if not exists idx_eip_link_to   on public.eip_link(to_type, to_id);

create or replace function public.eip_fill_link_defaults()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.created_by is null then new.created_by := auth.uid(); end if;
  if new.tenant_id is null then
    new.tenant_id := coalesce(current_tenant_id(), '00000000-0000-0000-0000-000000000001');
  end if;
  return new;
end $function$;
revoke execute on function public.eip_fill_link_defaults() from anon, authenticated;

drop trigger if exists trg_eip_link_defaults on public.eip_link;
create trigger trg_eip_link_defaults before insert on public.eip_link
  for each row execute function public.eip_fill_link_defaults();

alter table public.eip_link enable row level security;

drop policy if exists eip_link_read   on public.eip_link;
drop policy if exists eip_link_write  on public.eip_link;
drop policy if exists eip_link_delete on public.eip_link;

create policy eip_link_read on public.eip_link
  for select to authenticated using (tenant_id = current_tenant_id());

create policy eip_link_write on public.eip_link
  for insert to authenticated with check (tenant_id = current_tenant_id());

-- 只有建立者或管理者可以移除連結
create policy eip_link_delete on public.eip_link
  for delete to authenticated
  using (tenant_id = current_tenant_id()
         and (created_by = (select auth.uid()) or current_role_name() = 'company_admin'::user_role));

revoke all on public.eip_link from anon;
grant select, insert, delete on public.eip_link to authenticated;

------------------------------------------------------------------
-- ② 行事曆顯示休假
--    把個人行程與請假（eip_quick_report type='leave'）併成一個來源。
--    security_invoker 讓兩邊各自的 RLS 生效：本人看自己的、主管看管轄範圍的，
--    不會因為併成 view 就讓全公司看到彼此的假。
--    leave_from / leave_to 是 timestamptz，一律換算台北時間再取日期。
------------------------------------------------------------------
create or replace view public.eip_calendar_events as
  select 'event'::text        as kind,
         pe.id,
         pe.tenant_id,
         pe.user_id,
         pe.title,
         pe.start_date,
         coalesce(pe.end_date, pe.start_date) as end_date,
         pe.start_time,
         pe.end_time,
         pe.note,
         null::text           as leave_type,
         null::text           as status
    from public.personal_event pe
   where pe.deleted_at is null
  union all
  select 'leave',
         qr.id,
         qr.tenant_id,
         qr.submitter_id,
         coalesce(nullif(qr.leave_type,''), '請假')
           || case when qr.status = 'done' then '' else '（代辦未完成）' end,
         (qr.leave_from at time zone 'Asia/Taipei')::date,
         (coalesce(qr.leave_to, qr.leave_from) at time zone 'Asia/Taipei')::date,
         (qr.leave_from at time zone 'Asia/Taipei')::time,
         (coalesce(qr.leave_to, qr.leave_from) at time zone 'Asia/Taipei')::time,
         qr.detail,
         qr.leave_type,
         qr.status
    from public.eip_quick_report qr
   where qr.type = 'leave'
     and qr.deleted_at is null
     and qr.leave_from is not null;

alter view public.eip_calendar_events set (security_invoker = true);
grant select on public.eip_calendar_events to authenticated;
revoke all on public.eip_calendar_events from anon;

------------------------------------------------------------------
-- ③ 執行歷程時間軸
--    合併欄位變更（task_change_log）、進度回報（task_update）、子項完成（task_checklist）。
--    不新增表，三個來源都已經有 RLS SELECT 政策，security_invoker 直接沿用。
------------------------------------------------------------------
create or replace view public.eip_task_timeline as
  select tcl.task_id,
         tcl.tenant_id,
         'field_change'::text as kind,
         tcl.created_at       as at,
         tcl.changed_by       as actor_id,
         tcl.field,
         tcl.old_value,
         tcl.new_value,
         null::int            as progress,
         null::text           as comment
    from public.task_change_log tcl
  union all
  select tu.task_id, tu.tenant_id, 'progress', tu.created_at, tu.user_id,
         case when tu.status_changed_to_id is not null then 'status_id' else null end,
         null,
         case when tu.status_changed_to_id is not null
              then (select s.name from public.task_status s where s.id = tu.status_changed_to_id)
              else null end,
         tu.progress, tu.comment
    from public.task_update tu
  union all
  select c.task_id, c.tenant_id, 'checklist_done', c.done_at, c.done_by,
         'checklist', null, c.title, null, null
    from public.task_checklist c
   where c.is_done and c.done_at is not null;

alter view public.eip_task_timeline set (security_invoker = true);
grant select on public.eip_task_timeline to authenticated;
revoke all on public.eip_task_timeline from anon;

------------------------------------------------------------------
-- ④ 部門例行彙總
--    「應做」＝當日到期的個人例行範本（複用既有 eip_personal_routine_due_on）
--    「已做」＝工作日誌上午/下午區裡 source='personal_routine' 且 done=true 的項數
--    分母口徑：只算「當日有到期範本」或「當日日誌有勾到例行項」的人日，
--             沒有任何例行範本的人不會被算進來（避免分母灌水）。
------------------------------------------------------------------
create or replace function public.eip_dept_routine_summary(
  p_from date, p_to date, p_department_id uuid default null)
 returns table(
   department_id uuid, department_name text,
   user_id uuid, user_name text,
   log_date date, expected int, done int,
   log_status text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is not null
     and coalesce(current_role_name()::text,'') not in ('company_admin','dept_manager') then
    raise exception '權限不足：僅管理者或部門主管可查看部門例行彙總';
  end if;
  if p_to < p_from then raise exception '日期範圍顛倒'; end if;
  if p_to - p_from > 92 then raise exception '一次最多查 92 天'; end if;

  return query
  with d as (
    select generate_series(p_from, p_to, interval '1 day')::date as dt
  ),
  u as (
    select a.id, a.name, a.department_id
      from public.app_user a
     where a.status = 'active'
       and (p_department_id is null or a.department_id = p_department_id)
       and (auth.uid() is null
            or coalesce(current_role_name()::text,'') = 'company_admin'
            or (a.department_id is not null and public.eip_user_can_scope_dept(a.department_id)))
  ),
  exp as (
    select u.id as uid, d.dt, count(*)::int as n
      from u
      cross join d
      join public.personal_routine pr
        on pr.user_id = u.id and pr.is_active and pr.deleted_at is null
     where public.eip_personal_routine_due_on(pr, d.dt)
     group by u.id, d.dt
  ),
  wl as (
    select w.user_id as uid, w.log_date as dt, w.status,
           coalesce(w.routine_morning, '[]'::jsonb) || coalesce(w.routine_afternoon, '[]'::jsonb) as items
      from public.work_log w
     where w.deleted_at is null and w.log_date between p_from and p_to
  ),
  dn as (
    select wl.uid, wl.dt, wl.status,
           coalesce(count(*) filter (
             where (it->>'source') = 'personal_routine'
               and coalesce((it->>'done')::boolean, false)), 0)::int as n
      from wl
      left join lateral jsonb_array_elements(wl.items) it on true
     group by wl.uid, wl.dt, wl.status
  )
  select u.department_id, dp.name, u.id, u.name, d.dt,
         coalesce(exp.n, 0), coalesce(dn.n, 0), dn.status
    from u
    cross join d
    left join public.department dp on dp.id = u.department_id
    left join exp on exp.uid = u.id and exp.dt = d.dt
    left join dn  on dn.uid  = u.id and dn.dt  = d.dt
   where coalesce(exp.n, 0) > 0 or coalesce(dn.n, 0) > 0
   order by dp.name nulls last, u.name, d.dt;
end;
$function$;

grant execute on function public.eip_dept_routine_summary(date, date, uuid) to authenticated;
revoke execute on function public.eip_dept_routine_summary(date, date, uuid) from anon;;
