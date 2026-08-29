-- 0095 讓軟刪除的資料在 RLS 層就隱形
--
-- 為什麼不在前端逐一加 .is('deleted_at', null)：
--   全系統有 25 個以上的查詢點分散在十幾個檔案，逐一補容易漏，
--   而且每漏一處就是「刪掉的東西又跑出來」的 bug。
--   改在 RLS 的 SELECT 政策一次擋掉：前端零修改，任何查詢（含將來新寫的）都自動生效。
--
-- 回收區怎麼看得到？eip_deleted_items() 是 SECURITY DEFINER，繞過 RLS，
--   並且在函式內自己限定「只回建立者本人的」，所以不會外洩。

do $$
declare
  r record; p record; v_roles text; v_qual text;
begin
  for r in select table_name from public.eip_deletion_policy where is_active loop
    for p in
      select pol.polname,
             pg_get_expr(pol.polqual, pol.polrelid) as qual,
             pol.polroles
        from pg_policy pol
        join pg_class c on c.oid = pol.polrelid
       where c.relname = r.table_name
         and pol.polcmd = 'r'                      -- 只動 SELECT 政策
    loop
      -- 已經處理過的跳過，讓這支 migration 可以重複執行
      if p.qual is null or p.qual like '%deleted_at%' then
        continue;
      end if;

      select coalesce(string_agg(quote_ident(rolname), ', '), 'public')
        into v_roles
        from pg_roles where oid = any(p.polroles);
      if v_roles is null or v_roles = '' then v_roles := 'public'; end if;

      v_qual := format('((%s) and %I.deleted_at is null)', p.qual, r.table_name);

      execute format('drop policy %I on public.%I', p.polname, r.table_name);
      execute format('create policy %I on public.%I for select to %s using (%s)',
                     p.polname, r.table_name, v_roles, v_qual);

      raise notice '已套用：%.% → %', r.table_name, p.polname, v_qual;
    end loop;
  end loop;
end $$;
;
