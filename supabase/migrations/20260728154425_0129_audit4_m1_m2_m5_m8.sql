-- ============================================================
-- 0129 第四輪稽核：M1 / M2 / M5 / M8
-- ============================================================

/* ---------- M1：永久刪除父任務會 CASCADE 硬刪子任務，繞過 purge guard ---------- */
alter table public.task drop constraint task_parent_task_id_fkey;
alter table public.task add constraint task_parent_task_id_fkey
  foreign key (parent_task_id) references public.task(id) on delete set null;

comment on constraint task_parent_task_id_fkey on public.task is
  '從 CASCADE 改成 SET NULL：原本永久刪除父任務會連帶硬刪整棵子任務樹，'
  '子任務的 task_change_log / task_collaborator / task_update 一併消失，'
  '完全繞過 eip_task_purge_guard 與回收區。目前全表 parent_task_id 皆為 null'
  '（子項改用 task_checklist），此變更無資料風險。';

-- guard 補計 task_checklist：別人勾過的子項也算共同產出
create or replace function public.eip_task_purge_guard(p_id uuid)
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_collab int; v_log int; v_upd int; v_chk int; v_child int;
  v_creator uuid; v_parts text[] := '{}';
begin
  select t.created_by into v_creator from public.task t where t.id = p_id;

  select count(*) into v_collab from public.task_collaborator where task_id = p_id;
  select count(*) into v_log    from public.task_change_log   where task_id = p_id;
  select count(*) into v_upd    from public.task_update       where task_id = p_id;
  select count(*) into v_chk    from public.task_checklist
   where task_id = p_id and is_done and done_by is not null
     and (v_creator is null or done_by <> v_creator);
  select count(*) into v_child  from public.task where parent_task_id = p_id;

  if v_collab > 0 then v_parts := v_parts || format('%s 位協作者', v_collab); end if;
  if v_log    > 0 then v_parts := v_parts || format('%s 筆變更紀錄', v_log); end if;
  if v_upd    > 0 then v_parts := v_parts || format('%s 筆進度／狀態回報', v_upd); end if;
  if v_chk    > 0 then v_parts := v_parts || format('%s 項由他人完成的子項', v_chk); end if;
  if v_child  > 0 then v_parts := v_parts || format('%s 筆子任務', v_child); end if;

  if array_length(v_parts, 1) is null then return null; end if;

  return '這筆任務有 ' || array_to_string(v_parts, '、')
      || '，屬於共同產出，不能永久刪除（資料仍保留在回收區，需要時請管理者處理）';
end;
$function$;

revoke all on function public.eip_task_purge_guard(uuid) from public;
grant execute on function public.eip_task_purge_guard(uuid) to authenticated, service_role;


