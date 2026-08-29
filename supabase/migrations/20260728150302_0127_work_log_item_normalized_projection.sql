-- 0127 批6：work_log_item 正規化
--
-- 目的：日誌項目目前鎖在 work_log 的三個 jsonb 欄位裡（routine_morning /
--       routine_afternoon / special_items），沒辦法 join、沒辦法建索引，
--       報表要靠 jsonb_array_elements 硬拆（eip_dept_routine_summary、
--       eip_performance_summary 都在拆）。
--
-- 做法選擇（重要）：**做成「由 JSON 衍生的投影表」，不是把主資料搬過去。**
--   ・trigger 在 work_log 寫入後重新物化 work_log_item，JSON 仍是唯一真相來源
--   ・因此前端完全不用改，也沒有雙寫不一致的風險
--   ・要回退只要 drop trigger + drop table，正式資料一行都沒動
--   離上線 3 天，這是能拿到「可查詢、可索引、可 join」的好處而風險最低的形狀。
--   上線後要把讀取切過來、再退役 JSON 欄位，是獨立的下一步。

create table if not exists public.work_log_item (
  id           uuid primary key default gen_random_uuid(),
  work_log_id  uuid not null references public.work_log(id) on delete cascade,
  section      text not null,
  sort_order   int  not null default 0,
  text         text,
  done         boolean not null default false,
  note         text,
  source       text,
  ref_id       uuid,
  link         text,
  require_content boolean not null default false,
  constraint work_log_item_section_chk check (section in ('morning','afternoon','special'))
);

comment on table public.work_log_item is
  '工作日誌項目的正規化投影。真相來源仍是 work_log 的三個 jsonb 欄位，'
  '由 trg_work_log_materialize_items 在每次寫入後重新物化。不要直接寫這張表。';

create index if not exists idx_wli_log     on public.work_log_item(work_log_id, section, sort_order);
create index if not exists idx_wli_source  on public.work_log_item(source, ref_id) where source is not null;
create index if not exists idx_wli_done    on public.work_log_item(work_log_id) where done;

------------------------------------------------------------------
-- 物化函式：把一筆 work_log 的三個 jsonb 拆成列
------------------------------------------------------------------
create or replace function public.eip_materialize_work_log_items(p_log_id uuid)
 returns int
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_n int := 0;
begin
  delete from public.work_log_item where work_log_id = p_log_id;

  insert into public.work_log_item
    (work_log_id, section, sort_order, text, done, note, source, ref_id, link, require_content)
  select p_log_id,
         s.section,
         (it.ord - 1)::int,
         nullif(it.value ->> 'text', ''),
         coalesce((it.value ->> 'done')::boolean, false),
         nullif(it.value ->> 'note', ''),
         nullif(it.value ->> 'source', ''),
         -- ref_id 在 JSON 裡是字串，可能是空字串或非 uuid，不能硬轉
         case when (it.value ->> 'ref_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
              then (it.value ->> 'ref_id')::uuid else null end,
         nullif(it.value ->> 'link', ''),
         coalesce((it.value ->> 'req')::boolean, false)
    from public.work_log w
    cross join lateral (values
      ('morning',   coalesce(w.routine_morning,   '[]'::jsonb)),
      ('afternoon', coalesce(w.routine_afternoon, '[]'::jsonb)),
      ('special',   coalesce(w.special_items,     '[]'::jsonb))
    ) s(section, arr)
    cross join lateral jsonb_array_elements(s.arr) with ordinality as it(value, ord)
   where w.id = p_log_id
     and jsonb_typeof(s.arr) = 'array';

  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke execute on function public.eip_materialize_work_log_items(uuid) from public, anon, authenticated;

create or replace function public.eip_work_log_materialize_trg()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- 內容沒變就不用重跑（軟刪除、送出時間等更新會走到這裡）
  if tg_op = 'UPDATE'
     and new.routine_morning   is not distinct from old.routine_morning
     and new.routine_afternoon is not distinct from old.routine_afternoon
     and new.special_items     is not distinct from old.special_items then
    return null;
  end if;
  perform public.eip_materialize_work_log_items(new.id);
  return null;
end;
$function$;

revoke execute on function public.eip_work_log_materialize_trg() from public, anon, authenticated;

drop trigger if exists trg_work_log_materialize_items on public.work_log;
create trigger trg_work_log_materialize_items
  after insert or update of routine_morning, routine_afternoon, special_items
  on public.work_log
  for each row execute function public.eip_work_log_materialize_trg();

------------------------------------------------------------------
-- 回填既有 32 筆日誌
------------------------------------------------------------------
do $$
declare r record; v_total int := 0;
begin
  for r in select id from public.work_log loop
    v_total := v_total + public.eip_materialize_work_log_items(r.id);
  end loop;
  raise notice '回填 % 筆項目', v_total;
end $$;

------------------------------------------------------------------
-- RLS：可見範圍完全跟隨母日誌（同 task_checklist 的做法，
-- 政策內的 work_log 子查詢會套用 work_log 自己的 RLS）。
-- 這張表是投影，前端不該寫入，所以只開 SELECT。
------------------------------------------------------------------
alter table public.work_log_item enable row level security;

drop policy if exists wli_read on public.work_log_item;
create policy wli_read on public.work_log_item
  for select to authenticated
  using (exists (select 1 from public.work_log w where w.id = work_log_item.work_log_id));

revoke all on public.work_log_item from anon, authenticated;
grant select on public.work_log_item to authenticated;;
