-- RLS 效能：將政策中的 auth.uid()/auth.role()/auth.jwt()/auth.email() 包成 (select ...)，避免逐列重算
do $$
declare r record; nq text; nw text; sql text;
begin
  for r in
    select p.polname, c.relname,
           pg_get_expr(p.polqual, p.polrelid) as q,
           pg_get_expr(p.polwithcheck, p.polrelid) as w
    from pg_policy p
    join pg_class c on c.oid=p.polrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
  loop
    if (r.q is not null and r.q ~ 'auth\.(uid|role|jwt|email)\(\)' and r.q !~ 'select auth\.')
       or (r.w is not null and r.w ~ 'auth\.(uid|role|jwt|email)\(\)' and r.w !~ 'select auth\.') then
      nq := regexp_replace(coalesce(r.q,''), 'auth\.(uid|role|jwt|email)\(\)', '(select auth.\1())', 'g');
      nw := regexp_replace(coalesce(r.w,''), 'auth\.(uid|role|jwt|email)\(\)', '(select auth.\1())', 'g');
      sql := format('alter policy %I on public.%I', r.polname, r.relname);
      if r.q is not null then sql := sql || format(' using (%s)', nq); end if;
      if r.w is not null then sql := sql || format(' with check (%s)', nw); end if;
      execute sql;
    end if;
  end loop;
end$$;;