/* ---------- M2：eip.allow_purge 在例外時沒有復位 ---------- */
create or replace function public.eip_purge_deleted(p_module text, p_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r record; v_owner uuid; v_deleted timestamptz; v_me uuid := auth.uid(); v_block text;
begin
  if v_me is null then raise exception '需要登入身分'; end if;

  select * into r from public.eip_deletion_policy where module_key = p_module and is_active;
  if r is null then raise exception '未納管的模組：%', p_module; end if;

  execute format('select %I, deleted_at from public.%I where id = $1', r.creator_col, r.table_name)
    into v_owner, v_deleted using p_id;
  if v_owner is null then raise exception '找不到資料'; end if;
  if v_deleted is null then raise exception '必須先刪除（移入回收區）才能永久刪除'; end if;

  if r.purge_role = 'creator' then
    if v_owner <> v_me and coalesce(current_role_name()::text,'') <> 'company_admin' then
      raise exception '權限不足：永久刪除只有建立者可以執行';
    end if;
  else
    if coalesce(current_role_name()::text,'') <> 'company_admin' then
      raise exception '權限不足：此模組的永久刪除僅限管理者';
    end if;
  end if;

  -- L1：有別人碰過的資料不給永久刪。管理者也一樣受限 ——
  -- 這條規則保護的是稽核軌跡，不是權限層級。要真的清除請走資料庫維護程序。
  if r.purge_guard is not null then
    execute format('select public.%I($1)', r.purge_guard) into v_block using p_id;
    if v_block is not null then raise exception '%', v_block; end if;
  end if;

  -- M2：delete 失敗時 eip.allow_purge 必須復位。
  -- PostgREST 一個請求一個交易、例外會 rollback，但若之後有人把本函式包進
  -- 自己的 exception block 再繼續刪別的東西，殘留的 'on' 會讓軟刪除保護整條失效。
  perform set_config('eip.allow_purge', 'on', true);
  begin
    execute format('delete from public.%I where id = $1', r.table_name) using p_id;
  exception when others then
    perform set_config('eip.allow_purge', 'off', true);
    raise;
  end;
  perform set_config('eip.allow_purge', 'off', true);
end;
$function$;

revoke all on function public.eip_purge_deleted(text, uuid) from public;
grant execute on function public.eip_purge_deleted(text, uuid) to authenticated, service_role;


/* ---------- M5：eip_can_see_task 沒有排除軟刪除，時間軸會漏出已刪任務的歷史 ---------- */
create or replace function public.eip_can_see_task(p_task_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.task t
    where t.id = p_task_id and t.tenant_id = current_tenant_id()
      and t.deleted_at is null
      and (
      current_role_name() = 'company_admin'
      or t.owner_id = auth.uid()
      or t.created_by = auth.uid()
      or t.visibility_scope = 'company'
      or (t.visibility_scope = 'department' and t.department_id is not null
          and public.eip_can_view_dept_record(t.department_id))
      or exists (select 1 from public.task_collaborator tc
                 where tc.task_id = t.id and tc.user_id = auth.uid())
    )
  );
$function$;

revoke all on function public.eip_can_see_task(uuid) from public;
grant execute on function public.eip_can_see_task(uuid) to authenticated, service_role;


/* ---------- M8：績效報表把「期間統計」和「當下狀態」混在同一組欄位 ---------- */
-- OUT 欄位改名，必須先 DROP（42P13）
drop function if exists public.eip_performance_by_dept(date, date);
drop function if exists public.eip_performance_summary(date, date, uuid, uuid);

create function public.eip_performance_summary(
  p_from date, p_to date,
  p_department_id uuid default null, p_user_id uuid default null)
 returns table(
   user_id uuid, user_name text, department_id uuid, department_name text,
   tasks_done integer,                -- 期間內完成（completed_at 落在區間，台北時區）
   tasks_overdue_now integer,         -- 當下逾期（與區間無關）
   tasks_open_now integer,            -- 當下未完成（與區間無關）
   routine_expected integer, routine_done integer, routine_rate numeric,
   worklog_submitted integer, worklog_draft integer,
   meeting_actions_done integer,      -- 期間內會議所開出、已完成的追辦
   meeting_actions_open_now integer,  -- 當下未完成的追辦（與區間無關）
   anomalies_raised integer, anomalies_closed integer, anomalies_unfilled integer)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_me uuid := auth.uid(); v_role text := coalesce(current_role_name()::text, '');
begin
  if v_me is null then raise exception '需要登入身分'; end if;
  if p_to < p_from then raise exception '日期範圍顛倒'; end if;
  if p_to - p_from > 366 then raise exception '一次最多查 366 天'; end if;

  -- 一般員工只能看自己
  if v_role not in ('company_admin','dept_manager') then
    if p_user_id is null then
      p_user_id := v_me;
    elsif p_user_id <> v_me then
      raise exception '權限不足：只能查看自己的績效';
    end if;
  end if;

  return query
  with u as (
    select a.id, a.name, a.department_id
      from public.app_user a
     where a.status = 'active'
       and (p_user_id is null or a.id = p_user_id)
       and (p_department_id is null or a.department_id = p_department_id)
       and (v_role = 'company_admin'
            or a.id = v_me
            or (a.department_id is not null and public.eip_user_can_scope_dept(a.department_id)))
  ),
  d as (select generate_series(p_from, p_to, interval '1 day')::date as dt),
  tk as (
    select t.owner_id as uid,
           count(*) filter (where s.is_done_state
                              and (t.completed_at at time zone 'Asia/Taipei')::date between p_from and p_to)::int as done,
           count(*) filter (where not s.is_done_state
                              and t.due_date is not null
                              and t.due_date < (now() at time zone 'Asia/Taipei')::date)::int as overdue_now,
           count(*) filter (where not s.is_done_state)::int as open_now
      from public.task t
      join public.task_status s on s.id = t.status_id
     where t.deleted_at is null and t.recurring_rule_id is null
     group by t.owner_id
  ),
  rx as (
    select u.id as uid, count(*)::int as n
      from u cross join d
      join public.personal_routine pr
        on pr.user_id = u.id and pr.is_active and pr.deleted_at is null
     where public.eip_personal_routine_due_on(pr, d.dt)
     group by u.id
  ),
  wl as (
    select w.user_id as uid, w.status,
           coalesce(w.routine_morning,'[]'::jsonb) || coalesce(w.routine_afternoon,'[]'::jsonb) as items
      from public.work_log w
     where w.deleted_at is null and w.log_date between p_from and p_to
  ),
  wlagg as (
    select wl.uid,
           count(*) filter (where wl.status = 'submitted')::int as submitted,
           count(*) filter (where wl.status <> 'submitted')::int as draft
      from wl group by wl.uid
  ),
  rd as (
    select wl.uid, count(*)::int as n
      from wl
      cross join lateral jsonb_array_elements(wl.items) it
     where (it->>'source') = 'personal_routine'
       and coalesce((it->>'done')::boolean, false)
     group by wl.uid
  ),
  ma as (
    -- done 用「會議日期落在區間」界定期間歸屬（meeting_action_item 沒有 completed_at，
    -- 用 updated_at 當代理會被任何編輯汙染，所以不用）；open_now 明確是當下狀態。
    select a.owner_id as uid,
           count(*) filter (where a.status = 'done'
                              and (m.meeting_date at time zone 'Asia/Taipei')::date
                                  between p_from and p_to)::int as done,
           count(*) filter (where a.status <> 'done')::int as open_now
      from public.meeting_action_item a
      join public.meeting m on m.id = a.meeting_id
     group by a.owner_id
  ),
  an as (
    select a.subject_id as uid,
           count(*)::int as raised,
           count(*) filter (where a.status = 'closed')::int as closed,
           count(*) filter (where a.status = 'pending_fill')::int as unfilled
      from public.eip_anomaly a
     where a.deleted_at is null and a.occurred_on between p_from and p_to
     group by a.subject_id
  )
  select u.id, u.name, u.department_id, dp.name,
         coalesce(tk.done,0), coalesce(tk.overdue_now,0), coalesce(tk.open_now,0),
         coalesce(rx.n,0), coalesce(rd.n,0),
         case when coalesce(rx.n,0) = 0 then null
              else round(coalesce(rd.n,0)::numeric * 100 / rx.n, 1) end,
         coalesce(wlagg.submitted,0), coalesce(wlagg.draft,0),
         coalesce(ma.done,0), coalesce(ma.open_now,0),
         coalesce(an.raised,0), coalesce(an.closed,0), coalesce(an.unfilled,0)
    from u
    left join public.department dp on dp.id = u.department_id
    left join tk    on tk.uid    = u.id
    left join rx    on rx.uid    = u.id
    left join rd    on rd.uid    = u.id
    left join wlagg on wlagg.uid = u.id
    left join ma    on ma.uid    = u.id
    left join an    on an.uid    = u.id
   order by dp.name nulls last, u.name;
end;
$function$;

revoke all on function public.eip_performance_summary(date, date, uuid, uuid) from public;
grant execute on function public.eip_performance_summary(date, date, uuid, uuid) to authenticated, service_role;

create function public.eip_performance_by_dept(p_from date, p_to date)
 returns table(
   department_id uuid, department_name text, headcount integer,
   tasks_done integer, tasks_overdue_now integer,
   routine_rate numeric, worklog_submit_rate numeric,
   anomalies_raised integer, anomalies_unfilled integer)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_me uuid := auth.uid(); v_role text := coalesce(current_role_name()::text, '');
begin
  if v_me is null then raise exception '需要登入身分'; end if;
  if v_role not in ('company_admin','dept_manager') then
    raise exception '權限不足：僅管理者或部門主管可查看部門績效彙總';
  end if;

  return query
  with p as (select * from public.eip_performance_summary(p_from, p_to))
  select p.department_id, p.department_name, count(*)::int,
         sum(p.tasks_done)::int, sum(p.tasks_overdue_now)::int,
         case when sum(p.routine_expected) = 0 then null
              else round(sum(p.routine_done)::numeric * 100 / sum(p.routine_expected), 1) end,
         case when sum(p.worklog_submitted + p.worklog_draft) = 0 then null
              else round(sum(p.worklog_submitted)::numeric * 100
                         / sum(p.worklog_submitted + p.worklog_draft), 1) end,
         sum(p.anomalies_raised)::int, sum(p.anomalies_unfilled)::int
    from p
   group by p.department_id, p.department_name
   order by p.department_name nulls last;
end;
$function$;

revoke all on function public.eip_performance_by_dept(date, date) from public;
grant execute on function public.eip_performance_by_dept(date, date) to authenticated, service_role;;
