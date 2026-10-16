-- 訂單接收 v2（二）：價格解析、單身自動帶價、單頭預設值與稅額、成交價學習、覆核人員與下單人通知
-- 2026-10-16（以 execute_sql 套用，未列入 migration history）

-- ── 價格解析：合約價 → 最近成交價 → 品項單位價 → 品項牌價
create or replace function public.eip_price_lookup(p_customer uuid, p_product uuid, p_unit text, p_date date default null)
returns table (unit_price numeric, source text) language plpgsql stable security definer set search_path = public as $$
declare v_main text; v_list numeric; v_d date := coalesce(p_date, (now() at time zone 'Asia/Taipei')::date); r record;
begin
  select p.unit, p.unit_price into v_main, v_list from public.eip_product p where p.id = p_product;
  if not found then return; end if;
  if p_customer is not null then
    for r in
      select cp.unit_price, cp.source from public.eip_customer_price cp
       where cp.customer_id = p_customer and cp.product_id = p_product
         and (cp.unit = p_unit or (cp.unit is null and (p_unit is null or p_unit = v_main)) or (p_unit is null and cp.unit = v_main))
         and (cp.valid_from is null or cp.valid_from <= v_d) and (cp.valid_to is null or cp.valid_to >= v_d)
       order by case cp.source when 'contract' then 0 else 1 end, (cp.unit is not null) desc, cp.updated_at desc
       limit 1
    loop
      unit_price := r.unit_price; source := r.source; return next; return;
    end loop;
  end if;
  if p_unit is not null and v_main is not null and p_unit <> v_main then
    for r in select coalesce(u.unit_price, round(u.ratio * v_list, 2)) as price from public.eip_product_unit u
              where u.product_id = p_product and u.unit = p_unit loop
      if r.price is not null then unit_price := r.price; source := 'product_unit'; return next; end if;
      return;
    end loop;
    return;
  end if;
  if v_list is not null then unit_price := v_list; source := 'product'; return next; end if;
end $$;
revoke execute on function public.eip_price_lookup(uuid, uuid, text, date) from public, anon, authenticated;

-- 給網頁呼叫：需有訂單或主檔檢視權
create or replace function public.eip_resolve_price(p_customer uuid, p_product uuid, p_unit text, p_date date default null)
returns table (unit_price numeric, source text) language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.eip_has_perm('eip_sales_order','view') or public.eip_has_perm('eip_order_master','view')) then return; end if;
  if not exists (select 1 from public.eip_product p where p.id = p_product and p.tenant_id = public.current_tenant_id()) then return; end if;
  return query select * from public.eip_price_lookup(p_customer, p_product, p_unit, p_date);
end $$;
revoke execute on function public.eip_resolve_price(uuid, uuid, text, date) from public, anon;
grant execute on function public.eip_resolve_price(uuid, uuid, text, date) to authenticated;

-- ── 單身：自動帶單位／規格／單價
create or replace function public.eip_sales_order_line_before() returns trigger language plpgsql security definer set search_path = public as $$
declare v_cust uuid; v_date date; p record; r record;
begin
  if new.product_id is not null and (tg_op = 'INSERT' or new.product_id is distinct from old.product_id or new.unit is distinct from old.unit or new.unit_price is null) then
    select unit, spec into p from public.eip_product where id = new.product_id;
    new.unit := coalesce(nullif(btrim(new.unit), ''), p.unit);
    new.spec := coalesce(nullif(btrim(new.spec), ''), p.spec);
    if new.unit_price is null then
      select customer_id, order_date into v_cust, v_date from public.eip_sales_order where id = new.order_id;
      select * into r from public.eip_price_lookup(v_cust, new.product_id, new.unit, v_date);
      if r.unit_price is not null then new.unit_price := r.unit_price; new.price_source := r.source; end if;
    end if;
  end if;
  if new.unit_price is not null and new.price_source is null then new.price_source := 'manual'; end if;
  if new.unit_price is null then new.price_source := null; end if;
  return new;
end $$;
drop trigger if exists trg_eip_sales_order_line_before on public.eip_sales_order_line;
create trigger trg_eip_sales_order_line_before before insert or update on public.eip_sales_order_line for each row execute function public.eip_sales_order_line_before();

