-- 0124 L1 定案：永久刪除的保護規則
--
-- Steven 的決定：「有協同者、有編輯和狀態的資料，不能刪。」
-- 也就是說：只有「沒有別人碰過」的資料，建立者才能永久刪除。
-- 一旦有協作者、有欄位變更紀錄、有進度/狀態回報，就代表這筆資料是共同產出，
-- 建立者不能單方面把稽核軌跡清掉 —— 但仍然留在回收區，需要時由管理者處理。
--
-- 做法：eip_deletion_policy 加一個 purge_guard 欄位，放「檢查函式名稱」。
--       函式吃 uuid、回 text：null 代表可以刪，非 null 就是不能刪的原因。
--       這樣未來要為其他模組加保護，只要寫一支函式 + 更新一列設定，不用再改 eip_purge_deleted。

alter table public.eip_deletion_policy
  add column if not exists purge_guard text;

comment on column public.eip_deletion_policy.purge_guard is
  '永久刪除前的檢查函式名稱（吃 uuid、回 text）。回 null 代表可刪，回文字就是拒絕原因。null 表示不檢查';

------------------------------------------------------------------
-- 任務的保護規則
------------------------------------------------------------------
create or replace function public.eip_task_purge_guard(p_id uuid)
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_collab int; v_log int; v_upd int; v_parts text[] := '{}';
begin
  select count(*) into v_collab from public.task_collaborator where task_id = p_id;
  select count(*) into v_log    from public.task_change_log   where task_id = p_id;
  select count(*) into v_upd    from public.task_update       where task_id = p_id;

  if v_collab > 0 then v_parts := v_parts || format('%s 位協作者', v_collab); end if;
  if v_log    > 0 then v_parts := v_parts || format('%s 筆變更紀錄', v_log); end if;
  if v_upd    > 0 then v_parts := v_parts || format('%s 筆進度／狀態回報', v_upd); end if;

  if array_length(v_parts, 1) is null then return null; end if;

  return '這筆任務有 ' || array_to_string(v_parts, '、')
      || '，屬於共同產出，不能永久刪除（資料仍保留在回收區，需要時請管理者處理）';
end;
$function$;

revoke execute on function public.eip_task_purge_guard(uuid) from public, anon;
grant execute on function public.eip_task_purge_guard(uuid) to authenticated;

update public.eip_deletion_policy
   set purge_guard = 'eip_task_purge_guard'
 where module_key = 'eip_tasks';

------------------------------------------------------------------
-- 工作日誌同理：主管看過（reviewed_by）或有附件就不是單純的個人草稿
------------------------------------------------------------------
create or replace function public.eip_work_log_purge_guard(p_id uuid)
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_status text; v_reviewed uuid; v_att int;
begin
  select status, reviewed_by into v_status, v_reviewed from public.work_log where id = p_id;
  select count(*) into v_att from public.work_log_attachment where work_log_id = p_id;

  if v_reviewed is not null then
    return '這份日誌主管已經看過，不能永久刪除（資料仍保留在回收區）';
  end if;
  if v_status = 'submitted' then
    return '這份日誌已送出，不能永久刪除（資料仍保留在回收區）';
  end if;
  if v_att > 0 then
    return format('這份日誌有 %s 個附件，請先移除附件再永久刪除', v_att);
  end if;
  return null;
end;
$function$;

revoke execute on function public.eip_work_log_purge_guard(uuid) from public, anon;
grant execute on function public.eip_work_log_purge_guard(uuid) to authenticated;

update public.eip_deletion_policy
   set purge_guard = 'eip_work_log_purge_guard'
 where module_key = 'eip_work_log';

------------------------------------------------------------------
-- eip_purge_deleted：在權限檢查通過之後、真正刪除之前，跑 purge_guard
------------------------------------------------------------------
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

  perform set_config('eip.allow_purge', 'on', true);
  execute format('delete from public.%I where id = $1', r.table_name) using p_id;
  perform set_config('eip.allow_purge', 'off', true);
end;
$function$;

revoke execute on function public.eip_purge_deleted(text, uuid) from public, anon;
grant execute on function public.eip_purge_deleted(text, uuid) to authenticated;

------------------------------------------------------------------
-- eip_deleted_items：多回一個 purge_block 欄位，讓前端能把按鈕變灰並說明原因，
-- 而不是讓使用者按下去才吃一個例外。
------------------------------------------------------------------
drop function if exists public.eip_deleted_items(text);

create or replace function public.eip_deleted_items(p_module text default null::text)
 returns table(module_key text, label text, item_id uuid, title text,
               deleted_at timestamptz, deleted_by_name text,
               can_purge boolean, purge_block text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  r record; v_me uuid := auth.uid(); v_is_admin boolean;
  v_title_col text; v_sql text; v_guard text;
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

    -- 沒有 guard 的模組直接回 null，不必為每一列多跑一次查詢
    v_guard := case when r.purge_guard is null then 'null::text'
                    else format('public.%I(t.id)', r.purge_guard) end;

    v_sql := format($f$
      select %L::text, %L::text, t.id, (%s)::text, t.deleted_at,
             (select name from public.app_user where id = t.deleted_by),
             (t.%I = $1 or $2),
             %s
        from public.%I t
       where t.deleted_at is not null
         and (t.%I = $1 or $2)
    $f$, r.module_key, r.label, v_title_col, r.creator_col, v_guard,
         r.table_name, r.creator_col);

    return query execute v_sql using v_me, v_is_admin;
  end loop;
end;
$function$;

revoke execute on function public.eip_deleted_items(text) from public, anon;
grant execute on function public.eip_deleted_items(text) to authenticated;;
