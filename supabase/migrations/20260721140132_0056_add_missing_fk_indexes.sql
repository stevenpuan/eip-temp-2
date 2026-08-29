-- 為所有缺覆蓋索引的外鍵欄位建立索引（冪等、安全、additive）
do $$
declare r record; idx text;
begin
  for r in
    select c.conrelid::regclass::text as tbl, a.attname as col, k.attnum
    from pg_constraint c
    join lateral unnest(c.conkey) with ordinality as k(attnum, ord) on true
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
    where c.contype='f' and c.connamespace='public'::regnamespace
      and not exists (
        select 1 from pg_index i
        where i.indrelid=c.conrelid and (i.indkey::int2[])[0]=k.attnum)
  loop
    idx := 'ix_'||replace(r.tbl,'public.','')||'_'||r.col;
    execute format('create index if not exists %I on public.%I (%I)', idx, replace(r.tbl,'public.',''), r.col);
  end loop;
end$$;;
