-- ============================================================
-- 0133 回收區整頁 500：eip_deleted_items 的 module_key 有歧義
--
-- RETURNS TABLE 的 OUT 欄位（module_key / label / title / deleted_at）
-- 在 plpgsql 裡就是變數，跟迴圈查詢的 eip_deletion_policy.module_key 撞名
-- → 42702 column reference "module_key" is ambiguous，整支函式無論帶不帶
-- p_module 都直接炸掉，也就是「回收區」頁面完全打不開。
--
-- 修法：迴圈查詢一律加表別名 dp.，不依賴 plpgsql 的解析順序。
-- ============================================================
create or replace function public.eip_deleted_items(p_module text default null)
 returns table(module_key text, label text, item_id uuid, title text,
               deleted_at timestamp with time zone, deleted_by_name text,
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
    select dp.* from public.eip_deletion_policy dp
     where dp.is_active and (p_module is null or dp.module_key = p_module)
     order by dp.module_key
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

revoke all on function public.eip_deleted_items(text) from public, anon;
grant execute on function public.eip_deleted_items(text) to authenticated, service_role;;
