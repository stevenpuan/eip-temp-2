-- 0093 全系統通用的刪除保存機制
--
-- 需求（2026-07-28）：
--   1. 就算資料被刪除，歷史紀錄也要留存
--   2. 最終要不要永久刪除，由「建立者」決定
--
-- 現況問題：全系統沒有任何軟刪除欄位，刪除就是真的消失；
--   且 task_change_log 對 task 是 ON DELETE CASCADE，
--   刪一個任務會連帶刪掉它的全部變更歷程、協作者、進度更新、子任務。
--
-- 做法：不改前端也生效。在每張主體表掛 BEFORE DELETE trigger，
--   把「硬刪除」轉成「軟刪除」（標記 deleted_at 後取消刪除動作）。
--   只有建立者透過 eip_purge_deleted() 才會真的刪除——那支 RPC 會設定
--   session 旗標 eip.allow_purge，trigger 看到旗標才放行。
--   因此任何前端、任何人都無法繞過保存機制。

/* ---------- ① 登錄表：哪些模組納管、保存多久、誰能永久刪除 ---------- */

create table if not exists public.eip_deletion_policy (
  module_key    text primary key,
  table_name    text not null,
  label         text not null,
  creator_col   text not null,          -- 判斷「建立者」用哪個欄位
  retention_days int,                   -- null = 永久保存，不自動清除
  purge_role    text not null default 'creator'
                check (purge_role in ('creator','admin')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table public.eip_deletion_policy enable row level security;

drop policy if exists edp_read on public.eip_deletion_policy;
create policy edp_read on public.eip_deletion_policy for select using (true);

drop policy if exists edp_admin_write on public.eip_deletion_policy;
create policy edp_admin_write on public.eip_deletion_policy for all
  using (current_role_name() = 'company_admin'::user_role)
  with check (current_role_name() = 'company_admin'::user_role);

insert into public.eip_deletion_policy (module_key, table_name, label, creator_col, retention_days) values
  ('eip_tasks',            'task',                '任務',     'created_by',   null),
  ('eip_announcements',    'announcement',        '公告',     'created_by',   null),
  ('eip_documents',        'eip_document',        '文件',     'created_by',   null),
  ('eip_work_log',         'work_log',            '工作日誌', 'user_id',      null),
  ('eip_quick_reports',    'eip_quick_report',    '臨時回報', 'submitter_id', null),
  ('eip_personal_routine', 'personal_routine',    '個人例行', 'user_id',      null),
  ('eip_calendar',         'personal_event',      '個人行程', 'user_id',      null),
  ('eip_feature_requests', 'eip_feature_request', '需求',     'submitter_id', null)
on conflict (module_key) do nothing;

/* ---------- ② 每張表加軟刪除欄位 ---------- */

do $$
declare r record;
begin
  for r in select table_name from public.eip_deletion_policy where is_active loop
    execute format(
      'alter table public.%I
         add column if not exists deleted_at timestamptz,
         add column if not exists deleted_by uuid references public.app_user(id) on delete set null',
      r.table_name);
    execute format(
      'create index if not exists %I on public.%I (deleted_at) where deleted_at is not null',
      'idx_' || r.table_name || '_deleted_at', r.table_name);
  end loop;
end $$;

/* ---------- ③ 通用守門 trigger：硬刪轉軟刪 ---------- */

create or replace function public.eip_soft_delete_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_already timestamptz;
begin
  -- 建立者透過 eip_purge_deleted() 永久刪除時會設這個旗標，放行真正的 DELETE
  if coalesce(current_setting('eip.allow_purge', true), '') = 'on' then
    return old;
  end if;

  execute format('select deleted_at from public.%I where id = $1', tg_table_name)
    into v_already using old.id;

  -- 已經是軟刪除狀態又被刪一次：不重複覆寫時間，仍然擋下
  if v_already is null then
    execute format(
      'update public.%I set deleted_at = now(), deleted_by = $1 where id = $2',
      tg_table_name) using auth.uid(), old.id;
  end if;

  return null;   -- 取消這次 DELETE，資料保留
end;
$function$;

revoke all on function public.eip_soft_delete_guard() from public, anon, authenticated;

do $$
declare r record;
begin
  for r in select table_name from public.eip_deletion_policy where is_active loop
    execute format('drop trigger if exists trg_soft_delete_guard on public.%I', r.table_name);
    execute format(
      'create trigger trg_soft_delete_guard before delete on public.%I
         for each row execute function public.eip_soft_delete_guard()',
      r.table_name);
  end loop;
end $$;

/* ---------- ④ 回收區：建立者看自己刪掉的東西 ---------- */

create or replace function public.eip_deleted_items(p_module text default null)
returns table (
  module_key text, label text, item_id uuid, title text,
  deleted_at timestamptz, deleted_by_name text, can_purge boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  r record; v_me uuid := auth.uid(); v_is_admin boolean;
  v_title_col text; v_sql text;
begin
  if v_me is null then return; end if;
  v_is_admin := coalesce(current_role_name()::text,'') = 'company_admin';

  for r in
    select * from public.eip_deletion_policy
     where is_active and (p_module is null or module_key = p_module)
  loop
    -- 各表的「標題」欄位名稱不一致，逐一對應
    v_title_col := case r.table_name
      when 'work_log'         then 'log_date::text'
      when 'eip_quick_report' then 'coalesce(detail, type)'
      when 'personal_event'   then 'title'
      else 'title' end;

    v_sql := format($f$
      select %L::text, %L::text, t.id, (%s)::text, t.deleted_at,
             (select name from public.app_user where id = t.deleted_by),
             (t.%I = $1 or $2)
        from public.%I t
       where t.deleted_at is not null
         and (t.%I = $1 or $2)
    $f$, r.module_key, r.label, v_title_col, r.creator_col, r.table_name, r.creator_col);

    return query execute v_sql using v_me, v_is_admin;
  end loop;
end;
$function$;

revoke all on function public.eip_deleted_items(text) from public, anon;
grant execute on function public.eip_deleted_items(text) to authenticated;

/* ---------- ⑤ 還原 ---------- */

create or replace function public.eip_restore_deleted(p_module text, p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r record; v_owner uuid; v_me uuid := auth.uid();
begin
  select * into r from public.eip_deletion_policy where module_key = p_module and is_active;
  if r is null then raise exception '未納管的模組：%', p_module; end if;

  execute format('select %I from public.%I where id = $1', r.creator_col, r.table_name)
    into v_owner using p_id;
  if v_owner is null then raise exception '找不到資料'; end if;

  if v_owner <> v_me and coalesce(current_role_name()::text,'') <> 'company_admin' then
    raise exception '權限不足：只有建立者可以還原';
  end if;

  execute format('update public.%I set deleted_at = null, deleted_by = null where id = $1',
                 r.table_name) using p_id;
end;
$function$;

revoke all on function public.eip_restore_deleted(text, uuid) from public, anon;
grant execute on function public.eip_restore_deleted(text, uuid) to authenticated;

/* ---------- ⑥ 永久刪除：只有建立者（或管理者）可以 ---------- */

create or replace function public.eip_purge_deleted(p_module text, p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r record; v_owner uuid; v_deleted timestamptz; v_me uuid := auth.uid();
begin
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

  -- 放行 trigger，執行真正的刪除（連帶的子表由既有 CASCADE 處理，
  -- 這是建立者的明確決定：連歷史紀錄一起清掉）
  perform set_config('eip.allow_purge', 'on', true);
  execute format('delete from public.%I where id = $1', r.table_name) using p_id;
  perform set_config('eip.allow_purge', 'off', true);
end;
$function$;

revoke all on function public.eip_purge_deleted(text, uuid) from public, anon;
grant execute on function public.eip_purge_deleted(text, uuid) to authenticated;

comment on table public.eip_deletion_policy is
  '刪除保存機制的登錄表。新模組要納管，在這裡加一列並重跑 0093 的 trigger 建立區塊即可。';
;