-- 單身異動 → 觸發單頭重算金額
create or replace function public.eip_sales_order_line_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') then update public.eip_sales_order set updated_at = now() where id = old.order_id; end if;
  if tg_op in ('INSERT','UPDATE') and (tg_op = 'INSERT' or new.order_id is distinct from old.order_id) then
    update public.eip_sales_order set updated_at = now() where id = new.order_id;
  end if;
  return null;
end $$;
drop trigger if exists trg_eip_sales_order_line_after on public.eip_sales_order_line;
create trigger trg_eip_sales_order_line_after after insert or update or delete on public.eip_sales_order_line for each row execute function public.eip_sales_order_line_after();
revoke execute on function public.eip_sales_order_line_before() from public, anon, authenticated;
revoke execute on function public.eip_sales_order_line_after() from public, anon, authenticated;

-- ── 單頭：客戶預設值＋金額稅額（取代 v1 的 before trigger）
create or replace function public.eip_sales_order_before() returns trigger language plpgsql security definer set search_path = public as $$
declare v_day text; v_n int; c record; s record; v_sum numeric; v_rate numeric;
  a_id uuid; a_addr text; a_recv text; a_phone text; a_win text;
  v_cust_changed boolean := tg_op = 'INSERT' or new.customer_id is distinct from old.customer_id;
  v_addr_changed boolean := tg_op = 'UPDATE' and new.customer_address_id is distinct from old.customer_address_id;
begin
  if tg_op = 'INSERT' and new.order_no is null then
    v_day := to_char(now() at time zone 'Asia/Taipei', 'YYMMDD');
    perform pg_advisory_xact_lock(hashtext('eip_sales_order_no' || new.tenant_id::text || v_day));
    select count(*) + 1 into v_n from public.eip_sales_order where tenant_id = new.tenant_id and order_no like 'SO' || v_day || '-%';
    new.order_no := 'SO' || v_day || '-' || lpad(v_n::text, 3, '0');
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;

  select * into s from public.eip_sales_order_setting where tenant_id = new.tenant_id;

  -- 客戶預設值：只補空白欄位；換送貨地址時以該地址為準
  if new.customer_id is not null and (v_cust_changed or v_addr_changed) then
    if new.customer_address_id is not null then
      select id, address, receiver_name, receiver_phone, delivery_time_window into a_id, a_addr, a_recv, a_phone, a_win
        from public.eip_customer_address where id = new.customer_address_id and customer_id = new.customer_id;
      if a_id is null then new.customer_address_id := null; end if;
    elsif v_cust_changed and nullif(btrim(new.delivery_address), '') is null then
      select id, address, receiver_name, receiver_phone, delivery_time_window into a_id, a_addr, a_recv, a_phone, a_win
        from public.eip_customer_address where customer_id = new.customer_id and is_default and is_active limit 1;
      new.customer_address_id := a_id;
    end if;
    if a_id is not null then
      if v_addr_changed then
        new.delivery_address := a_addr;
        new.contact_name := coalesce(a_recv, new.contact_name);
        new.contact_phone := coalesce(a_phone, new.contact_phone);
        new.delivery_time_window := coalesce(a_win, new.delivery_time_window);
      else
        new.delivery_address := coalesce(nullif(btrim(new.delivery_address), ''), a_addr);
        new.contact_name := coalesce(nullif(btrim(new.contact_name), ''), a_recv);
        new.contact_phone := coalesce(nullif(btrim(new.contact_phone), ''), a_phone);
        new.delivery_time_window := coalesce(nullif(btrim(new.delivery_time_window), ''), a_win);
      end if;
    end if;
    if v_cust_changed then
      select * into c from public.eip_customer where id = new.customer_id;
      new.delivery_address := coalesce(nullif(btrim(new.delivery_address), ''), c.address);
      new.contact_name := coalesce(nullif(btrim(new.contact_name), ''), c.contact_name);
      new.contact_phone := coalesce(nullif(btrim(new.contact_phone), ''), c.phone);
      new.delivery_time_window := coalesce(nullif(btrim(new.delivery_time_window), ''), c.delivery_time_window);
      new.payment_terms := coalesce(nullif(btrim(new.payment_terms), ''), c.payment_terms);
      if tg_op = 'INSERT' then new.tax_type := coalesce(new.tax_type, c.tax_type);
      elsif new.tax_type is not distinct from old.tax_type then new.tax_type := coalesce(c.tax_type, new.tax_type); end if;
      if new.delivery_date is null and c.delivery_lead_days is not null then
        new.delivery_date := new.order_date + c.delivery_lead_days;
      end if;
    end if;
  end if;
  new.tax_type := coalesce(new.tax_type, s.default_tax_type, 'exclusive');
  new.tax_rate := coalesce(new.tax_rate, s.tax_rate, 0.05);

  -- 金額：外加稅／內含稅／免稅，稅額四捨五入到元
  if tg_op = 'INSERT' then v_sum := 0;
  else select coalesce(sum(amount), 0) into v_sum from public.eip_sales_order_line where order_id = new.id; end if;
  v_rate := case when new.tax_type = 'exempt' then 0 else new.tax_rate end;
  if new.tax_type = 'inclusive' then
    new.total_amount := v_sum;
    new.subtotal := round(v_sum / (1 + v_rate), 0);
    new.tax_amount := new.total_amount - new.subtotal;
  else
    new.subtotal := v_sum;
    new.tax_amount := round(v_sum * v_rate, 0);
    new.total_amount := new.subtotal + new.tax_amount;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'confirmed' then
      if new.customer_id is null then raise exception '請先對應客戶主檔再確認訂單'; end if;
      if not exists (select 1 from public.eip_sales_order_line where order_id = new.id) then raise exception '訂單沒有任何品項'; end if;
      if exists (select 1 from public.eip_sales_order_line where order_id = new.id and (product_id is null or coalesce(qty,0) <= 0)) then
        raise exception '每一筆品項都要對應品項主檔並填寫數量，才能確認訂單';
      end if;
      if new.delivery_date is null then raise exception '請填寫交貨日期再確認訂單'; end if;
      new.reviewed_by := coalesce(auth.uid(), new.reviewed_by);
      new.reviewed_at := now();
    elsif new.status = 'pending_review' and new.owner_confirmed_at is null then
      new.owner_confirmed_at := now();
    end if;
  end if;
  return new;
