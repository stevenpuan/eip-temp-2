-- 訂單接收 v2（一）：主檔擴充（客戶交易條件、送貨地址、品項單位、客戶價格）、訂單預設值、金額稅額、成交價學習、訂單設定
-- 2026-10-16

-- ── 客戶主檔擴充
alter table public.eip_customer
  add column if not exists tax_id text,
  add column if not exists invoice_title text,
  add column if not exists invoice_address text,
  add column if not exists customer_type text,
  add column if not exists region text,
  add column if not exists delivery_route text,
  add column if not exists payment_terms text,
  add column if not exists tax_type text check (tax_type in ('exclusive','inclusive','exempt')),
  add column if not exists credit_limit numeric(14,2),
  add column if not exists delivery_lead_days int check (delivery_lead_days between 0 and 60),
  add column if not exists delivery_time_window text,
  add column if not exists delivery_note text,
  add column if not exists fax text,
  add column if not exists email text;

-- ── 客戶送貨地址（分店／多倉）
create table if not exists public.eip_customer_address (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  customer_id uuid not null references public.eip_customer(id) on delete cascade,
  label text not null,
  address text not null,
  receiver_name text,
  receiver_phone text,
  delivery_time_window text,
  note text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists eip_customer_address_cust_idx on public.eip_customer_address (customer_id);
create unique index if not exists eip_customer_address_default_uq on public.eip_customer_address (customer_id) where is_default;
create unique index if not exists eip_customer_address_label_uq on public.eip_customer_address (customer_id, label);

-- ── 品項主檔擴充
alter table public.eip_product
  add column if not exists category text,
  add column if not exists barcode text,
  add column if not exists pack_desc text,
  add column if not exists min_order_qty numeric(14,3);

-- ── 品項單位換算（例：主單位「箱」，另可賣「包」= 1/12 箱）
create table if not exists public.eip_product_unit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  product_id uuid not null references public.eip_product(id) on delete cascade,
  unit text not null,
  ratio numeric(14,6) not null check (ratio > 0),
  unit_price numeric(14,2),
  barcode text,
  created_at timestamptz not null default now()
);
create unique index if not exists eip_product_unit_uq on public.eip_product_unit (product_id, unit);

-- ── 客戶價格：contract＝合約／專屬價（人工維護），last_order＝最近成交價（覆核確認時自動學習）
create table if not exists public.eip_customer_price (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  customer_id uuid not null references public.eip_customer(id) on delete cascade,
  product_id uuid not null references public.eip_product(id) on delete cascade,
  unit text,
  unit_price numeric(14,2) not null check (unit_price >= 0),
  source text not null default 'contract' check (source in ('contract','last_order')),
  valid_from date,
  valid_to date,
  last_order_id uuid references public.eip_sales_order(id) on delete set null,
  note text,
  updated_by uuid default auth.uid() references public.app_user(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists eip_customer_price_lookup_idx on public.eip_customer_price (customer_id, product_id, source);
create index if not exists eip_customer_price_product_idx on public.eip_customer_price (product_id);
create index if not exists eip_customer_price_order_idx on public.eip_customer_price (last_order_id);
create index if not exists eip_customer_price_updated_by_idx on public.eip_customer_price (updated_by);
create unique index if not exists eip_customer_price_last_uq on public.eip_customer_price (customer_id, product_id, coalesce(unit, '')) where source = 'last_order';

-- ── 訂單設定（每個公司一筆）
create table if not exists public.eip_sales_order_setting (
  tenant_id uuid primary key,
  reviewer_ids uuid[] not null default '{}',
  default_tax_type text not null default 'exclusive' check (default_tax_type in ('exclusive','inclusive','exempt')),
  tax_rate numeric(6,4) not null default 0.05 check (tax_rate >= 0 and tax_rate < 1),
  learn_last_price boolean not null default true,
  qty_alert_ratio numeric(6,2) not null default 3 check (qty_alert_ratio >= 1),
  notify_creator boolean not null default true,
  updated_by uuid references public.app_user(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.eip_sales_order_setting (tenant_id) values ('00000000-0000-0000-0000-000000000001') on conflict do nothing;

-- ── 訂單單頭／單身擴充
alter table public.eip_sales_order
  add column if not exists customer_address_id uuid references public.eip_customer_address(id) on delete set null,
  add column if not exists delivery_time_window text,
  add column if not exists payment_terms text,
  add column if not exists tax_type text check (tax_type in ('exclusive','inclusive','exempt')),
  add column if not exists tax_rate numeric(6,4),
  add column if not exists subtotal numeric(14,2) not null default 0,
  add column if not exists tax_amount numeric(14,2) not null default 0,
  add column if not exists total_amount numeric(14,2) not null default 0;
create index if not exists eip_sales_order_address_idx on public.eip_sales_order (customer_address_id);

alter table public.eip_sales_order_line
  add column if not exists price_source text check (price_source in ('contract','last_order','product_unit','product','manual','ai')),
  add column if not exists amount numeric(16,2) generated always as (round(coalesce(qty,0) * coalesce(unit_price,0), 2)) stored;

-- ── RLS
alter table public.eip_customer_address enable row level security;
alter table public.eip_product_unit enable row level security;
alter table public.eip_customer_price enable row level security;
alter table public.eip_sales_order_setting enable row level security;

create policy cust_addr_select on public.eip_customer_address for select to authenticated using (tenant_id = public.current_tenant_id() and (public.eip_has_perm('eip_sales_order','view') or public.eip_has_perm('eip_order_master','view')));
create policy cust_addr_write on public.eip_customer_address for all to authenticated
  using (tenant_id = public.current_tenant_id() and (public.eip_has_perm('eip_order_master','edit') or public.eip_has_perm('eip_sales_order','edit')))
  with check (tenant_id = public.current_tenant_id() and (public.eip_has_perm('eip_order_master','edit') or public.eip_has_perm('eip_order_master','create') or public.eip_has_perm('eip_sales_order','edit')));

create policy prod_unit_select on public.eip_product_unit for select to authenticated using (tenant_id = public.current_tenant_id() and (public.eip_has_perm('eip_sales_order','view') or public.eip_has_perm('eip_order_master','view')));
create policy prod_unit_write on public.eip_product_unit for all to authenticated
  using (tenant_id = public.current_tenant_id() and (public.eip_has_perm('eip_order_master','edit') or public.eip_has_perm('eip_sales_order','edit')))
  with check (tenant_id = public.current_tenant_id() and (public.eip_has_perm('eip_order_master','edit') or public.eip_has_perm('eip_order_master','create') or public.eip_has_perm('eip_sales_order','edit')));

create policy cust_price_select on public.eip_customer_price for select to authenticated using (tenant_id = public.current_tenant_id() and (public.eip_has_perm('eip_sales_order','view') or public.eip_has_perm('eip_order_master','view')));
create policy cust_price_write on public.eip_customer_price for all to authenticated
  using (tenant_id = public.current_tenant_id() and (public.eip_has_perm('eip_order_master','edit') or public.eip_has_perm('eip_sales_order','edit')))
  with check (tenant_id = public.current_tenant_id() and (public.eip_has_perm('eip_order_master','edit') or public.eip_has_perm('eip_order_master','create') or public.eip_has_perm('eip_sales_order','edit')));

create policy so_setting_select on public.eip_sales_order_setting for select to authenticated using (tenant_id = public.current_tenant_id() and (public.eip_has_perm('eip_sales_order','view') or public.eip_has_perm('eip_order_master','view')));
create policy so_setting_update on public.eip_sales_order_setting for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.eip_has_perm('eip_order_master','edit'))
  with check (tenant_id = public.current_tenant_id());

