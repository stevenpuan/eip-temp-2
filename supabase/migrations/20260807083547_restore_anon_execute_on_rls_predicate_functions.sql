-- 修正：未登入/token 過期時，RLS 政策直接呼叫的判定函式若 anon 無 EXECUTE，
-- 會噴 42501 "permission denied for function ..."（使用者看到紅字而非「請重新登入」）。
-- 這些函式皆為唯讀判定/身分讀取器，對 anon 回傳 false/NULL → 政策評為 false → 回 0 列（fail-closed）。
-- 純新增授權、可逆（revoke 即回復）。自我修正：只補「有出現在政策且 anon 目前不可執行」者。
do $$
declare r record; cnt int := 0;
begin
  for r in
    select distinct p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f'
      and exists (
        select 1 from pg_policies pol
        where pol.schemaname='public'
          and (coalesce(pol.qual,'')||' '||coalesce(pol.with_check,'')) like '%'||p.proname||'(%'
      )
      and not has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('grant execute on function public.%I(%s) to anon', r.proname, r.args);
    cnt := cnt + 1;
    raise notice 'granted anon EXECUTE on %(%)', r.proname, r.args;
  end loop;
  raise notice '共補授 % 支函式', cnt;
end $$;;