end $$;

-- ── 確認時學習：別名＋最近成交價
create or replace function public.eip_sales_order_learn(p_order uuid) returns void language plpgsql security definer set search_path = public as $$
declare o record; l record; t text; v_learn boolean;
begin
  select * into o from public.eip_sales_order where id = p_order;
  select coalesce(learn_last_price, true) into v_learn from public.eip_sales_order_setting where tenant_id = o.tenant_id;
  v_learn := coalesce(v_learn, true);
  if o.customer_id is not null and nullif(btrim(o.customer_text),'') is not null then
    t := btrim(o.customer_text);
    update public.eip_customer c set aliases = array_append(c.aliases, t)
     where c.id = o.customer_id and lower(t) <> lower(c.name) and lower(t) <> lower(coalesce(c.short_name,''))
       and lower(t) <> lower(coalesce(c.code,'')) and not (lower(t) = any (select lower(x) from unnest(c.aliases) x));
  end if;
  for l in select * from public.eip_sales_order_line where order_id = p_order and product_id is not null loop
    if nullif(btrim(l.product_text),'') is not null then
      t := btrim(l.product_text);
      update public.eip_product p set aliases = array_append(p.aliases, t)
       where p.id = l.product_id and lower(t) <> lower(p.name) and lower(t) <> lower(coalesce(p.code,''))
         and not (lower(t) = any (select lower(x) from unnest(p.aliases) x));
    end if;
    if v_learn and o.customer_id is not null and l.unit_price is not null and coalesce(l.price_source,'') <> 'contract' then
      update public.eip_customer_price set unit_price = l.unit_price, last_order_id = o.id, updated_at = now(), updated_by = auth.uid()
       where customer_id = o.customer_id and product_id = l.product_id and coalesce(unit,'') = coalesce(l.unit,'') and source = 'last_order';
      if not found then
        insert into public.eip_customer_price (tenant_id, customer_id, product_id, unit, unit_price, source, last_order_id, updated_by)
        values (o.tenant_id, o.customer_id, l.product_id, l.unit, l.unit_price, 'last_order', o.id, auth.uid());
      end if;
    end if;
  end loop;
end $$;
revoke execute on function public.eip_sales_order_learn(uuid) from public, anon, authenticated;

