-- 訂單接收模組：客戶/品項主檔、訂單單頭單身、異動紀錄、LINE 原始訊息、LINE 待確認
-- 2026-10-16

-- ── 權限 helper：以指定使用者判斷模組權限（給 service_role / LINE 使用）
create or replace function public.eip_user_has_perm(p_user uuid, p_module text, p_action text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin(p_user) or exists (
    select 1 from public.user_roles ur
    join public.role_module_permissions p on p.role_id = ur.role_id
    where ur.user_id = p_user and p.module_key = p_module
      and case p_action when 'view' then p.can_view when 'create' then p.can_create
        when 'edit' then p.can_edit when 'delete' then p.can_delete when 'export' then p.can_export else false end);
$$;
revoke execute on function public.eip_user_has_perm(uuid, text, text) from public, anon, authenticated;

-- ── 主檔
create table public.eip_customer (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  code text,
  name text not null,
  short_name text,
  aliases text[] not null default '{}',
  contact_name text,
  phone text,
  address text,
  sales_owner_id uuid references public.app_user(id) on delete set null,
  note text,
  is_active boolean not null default true,
  created_by uuid default auth.uid() references public.app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index eip_customer_code_uq on public.eip_customer (tenant_id, code) where code is not null;
create index eip_customer_tenant_idx on public.eip_customer (tenant_id, is_active);
create index eip_customer_sales_owner_idx on public.eip_customer (sales_owner_id);
create index eip_customer_created_by_idx on public.eip_customer (created_by);

create table public.eip_product (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  code text,
  name text not null,
  spec text,
  unit text,
  aliases text[] not null default '{}',
  unit_price numeric(14,2),
  note text,
  is_active boolean not null default true,
  created_by uuid default auth.uid() references public.app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index eip_product_code_uq on public.eip_product (tenant_id, code) where code is not null;
create index eip_product_tenant_idx on public.eip_product (tenant_id, is_active);
create index eip_product_created_by_idx on public.eip_product (created_by);

-- ── 訂單
create table public.eip_sales_order (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  order_no text,
  status text not null default 'draft' check (status in ('draft','pending_review','confirmed','cancelled')),
  source text not null default 'web' check (source in ('line','web')),
  customer_id uuid references public.eip_customer(id) on delete set null,
  customer_text text,
  contact_name text,
  contact_phone text,
  order_date date not null default ((now() at time zone 'Asia/Taipei')::date),
  delivery_date date,
  delivery_address text,
  note text,
  raw_text text,
  ai_summary text,
  ai_issues text[] not null default '{}',
  attachments jsonb not null default '[]'::jsonb,
  created_by uuid default auth.uid() references public.app_user(id) on delete set null,
  owner_confirmed_at timestamptz,
  reviewed_by uuid references public.app_user(id) on delete set null,
  reviewed_at timestamptz,
  cancelled_reason text,
  erp_order_no text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index eip_sales_order_no_uq on public.eip_sales_order (tenant_id, order_no);
create index eip_sales_order_status_idx on public.eip_sales_order (tenant_id, status, created_at desc);
create index eip_sales_order_customer_idx on public.eip_sales_order (customer_id);
create index eip_sales_order_created_by_idx on public.eip_sales_order (created_by);
create index eip_sales_order_reviewed_by_idx on public.eip_sales_order (reviewed_by);

create table public.eip_sales_order_line (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  order_id uuid not null references public.eip_sales_order(id) on delete cascade,
  line_no int not null default 1,
  product_id uuid references public.eip_product(id) on delete set null,
  product_text text,
  spec text,
  qty numeric(14,3),
  unit text,
  unit_price numeric(14,2),
  note text,
  needs_review boolean not null default false,
  created_at timestamptz not null default now()
);
create index eip_sales_order_line_order_idx on public.eip_sales_order_line (order_id, line_no);
create index eip_sales_order_line_product_idx on public.eip_sales_order_line (product_id);

create table public.eip_sales_order_log (
  id bigserial primary key,
  tenant_id uuid not null,
  order_id uuid not null references public.eip_sales_order(id) on delete cascade,
  actor_id uuid references public.app_user(id) on delete set null,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index eip_sales_order_log_order_idx on public.eip_sales_order_log (order_id, created_at);
create index eip_sales_order_log_actor_idx on public.eip_sales_order_log (actor_id);

-- ── LINE 原始訊息（學習與稽核用）、LINE 待確認訂單
create table public.line_inbound_message (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid references public.app_user(id) on delete set null,
  line_message_id text,
  message_type text not null,
  text_content text,
  file_path text,
  file_name text,
  mime_type text,
  intent text,
  parse_result jsonb,
  related_order_id uuid references public.eip_sales_order(id) on delete set null,
  created_at timestamptz not null default now()
);
create index line_inbound_message_user_idx on public.line_inbound_message (user_id, created_at desc);
create index line_inbound_message_order_idx on public.line_inbound_message (related_order_id);

create table public.line_pending_order (
  user_id uuid primary key references public.app_user(id) on delete cascade,
  order_id uuid not null references public.eip_sales_order(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index line_pending_order_order_idx on public.line_pending_order (order_id);

-- ── 觸發器
create or replace function public.eip_touch_updated_at() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
create trigger trg_eip_customer_touch before update on public.eip_customer for each row execute function public.eip_touch_updated_at();
create trigger trg_eip_product_touch before update on public.eip_product for each row execute function public.eip_touch_updated_at();

create or replace function public.eip_sales_order_before() returns trigger language plpgsql security definer set search_path = public as $$
declare v_day text; v_n int;
begin
  if tg_op = 'INSERT' then
    if new.order_no is null then
      v_day := to_char(now() at time zone 'Asia/Taipei', 'YYMMDD');
      perform pg_advisory_xact_lock(hashtext('eip_sales_order_no' || new.tenant_id::text || v_day));
      select count(*) + 1 into v_n from public.eip_sales_order where tenant_id = new.tenant_id and order_no like 'SO' || v_day || '-%';
      new.order_no := 'SO' || v_day || '-' || lpad(v_n::text, 3, '0');
    end if;
    return new;
  end if;
  new.updated_at := now();
  if new.status is distinct from old.status then
    if new.status = 'confirmed' then
      if new.customer_id is null then raise exception '請先對應客戶主檔再確認訂單'; end if;
      if not exists (select 1 from public.eip_sales_order_line where order_id = new.id) then raise exception '訂單沒有任何品項'; end if;
      if exists (select 1 from public.eip_sales_order_line where order_id = new.id and (product_id is null or coalesce(qty,0) <= 0)) then
        raise exception '每一筆品項都要對應品項主檔並填寫數量，才能確認訂單';
      end if;
      new.reviewed_by := coalesce(auth.uid(), new.reviewed_by);
      new.reviewed_at := now();
    elsif new.status = 'pending_review' and new.owner_confirmed_at is null then
      new.owner_confirmed_at := now();
    end if;
  end if;
  return new;
end $$;
create trigger trg_eip_sales_order_before before insert or update on public.eip_sales_order for each row execute function public.eip_sales_order_before();

-- 確認時把「原始說法」學成別名，下次 AI 就對得到
create or replace function public.eip_sales_order_learn(p_order uuid) returns void language plpgsql security definer set search_path = public as $$
declare o record; l record; t text;
begin
  select * into o from public.eip_sales_order where id = p_order;
  if o.customer_id is not null and nullif(btrim(o.customer_text),'') is not null then
    t := btrim(o.customer_text);
    update public.eip_customer c set aliases = array_append(c.aliases, t)
     where c.id = o.customer_id and lower(t) <> lower(c.name) and lower(t) <> lower(coalesce(c.short_name,''))
       and lower(t) <> lower(coalesce(c.code,'')) and not (lower(t) = any (select lower(x) from unnest(c.aliases) x));
  end if;
  for l in select * from public.eip_sales_order_line where order_id = p_order and product_id is not null and nullif(btrim(product_text),'') is not null loop
    t := btrim(l.product_text);
    update public.eip_product p set aliases = array_append(p.aliases, t)
     where p.id = l.product_id and lower(t) <> lower(p.name) and lower(t) <> lower(coalesce(p.code,''))
       and not (lower(t) = any (select lower(x) from unnest(p.aliases) x));
  end loop;
end $$;
revoke execute on function public.eip_sales_order_learn(uuid) from public, anon, authenticated;

create or replace function public.eip_sales_order_after() returns trigger language plpgsql security definer set search_path = public as $$
declare v_reviewers uuid[]; v_cust text;
begin
  if tg_op = 'INSERT' then
    insert into public.eip_sales_order_log (tenant_id, order_id, actor_id, action, detail)
    values (new.tenant_id, new.id, coalesce(auth.uid(), new.created_by), 'created', jsonb_build_object('source', new.source, 'status', new.status));
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.eip_sales_order_log (tenant_id, order_id, actor_id, action, detail)
    values (new.tenant_id, new.id, coalesce(auth.uid(), new.created_by), 'status', jsonb_build_object('from', old.status, 'to', new.status, 'reason', new.cancelled_reason));
    if new.status = 'confirmed' then perform public.eip_sales_order_learn(new.id); end if;
    if new.status = 'pending_review' then
      select coalesce(c.name, new.customer_text, '未指定客戶') into v_cust from (select 1) x left join public.eip_customer c on c.id = new.customer_id;
      select coalesce(array_agg(u.id), '{}') into v_reviewers from public.app_user u
       where u.tenant_id = new.tenant_id and u.status = 'active' and u.id is distinct from new.created_by
         and public.eip_user_has_perm(u.id, 'eip_sales_order', 'edit');
      if array_length(v_reviewers, 1) > 0 then
        perform public.eip_emit_notification('direct_notify', null, null, new.created_by, 'sales_order', new.id, 'review_needed',
          '【訂單待覆核】' || new.order_no || '｜' || v_cust || '，請到「訂單接收」確認', 'urgent', v_reviewers);
      end if;
    end if;
  elsif row(new.customer_id, new.delivery_date, new.delivery_address, new.note, new.erp_order_no, new.deleted_at)
        is distinct from row(old.customer_id, old.delivery_date, old.delivery_address, old.note, old.erp_order_no, old.deleted_at) then
    insert into public.eip_sales_order_log (tenant_id, order_id, actor_id, action, detail)
    values (new.tenant_id, new.id, auth.uid(), case when new.deleted_at is not null and old.deleted_at is null then 'deleted' else 'edited' end, null);
  end if;
  return new;
end $$;
create trigger trg_eip_sales_order_after after insert or update on public.eip_sales_order for each row execute function public.eip_sales_order_after();
revoke execute on function public.eip_sales_order_after() from public, anon, authenticated;
revoke execute on function public.eip_sales_order_before() from public, anon, authenticated;

-- ── RLS
alter table public.eip_customer enable row level security;
alter table public.eip_product enable row level security;
alter table public.eip_sales_order enable row level security;
alter table public.eip_sales_order_line enable row level security;
alter table public.eip_sales_order_log enable row level security;
alter table public.line_inbound_message enable row level security;
alter table public.line_pending_order enable row level security;

create policy customer_select on public.eip_customer for select to authenticated using (tenant_id = public.current_tenant_id() and (public.eip_has_perm('eip_sales_order','view') or public.eip_has_perm('eip_order_master','view')));
create policy customer_insert on public.eip_customer for insert to authenticated with check (tenant_id = public.current_tenant_id() and (public.eip_has_perm('eip_order_master','create') or public.eip_has_perm('eip_sales_order','edit')));
create policy customer_update on public.eip_customer for update to authenticated using (tenant_id = public.current_tenant_id() and (public.eip_has_perm('eip_order_master','edit') or public.eip_has_perm('eip_sales_order','edit'))) with check (tenant_id = public.current_tenant_id());
create policy customer_delete on public.eip_customer for delete to authenticated using (tenant_id = public.current_tenant_id() and public.eip_has_perm('eip_order_master','delete'));

create policy product_select on public.eip_product for select to authenticated using (tenant_id = public.current_tenant_id() and (public.eip_has_perm('eip_sales_order','view') or public.eip_has_perm('eip_order_master','view')));
create policy product_insert on public.eip_product for insert to authenticated with check (tenant_id = public.current_tenant_id() and (public.eip_has_perm('eip_order_master','create') or public.eip_has_perm('eip_sales_order','edit')));
create policy product_update on public.eip_product for update to authenticated using (tenant_id = public.current_tenant_id() and (public.eip_has_perm('eip_order_master','edit') or public.eip_has_perm('eip_sales_order','edit'))) with check (tenant_id = public.current_tenant_id());
create policy product_delete on public.eip_product for delete to authenticated using (tenant_id = public.current_tenant_id() and public.eip_has_perm('eip_order_master','delete'));

create policy so_select on public.eip_sales_order for select to authenticated using (tenant_id = public.current_tenant_id() and deleted_at is null and (public.eip_has_perm('eip_sales_order','view') or created_by = (select auth.uid())));
create policy so_insert on public.eip_sales_order for insert to authenticated with check (tenant_id = public.current_tenant_id() and public.eip_has_perm('eip_sales_order','create'));
create policy so_update on public.eip_sales_order for update to authenticated
  using (tenant_id = public.current_tenant_id() and deleted_at is null and (public.eip_has_perm('eip_sales_order','edit') or (created_by = (select auth.uid()) and status in ('draft','pending_review'))))
  with check (tenant_id = public.current_tenant_id() and (public.eip_has_perm('eip_sales_order','edit') or (created_by = (select auth.uid()) and status in ('draft','pending_review','cancelled'))));

create or replace function public.eip_can_edit_sales_order(p_order uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.eip_sales_order o where o.id = p_order and o.tenant_id = public.current_tenant_id() and o.deleted_at is null
    and o.status <> 'cancelled'
    and (public.eip_has_perm('eip_sales_order','edit') or (o.created_by = auth.uid() and o.status in ('draft','pending_review'))));
$$;
create or replace function public.eip_can_view_sales_order(p_order uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.eip_sales_order o where o.id = p_order and o.tenant_id = public.current_tenant_id() and o.deleted_at is null
    and (public.eip_has_perm('eip_sales_order','view') or o.created_by = auth.uid()));
$$;

create policy sol_select on public.eip_sales_order_line for select to authenticated using (public.eip_can_view_sales_order(order_id));
create policy sol_insert on public.eip_sales_order_line for insert to authenticated with check (tenant_id = public.current_tenant_id() and public.eip_can_edit_sales_order(order_id));
create policy sol_update on public.eip_sales_order_line for update to authenticated using (public.eip_can_edit_sales_order(order_id)) with check (public.eip_can_edit_sales_order(order_id));
create policy sol_delete on public.eip_sales_order_line for delete to authenticated using (public.eip_can_edit_sales_order(order_id));

create policy sol_log_select on public.eip_sales_order_log for select to authenticated using (public.eip_can_view_sales_order(order_id));
create policy lim_select on public.line_inbound_message for select to authenticated using (tenant_id = public.current_tenant_id() and (public.is_admin((select auth.uid())) or public.eip_has_perm('eip_sales_order','edit')));
-- line_pending_order：僅 service_role 使用，不開放 policy

-- ── 附件儲存桶（私有）：路徑 <order_id>/<檔名>
insert into storage.buckets (id, name, public) values ('sales-order', 'sales-order', false) on conflict (id) do nothing;
create policy sales_order_files_read on storage.objects for select to authenticated
  using (bucket_id = 'sales-order' and public.eip_can_view_sales_order(nullif(split_part(name, '/', 1), '')::uuid));
create policy sales_order_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'sales-order' and public.eip_can_edit_sales_order(nullif(split_part(name, '/', 1), '')::uuid));
create policy sales_order_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'sales-order' and public.eip_can_edit_sales_order(nullif(split_part(name, '/', 1), '')::uuid));

-- ── 選單與預設權限
insert into public.menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select 'eip_sales_order', id, '訂單接收', 'ClipboardList', '/dashboard/eip/sales-orders', 'eip_sales_order', 104, true from public.menus where menu_key = 'eip_group'
on conflict do nothing;
insert into public.menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select 'eip_order_master', id, '客戶／品項主檔', 'Database', '/dashboard/eip/order-master', 'eip_order_master', 105, true from public.menus where menu_key = 'eip_group'
on conflict do nothing;

insert into public.role_module_permissions (role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select r.id, m.k,
  r.code in ('admin','manager','dept_manager'),
  r.code in ('admin','manager'),
  r.code in ('admin','manager'),
  r.code in ('admin','manager'),
  r.code in ('admin','manager','dept_manager')
from public.roles r cross join (values ('eip_sales_order'), ('eip_order_master')) m(k)
on conflict (role_id, module_key) do nothing;
