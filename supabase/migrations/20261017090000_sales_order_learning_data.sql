-- 訂單接收 v5：AI 學習資料
--   1. 歷史銷貨（從凌越匯入，只用來學習，不算進 EIP 業績）
--   2. 客戶常訂品項（歷史銷貨＋已確認訂單計算：次數、慣用單位、平均／最大量、上次數量與價格）
--   3. 客戶專屬說法（同一句話在不同客戶代表不同品項）——取代原本「全公司共用」的品項別名學習
--   4. 說法對照表（全公司口語→意思，預放常見說法）
--   5. 範例訊息（老闆原文→正確結果，AI 解析時參考）
-- 2026-10-17；已套用到 Supabase 專案 tjkeycrbgkyvlxwywyvt

-- ── 1. 歷史銷貨
create table if not exists public.eip_sales_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  customer_id uuid not null references public.eip_customer(id) on delete cascade,
  product_id uuid not null references public.eip_product(id) on delete cascade,
  sale_date date not null,
  doc_no text,
  qty numeric(14,3) not null check (qty > 0),
  unit text,
  unit_price numeric(14,2),
  imported_by uuid default auth.uid() references public.app_user(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists eip_sales_history_cust_idx on public.eip_sales_history (customer_id, sale_date desc);
create index if not exists eip_sales_history_prod_idx on public.eip_sales_history (product_id);
create index if not exists eip_sales_history_tenant_idx on public.eip_sales_history (tenant_id, sale_date desc);
create index if not exists eip_sales_history_user_idx on public.eip_sales_history (imported_by);

-- ── 2. 客戶常訂品項（數量統計一律換成品項主單位）
create table if not exists public.eip_customer_product_profile (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  customer_id uuid not null references public.eip_customer(id) on delete cascade,
  product_id uuid not null references public.eip_product(id) on delete cascade,
  order_count int not null default 0,
  base_unit text,
  avg_base_qty numeric(14,3),
  max_base_qty numeric(14,3),
  usual_unit text,
  last_qty numeric(14,3),
  last_unit text,
  last_price numeric(14,2),
  last_date date,
  is_hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (customer_id, product_id)
);
create index if not exists eip_cpp_tenant_idx on public.eip_customer_product_profile (tenant_id);
create index if not exists eip_cpp_product_idx on public.eip_customer_product_profile (product_id);

-- ── 3. 客戶專屬說法
create table if not exists public.eip_customer_product_alias (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  customer_id uuid not null references public.eip_customer(id) on delete cascade,
  product_id uuid not null references public.eip_product(id) on delete cascade,
  alias text not null check (btrim(alias) <> ''),
  source text not null default 'manual' check (source in ('manual','learned')),
  created_by uuid default auth.uid() references public.app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists eip_cpa_uq on public.eip_customer_product_alias (customer_id, lower(btrim(alias)));
create index if not exists eip_cpa_tenant_idx on public.eip_customer_product_alias (tenant_id);
create index if not exists eip_cpa_product_idx on public.eip_customer_product_alias (product_id);
create index if not exists eip_cpa_user_idx on public.eip_customer_product_alias (created_by);

-- ── 4. 說法對照表
create table if not exists public.eip_order_phrase (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  phrase text not null check (btrim(phrase) <> ''),
  meaning text not null check (btrim(meaning) <> ''),
  is_active boolean not null default true,
  sort_order int not null default 100,
  updated_by uuid default auth.uid() references public.app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists eip_order_phrase_uq on public.eip_order_phrase (tenant_id, lower(btrim(phrase)));
create index if not exists eip_order_phrase_user_idx on public.eip_order_phrase (updated_by);

-- ── 5. 範例訊息
create table if not exists public.eip_order_example (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  customer_id uuid references public.eip_customer(id) on delete set null,
  order_id uuid unique references public.eip_sales_order(id) on delete set null,
  input_text text not null check (btrim(input_text) <> ''),
  expected_text text not null check (btrim(expected_text) <> ''),
  message_date date,
  source text not null default 'manual' check (source in ('order','manual','test')),
  is_active boolean not null default true,
  created_by uuid default auth.uid() references public.app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists eip_order_example_tenant_idx on public.eip_order_example (tenant_id, created_at desc);
create index if not exists eip_order_example_cust_idx on public.eip_order_example (customer_id);
create index if not exists eip_order_example_user_idx on public.eip_order_example (created_by);

alter table public.eip_sales_order_setting
  add column if not exists learn_examples boolean not null default true;

-- ── RLS：看＝訂單或主檔檢視；改＝主檔或訂單編輯（與價格、地址一致）
do $$
declare t text;
begin
  foreach t in array array['eip_sales_history','eip_customer_product_profile','eip_customer_product_alias','eip_order_phrase','eip_order_example'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (tenant_id = public.current_tenant_id() and (public.eip_has_perm('eip_sales_order','view') or public.eip_has_perm('eip_order_master','view')))$p$, t || '_select', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using (tenant_id = public.current_tenant_id() and (public.eip_has_perm('eip_order_master','edit') or public.eip_has_perm('eip_sales_order','edit')))
      with check (tenant_id = public.current_tenant_id() and (public.eip_has_perm('eip_order_master','edit') or public.eip_has_perm('eip_order_master','create') or public.eip_has_perm('eip_sales_order','edit')))$p$, t || '_write', t);
  end loop;
end $$;

create trigger trg_eip_cpa_touch before update on public.eip_customer_product_alias for each row execute function public.eip_touch_updated_at();
create trigger trg_eip_order_phrase_touch before update on public.eip_order_phrase for each row execute function public.eip_touch_updated_at();
create trigger trg_eip_order_example_touch before update on public.eip_order_example for each row execute function public.eip_touch_updated_at();

-- ── 常訂品項重算：近 365 天的歷史銷貨＋已確認訂單（同一單號／訂單算一次）
create or replace function public.eip_rebuild_customer_profile(p_tenant uuid, p_customer uuid default null)
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_cut date := (now() at time zone 'Asia/Taipei')::date - 365; n int;
begin
  with src as (
    select h.customer_id, h.product_id, 'H:' || coalesce(nullif(btrim(h.doc_no), ''), h.sale_date::text) as occ,
           h.sale_date as d, h.qty, nullif(btrim(h.unit), '') as unit, h.unit_price, h.created_at as ts
      from public.eip_sales_history h
     where h.tenant_id = p_tenant and (p_customer is null or h.customer_id = p_customer) and h.sale_date >= v_cut
    union all
    select o.customer_id, l.product_id, 'O:' || o.id::text, coalesce(o.order_date, (o.created_at at time zone 'Asia/Taipei')::date),
           l.qty, nullif(btrim(l.unit), ''), l.unit_price, coalesce(o.reviewed_at, o.updated_at)
      from public.eip_sales_order o join public.eip_sales_order_line l on l.order_id = o.id
     where o.tenant_id = p_tenant and o.status = 'confirmed' and o.deleted_at is null
       and o.customer_id is not null and l.product_id is not null and l.qty > 0
       and (p_customer is null or o.customer_id = p_customer)
       and coalesce(o.order_date, (o.created_at at time zone 'Asia/Taipei')::date) >= v_cut
  ),
  conv as (
    select s.*, p.unit as base_unit, coalesce(s.unit, p.unit) as eff_unit,
           case when s.unit is null or s.unit = p.unit then 1::numeric else u.ratio end as ratio
      from src s join public.eip_product p on p.id = s.product_id
      left join public.eip_product_unit u on u.product_id = s.product_id and u.unit = s.unit
  ),
  occ as (
    select customer_id, product_id, occ,
           case when bool_and(ratio is not null) then sum(qty * ratio) end as base_qty
      from conv group by 1, 2, 3
  ),
  agg as (
    select customer_id, product_id, count(*)::int as cnt, round(avg(base_qty), 3) as avg_q, max(base_qty) as max_q
      from occ group by 1, 2
  ),
  um as (
    select customer_id, product_id, max(base_unit) as base_unit, mode() within group (order by eff_unit) as usual_unit
      from conv group by 1, 2
  ),
  lr as (
    select distinct on (customer_id, product_id) customer_id, product_id, qty, eff_unit, unit_price, d
      from conv order by customer_id, product_id, d desc, ts desc
  ),
  up as (
    insert into public.eip_customer_product_profile as pr
           (tenant_id, customer_id, product_id, order_count, base_unit, avg_base_qty, max_base_qty, usual_unit, last_qty, last_unit, last_price, last_date, updated_at)
    select p_tenant, a.customer_id, a.product_id, a.cnt, um.base_unit, a.avg_q, a.max_q, um.usual_unit, lr.qty, lr.eff_unit, lr.unit_price, lr.d, now()
      from agg a join um using (customer_id, product_id) join lr using (customer_id, product_id)
    on conflict (customer_id, product_id) do update set
      order_count = excluded.order_count, base_unit = excluded.base_unit, avg_base_qty = excluded.avg_base_qty,
      max_base_qty = excluded.max_base_qty, usual_unit = excluded.usual_unit, last_qty = excluded.last_qty,
      last_unit = excluded.last_unit, last_price = excluded.last_price, last_date = excluded.last_date, updated_at = now()
    returning pr.customer_id, pr.product_id
  ),
  stale as (
    -- 這次沒有任何紀錄的品項：統計歸零（讀取時只看 order_count > 0；手動隱藏設定保留）
    update public.eip_customer_product_profile pr
       set order_count = 0, avg_base_qty = null, max_base_qty = null, updated_at = now()
     where pr.tenant_id = p_tenant and (p_customer is null or pr.customer_id = p_customer) and pr.order_count > 0
       and not exists (select 1 from agg a where a.customer_id = pr.customer_id and a.product_id = pr.product_id)
    returning 1
  )
  select (select count(*) from up) into n;
  return n;
end $$;
revoke all on function public.eip_rebuild_customer_profile(uuid, uuid) from public, anon, authenticated;

-- ── 匯入歷史銷貨（前端分批呼叫；第一批 p_replace=true 會先清掉上次匯入的資料）
create or replace function public.eip_import_sales_history(p_rows jsonb, p_replace boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_tenant uuid := public.current_tenant_id(); n int; total int := coalesce(jsonb_array_length(p_rows), 0);
begin
  if v_tenant is null or not (public.eip_has_perm('eip_order_master','edit') or public.eip_has_perm('eip_order_master','create')) then
    raise exception '沒有主檔匯入權限';
  end if;
  if total > 5000 then raise exception '一次最多 5000 筆，請分批'; end if;
  if p_replace then delete from public.eip_sales_history where tenant_id = v_tenant; end if;
  insert into public.eip_sales_history (tenant_id, customer_id, product_id, sale_date, doc_no, qty, unit, unit_price, imported_by)
  select v_tenant, c.id, p.id, (r->>'date')::date, nullif(btrim(r->>'doc_no'), ''), (r->>'qty')::numeric,
         nullif(btrim(r->>'unit'), ''), nullif(r->>'unit_price', '')::numeric, auth.uid()
    from jsonb_array_elements(p_rows) r
    join public.eip_customer c on c.tenant_id = v_tenant and lower(c.code) = lower(btrim(r->>'customer_code'))
    join public.eip_product p on p.tenant_id = v_tenant and lower(p.code) = lower(btrim(r->>'product_code'))
   where coalesce(r->>'date', '') ~ '^\d{4}-\d{2}-\d{2}$'
     and coalesce(r->>'qty', '') ~ '^\d+(\.\d+)?$' and (r->>'qty')::numeric > 0
     and (coalesce(r->>'unit_price', '') = '' or (r->>'unit_price') ~ '^\d+(\.\d+)?$');
  get diagnostics n = row_count;
  return jsonb_build_object('inserted', n, 'skipped', total - n);
end $$;
revoke all on function public.eip_import_sales_history(jsonb, boolean) from public, anon;
grant execute on function public.eip_import_sales_history(jsonb, boolean) to authenticated;

-- ── 匯入完成：重算常訂品項；歷史最近成交價補進「最近成交價」（不覆蓋訂單學到的、也不動合約價）
create or replace function public.eip_finish_sales_history_import()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_tenant uuid := public.current_tenant_id(); v_learn boolean; n_prof int; n_price int := 0; n_hist int;
begin
  if v_tenant is null or not (public.eip_has_perm('eip_order_master','edit') or public.eip_has_perm('eip_order_master','create')) then
    raise exception '沒有主檔匯入權限';
  end if;
  n_prof := public.eip_rebuild_customer_profile(v_tenant, null);
  select count(*) into n_hist from public.eip_sales_history where tenant_id = v_tenant;
  select coalesce(learn_last_price, true) into v_learn from public.eip_sales_order_setting where tenant_id = v_tenant;
  if coalesce(v_learn, true) then
    with last_price as (
      select distinct on (h.customer_id, h.product_id, coalesce(h.unit, p.unit))
             h.customer_id, h.product_id, coalesce(h.unit, p.unit) as unit, h.unit_price, h.sale_date
        from public.eip_sales_history h join public.eip_product p on p.id = h.product_id
       where h.tenant_id = v_tenant and h.unit_price is not null
       order by h.customer_id, h.product_id, coalesce(h.unit, p.unit), h.sale_date desc, h.created_at desc
    ), upd as (
      update public.eip_customer_price cp set unit_price = lp.unit_price, updated_at = now(), updated_by = auth.uid(),
             note = '凌越歷史 ' || to_char(lp.sale_date, 'YYYY-MM-DD')
        from last_price lp
       where cp.customer_id = lp.customer_id and cp.product_id = lp.product_id and coalesce(cp.unit, '') = coalesce(lp.unit, '')
         and cp.source = 'last_order' and cp.last_order_id is null
      returning cp.id
    ), ins as (
      insert into public.eip_customer_price (tenant_id, customer_id, product_id, unit, unit_price, source, note, updated_by)
      select v_tenant, lp.customer_id, lp.product_id, lp.unit, lp.unit_price, 'last_order', '凌越歷史 ' || to_char(lp.sale_date, 'YYYY-MM-DD'), auth.uid()
        from last_price lp
       where not exists (select 1 from public.eip_customer_price cp where cp.customer_id = lp.customer_id and cp.product_id = lp.product_id
                          and coalesce(cp.unit, '') = coalesce(lp.unit, '') and cp.source = 'last_order')
      returning id
    )
    select (select count(*) from upd) + (select count(*) from ins) into n_price;
  end if;
  return jsonb_build_object('history_rows', n_hist, 'profile_items', n_prof, 'prices', n_price);
end $$;
revoke all on function public.eip_finish_sales_history_import() from public, anon;
grant execute on function public.eip_finish_sales_history_import() to authenticated;

-- ── 手動重算（主檔頁按鈕）
create or replace function public.eip_refresh_customer_profiles()
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null or not (public.eip_has_perm('eip_order_master','edit') or public.eip_has_perm('eip_sales_order','edit')) then
    raise exception '沒有權限';
  end if;
  return public.eip_rebuild_customer_profile(v_tenant, null);
end $$;
revoke all on function public.eip_refresh_customer_profiles() from public, anon;
grant execute on function public.eip_refresh_customer_profiles() to authenticated;

-- ── 範例訊息的「正確結果」文字（由已確認訂單組成）
create or replace function public.eip_order_example_text(p_order uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select concat_ws(E'\n',
    '客戶：' || coalesce(nullif(concat_ws(' ', c.code, c.name), ''), o.customer_text, '（未指定）'),
    '交期：' || coalesce(to_char(o.delivery_date, 'YYYY-MM-DD') || '（週' || substr('日一二三四五六', extract(dow from o.delivery_date)::int + 1, 1) || '）', '未指定'),
    case when a.label is not null then '送貨：' || a.label end,
    (select string_agg(l.line_no || '. ' || concat_ws(' ', p.code, coalesce(p.name, l.product_text)) || ' ' || trim_scale(l.qty)::text || coalesce(l.unit, ''), E'\n' order by l.line_no)
       from public.eip_sales_order_line l left join public.eip_product p on p.id = l.product_id
      where l.order_id = o.id),
    case when nullif(btrim(o.note), '') is not null then '備註：' || o.note end)
    from public.eip_sales_order o
    left join public.eip_customer c on c.id = o.customer_id
    left join public.eip_customer_address a on a.id = o.customer_address_id
   where o.id = p_order
$$;
revoke all on function public.eip_order_example_text(uuid) from public, anon, authenticated;

-- ── 覆核確認時的學習（修正）：
--   客戶名稱：只學「不會跟其他客戶混淆」的說法
--   品項說法：改記在這個客戶底下（客戶專屬說法），不再加到全公司別名
--   另外：重算這個客戶的常訂品項、LINE 原文存成範例訊息
create or replace function public.eip_sales_order_learn(p_order uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare o record; l record; t text; v_learn boolean; v_examples boolean; v_text text;
begin
  select * into o from public.eip_sales_order where id = p_order;
  if not found then return; end if;
  select coalesce(learn_last_price, true), coalesce(learn_examples, true) into v_learn, v_examples
    from public.eip_sales_order_setting where tenant_id = o.tenant_id;
  v_learn := coalesce(v_learn, true); v_examples := coalesce(v_examples, true);

  if o.customer_id is not null and nullif(btrim(o.customer_text), '') is not null then
    t := btrim(o.customer_text);
    if char_length(t) >= 2 and not exists (
         select 1 from public.eip_customer x
          where x.tenant_id = o.tenant_id and x.id <> o.customer_id
            and (position(lower(t) in lower(x.name)) > 0 or lower(t) = lower(coalesce(x.short_name, '')) or lower(t) = lower(coalesce(x.code, ''))
                 or lower(t) = any (select lower(y) from unnest(coalesce(x.aliases, '{}')) y))) then
      update public.eip_customer c set aliases = array_append(coalesce(c.aliases, '{}'), t)
       where c.id = o.customer_id and lower(t) <> lower(c.name) and lower(t) <> lower(coalesce(c.short_name, ''))
         and lower(t) <> lower(coalesce(c.code, '')) and not (lower(t) = any (select lower(x) from unnest(coalesce(c.aliases, '{}')) x));
    end if;
  end if;

  for l in select * from public.eip_sales_order_line where order_id = p_order and product_id is not null loop
    if o.customer_id is not null and nullif(btrim(l.product_text), '') is not null then
      t := btrim(l.product_text);
      -- 已經是這個品項的品名／代號／全公司別名就不用記
      if not exists (select 1 from public.eip_product p where p.id = l.product_id
                      and (lower(t) = lower(p.name) or lower(t) = lower(coalesce(p.code, ''))
                           or lower(t) = any (select lower(x) from unnest(coalesce(p.aliases, '{}')) x)
                           or lower(t) = lower(regexp_replace(p.name, '^\[測試\]', '')))) then
        insert into public.eip_customer_product_alias (tenant_id, customer_id, product_id, alias, source, created_by)
        values (o.tenant_id, o.customer_id, l.product_id, t, 'learned', auth.uid())
        on conflict (customer_id, (lower(btrim(alias)))) do update
          set product_id = excluded.product_id, updated_at = now()
          where public.eip_customer_product_alias.source = 'learned';
      end if;
    end if;
    if v_learn and o.customer_id is not null and l.unit_price is not null and coalesce(l.price_source, '') <> 'contract' then
      update public.eip_customer_price set unit_price = l.unit_price, last_order_id = o.id, note = null, updated_at = now(), updated_by = auth.uid()
       where customer_id = o.customer_id and product_id = l.product_id and coalesce(unit, '') = coalesce(l.unit, '') and source = 'last_order';
      if not found then
        insert into public.eip_customer_price (tenant_id, customer_id, product_id, unit, unit_price, source, last_order_id, updated_by)
        values (o.tenant_id, o.customer_id, l.product_id, l.unit, l.unit_price, 'last_order', o.id, auth.uid());
      end if;
    end if;
  end loop;

  if o.customer_id is not null then perform public.eip_rebuild_customer_profile(o.tenant_id, o.customer_id); end if;

  -- LINE 文字下單：原文＋確認後的結果存成範例（內勤可在主檔頁停用或修改）
  if v_examples and o.source = 'line' and nullif(btrim(o.raw_text), '') is not null and char_length(o.raw_text) <= 1500 then
    v_text := public.eip_order_example_text(o.id);
    if v_text is not null then
      insert into public.eip_order_example (tenant_id, customer_id, order_id, input_text, expected_text, message_date, source, created_by)
      values (o.tenant_id, o.customer_id, o.id, btrim(o.raw_text), v_text, (o.created_at at time zone 'Asia/Taipei')::date, 'order', auth.uid())
      on conflict (order_id) do update set input_text = excluded.input_text, expected_text = excluded.expected_text,
        customer_id = excluded.customer_id, updated_at = now();
    end if;
  end if;
end $$;
revoke all on function public.eip_sales_order_learn(uuid) from public, anon, authenticated;

-- ── 預設說法（每個已啟用訂單接收的公司各一份；已存在的不覆蓋）
insert into public.eip_order_phrase (tenant_id, phrase, meaning, sort_order)
select s.tenant_id, v.phrase, v.meaning, v.sort_order
  from public.eip_sales_order_setting s
 cross join (values
   ('一打', '數量 12（單位依品項設定，並在待確認提醒換算）', 10),
   ('半打', '數量 6（單位依品項設定，並在待確認提醒換算）', 11),
   ('件', '批發口語通常指「箱」；品項沒有「件」這個單位時當作箱，並列入待確認', 20),
   ('各 N', '前面列出的每個品項都是 N（例：原味、五香各 10 箱＝原味 10 箱、五香 10 箱）', 30),
   ('同上', '數量與單位和上一項相同', 31),
   ('照舊、老樣子、跟上次一樣', '沿用這個客戶最近一次的品項與數量，再套用這次說的增減', 40),
   ('老地方', '客戶的主要送貨地址', 50),
   ('急件、先送', '交期可能是今天或明天，一律列入待確認', 60),
   ('月底', '當月最後一個送貨日', 61),
   ('追加、再加', '修改目前的草稿：增加數量或品項，不是新的一張單', 70),
   ('不要了、取消', '修改目前的草稿：刪除該品項', 71),
   ('台斤、斤', '600 公克', 80),
   ('公斤', '1000 公克', 81)
 ) as v(phrase, meaning, sort_order)
on conflict do nothing;

-- ── 第一次建立常訂品項（用現有已確認訂單；之後匯入凌越歷史或覆核確認會自動更新）
select public.eip_rebuild_customer_profile(s.tenant_id, null) from public.eip_sales_order_setting s;