-- ── 狀態異動：紀錄、學習、通知（覆核人員可設定；確認／取消通知下單人）
create or replace function public.eip_sales_order_after() returns trigger language plpgsql security definer set search_path = public as $$
declare v_reviewers uuid[]; v_cust text; s record; v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.eip_sales_order_log (tenant_id, order_id, actor_id, action, detail)
    values (new.tenant_id, new.id, coalesce(v_actor, new.created_by), 'created', jsonb_build_object('source', new.source, 'status', new.status));
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.eip_sales_order_log (tenant_id, order_id, actor_id, action, detail)
    values (new.tenant_id, new.id, coalesce(v_actor, new.created_by), 'status', jsonb_build_object('from', old.status, 'to', new.status, 'reason', new.cancelled_reason));
    if new.status = 'confirmed' then perform public.eip_sales_order_learn(new.id); end if;
    select * into s from public.eip_sales_order_setting where tenant_id = new.tenant_id;
    select coalesce(c.name, new.customer_text, '未指定客戶') into v_cust from (select 1) x left join public.eip_customer c on c.id = new.customer_id;
    if new.status = 'pending_review' then
      select coalesce(array_agg(u.id), '{}') into v_reviewers from public.app_user u
       where u.tenant_id = new.tenant_id and u.status = 'active' and u.id is distinct from new.created_by
         and u.id = any(coalesce(s.reviewer_ids, '{}'));
      if coalesce(array_length(v_reviewers, 1), 0) = 0 then
        select coalesce(array_agg(u.id), '{}') into v_reviewers from public.app_user u
         where u.tenant_id = new.tenant_id and u.status = 'active' and u.id is distinct from new.created_by
           and public.eip_user_has_perm(u.id, 'eip_sales_order', 'edit');
      end if;
      if array_length(v_reviewers, 1) > 0 then
        perform public.eip_emit_notification('direct_notify', null, null, new.created_by, 'sales_order', new.id, 'review_needed',
          '【訂單待覆核】' || new.order_no || '｜' || v_cust || '，請到「訂單接收」確認', 'urgent', v_reviewers);
      end if;
    elsif new.status in ('confirmed','cancelled') and coalesce(s.notify_creator, true)
          and new.created_by is not null and new.created_by is distinct from v_actor and old.status <> 'draft' then
      perform public.eip_emit_notification('direct_notify', null, null, v_actor, 'sales_order', new.id, 'status_changed',
        case when new.status = 'confirmed'
          then '【訂單已確認】' || new.order_no || '｜' || v_cust || coalesce('｜交貨 ' || to_char(new.delivery_date, 'MM/DD'), '')
               || '｜總計 $' || to_char(new.total_amount, 'FM999,999,999,990')
          else '【訂單已取消】' || new.order_no || '｜' || v_cust || coalesce('｜原因：' || new.cancelled_reason, '') end,
        'high', array[new.created_by]);
    end if;
  elsif row(new.customer_id, new.delivery_date, new.delivery_address, new.note, new.erp_order_no, new.deleted_at, new.payment_terms, new.tax_type)
        is distinct from row(old.customer_id, old.delivery_date, old.delivery_address, old.note, old.erp_order_no, old.deleted_at, old.payment_terms, old.tax_type) then
    insert into public.eip_sales_order_log (tenant_id, order_id, actor_id, action, detail)
    values (new.tenant_id, new.id, v_actor, case when new.deleted_at is not null and old.deleted_at is null then 'deleted' else 'edited' end, null);
  end if;
  return new;
end $$;
revoke execute on function public.eip_sales_order_after() from public, anon, authenticated;
revoke execute on function public.eip_sales_order_before() from public, anon, authenticated;

-- 同一地址只能一個預設；設新預設時自動取消舊的
create or replace function public.eip_customer_address_before() returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if new.is_default then
    update public.eip_customer_address set is_default = false where customer_id = new.customer_id and id <> new.id and is_default;
  end if;
  return new;
end $$;
drop trigger if exists trg_eip_customer_address_before on public.eip_customer_address;
create trigger trg_eip_customer_address_before before insert or update on public.eip_customer_address for each row execute function public.eip_customer_address_before();


-- 既有資料：補單價、算金額
update public.eip_sales_order_line set unit_price = null where unit_price is null and product_id is not null;

-- 權限函式不開放給未登入者
revoke execute on function public.eip_can_edit_sales_order(uuid) from public, anon;
revoke execute on function public.eip_can_view_sales_order(uuid) from public, anon;
grant execute on function public.eip_can_edit_sales_order(uuid) to authenticated;
grant execute on function public.eip_can_view_sales_order(uuid) to authenticated;
