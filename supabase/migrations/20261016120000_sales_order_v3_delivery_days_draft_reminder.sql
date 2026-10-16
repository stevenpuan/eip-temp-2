-- 訂單接收 v3：不送貨日（週日／國定假日）自動順延、LINE 草稿未送出提醒
-- 已套用到 Supabase 專案 tjkeycrbgkyvlxwywyvt

-- 1. 設定：不送貨的星期（0=日…6=六）、休息日、草稿提醒時間
alter table public.eip_sales_order_setting
  add column if not exists no_delivery_weekdays smallint[] not null default '{0}',
  add column if not exists holidays date[] not null default '{}',
  add column if not exists draft_remind_minutes integer not null default 30,
  add column if not exists draft_escalate_minutes integer not null default 120;

alter table public.eip_sales_order
  add column if not exists draft_reminded_at timestamptz,
  add column if not exists draft_escalated_at timestamptz;

-- 2. 是否為不送貨日／下一個可送貨日
create or replace function public.eip_is_no_delivery_day(p_tenant uuid, p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select extract(dow from p_date)::smallint = any(s.no_delivery_weekdays) or p_date = any(s.holidays)
      from public.eip_sales_order_setting s where s.tenant_id = p_tenant
  ), extract(dow from p_date) = 0)
$$;

create or replace function public.eip_next_delivery_day(p_tenant uuid, p_date date)
returns date language plpgsql stable security definer set search_path = public as $$
declare d date := p_date; i int := 0;
begin
  if d is null then return null; end if;
  while public.eip_is_no_delivery_day(p_tenant, d) and i < 14 loop
    d := d + 1; i := i + 1;
  end loop;
  return d;
end $$;

revoke all on function public.eip_is_no_delivery_day(uuid, date) from public, anon;
revoke all on function public.eip_next_delivery_day(uuid, date) from public, anon;
grant execute on function public.eip_is_no_delivery_day(uuid, date) to authenticated, service_role;
grant execute on function public.eip_next_delivery_day(uuid, date) to authenticated, service_role;

-- 3. 訂單 BEFORE 觸發器：預設交期遇不送貨日自動順延
create or replace function public.eip_sales_order_before()
returns trigger language plpgsql security definer set search_path = public as $function$
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
        new.delivery_date := public.eip_next_delivery_day(new.tenant_id, new.order_date + c.delivery_lead_days);
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

  -- 草稿被修改或送出後，重新計算提醒
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.draft_reminded_at := null; new.draft_escalated_at := null;
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
end $function$;

-- 4. LINE 草稿未送出：先提醒老闆（並重新開啟「回覆送出訂單」），再久沒送出就通知覆核人員
create or replace function public.eip_remind_stale_order_drafts()
returns integer language plpgsql security definer set search_path = public as $$
declare o record; v_n int := 0; v_cust text; v_lines int; v_reviewers uuid[]; v_hour int;
begin
  v_hour := extract(hour from now() at time zone 'Asia/Taipei');
  if v_hour < 7 or v_hour >= 22 then return 0; end if;  -- 夜間不打擾

  for o in
    select so.*, coalesce(st.draft_remind_minutes, 30) rm, coalesce(st.draft_escalate_minutes, 120) em, st.reviewer_ids
      from public.eip_sales_order so
      left join public.eip_sales_order_setting st on st.tenant_id = so.tenant_id
     where so.status = 'draft' and so.deleted_at is null and so.created_by is not null
       and so.created_at > now() - interval '3 days'
       and (
         (so.draft_reminded_at is null and coalesce(so.updated_at, so.created_at) < now() - make_interval(mins => coalesce(st.draft_remind_minutes, 30)))
         or (so.draft_reminded_at is not null and so.draft_escalated_at is null
             and so.created_at < now() - make_interval(mins => coalesce(st.draft_escalate_minutes, 120))
             and so.draft_reminded_at < now() - interval '20 minutes')
       )
     order by so.created_at
     limit 50
  loop
    select coalesce(c.name, o.customer_text, '未指定客戶') into v_cust from (select 1) x left join public.eip_customer c on c.id = o.customer_id;
    select count(*) into v_lines from public.eip_sales_order_line where order_id = o.id;

    if o.draft_reminded_at is null then
      perform public.eip_emit_notification('direct_notify', null, null, null, 'sales_order', o.id, 'due_soon',
        '【訂單草稿還沒送出】' || o.order_no || '｜' || v_cust || '｜' || v_lines || ' 項'
          || case when o.total_amount > 0 then '｜總計 $' || to_char(o.total_amount, 'FM999,999,999,990') else '' end
          || '。請回覆「送出訂單」交給內勤，或回覆「取消訂單」作廢。',
        'high', array[o.created_by]);
      -- 讓老闆直接回覆「送出訂單」就能送出（不覆蓋他正在處理的其他草稿）
      insert into public.line_pending_order (user_id, order_id, created_at)
      values (o.created_by, o.id, now())
      on conflict (user_id) do update set order_id = excluded.order_id, created_at = now()
       where public.line_pending_order.order_id = excluded.order_id
          or public.line_pending_order.created_at < now() - interval '60 minutes';
      update public.eip_sales_order set draft_reminded_at = now() where id = o.id;
    else
      select coalesce(array_agg(u.id), '{}') into v_reviewers from public.app_user u
       where u.tenant_id = o.tenant_id and u.status = 'active' and u.id is distinct from o.created_by
         and u.id = any(coalesce(o.reviewer_ids, '{}'));
      if coalesce(array_length(v_reviewers, 1), 0) = 0 then
        select coalesce(array_agg(u.id), '{}') into v_reviewers from public.app_user u
         where u.tenant_id = o.tenant_id and u.status = 'active' and u.id is distinct from o.created_by
           and public.eip_user_has_perm(u.id, 'eip_sales_order', 'edit');
      end if;
      if array_length(v_reviewers, 1) > 0 then
        perform public.eip_emit_notification('direct_notify', null, null, null, 'sales_order', o.id, 'review_needed',
          '【老闆的訂單草稿未送出】' || o.order_no || '｜' || v_cust || '｜' || v_lines || ' 項，已超過 '
            || o.em || ' 分鐘未送出。請與老闆確認；確定要下單可在「訂單接收 › 草稿」按「代老闆送出覆核」。',
          'high', v_reviewers);
      end if;
      update public.eip_sales_order set draft_escalated_at = now() where id = o.id;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke all on function public.eip_remind_stale_order_drafts() from public, anon, authenticated;

-- 5. 排程：每 10 分鐘檢查一次（透過 eip_cron_guarded，失敗會寫 error_logs 並通知管理者）
create or replace function public.eip_cron_guarded(p_job text)
returns void language plpgsql security definer set search_path = public as $function$
declare
  v_err text; v_state text; v_ctx text; v_msg text; v_admin uuid; v_sent int := 0;
begin
  begin
    case p_job
      when 'eip_run_recurring'         then perform public.eip_run_recurring();
      when 'eip_sweep_handover'        then perform public.eip_sweep_handover();
      when 'eip_sweep_anomaly_overdue' then perform public.eip_sweep_anomaly_overdue();
      when 'eip_send_line_digests'     then perform public.eip_send_line_digests();
      when 'eip_confirm_line_delivery' then perform public.eip_confirm_line_delivery();
      when 'eip_retry_urgent_line'     then perform public.eip_retry_urgent_line();
      when 'eip_purge_old_logs'        then perform public.eip_purge_old_logs(90);
      when 'eip_purge_maintenance'     then perform public.eip_purge_maintenance();
      when 'eip_auto_close_empty_leaves' then perform public.eip_auto_close_empty_leaves();
      when 'eip_remind_stale_order_drafts' then perform public.eip_remind_stale_order_drafts();
      else raise exception '未知的排程工作：%', p_job;
    end case;
    return;
  exception when others then
    get stacked diagnostics
      v_err   = message_text,
      v_state = returned_sqlstate,
      v_ctx   = pg_exception_context;
  end;

  v_msg := '【系統異常】排程「' || p_job || '」於 '
        || to_char((now() at time zone 'Asia/Taipei')::date, 'YYYY-MM-DD')
        || ' 執行失敗：' || left(coalesce(v_err, '未知錯誤'), 200);

  begin
    insert into public.error_logs(level, message, context, route)
    values ('error', v_msg,
            jsonb_build_object('job', p_job, 'sqlstate', v_state,
                               'context', left(coalesce(v_ctx,''), 2000)),
            'cron/' || p_job);
  exception when others then null;
  end;

  begin
    insert into public.eip_notification_miss(event_code, entity_type, entity_id, reason)
    values ('cron_failed', 'cron', null, left(p_job || '：' || coalesce(v_err,''), 500));
  exception when others then null;
  end;

  for v_admin in
    select id from public.app_user
     where status = 'active' and role = 'company_admin'::user_role
  loop
    begin
      v_sent := v_sent + coalesce(public.eip_notify_user(
        v_admin, 'system_alert'::notification_type, 'task'::notification_entity,
        null, v_msg, 'urgent'), 0);
    exception when others then null;
    end;
  end loop;

  raise warning '排程 % 失敗：% （已寫入 error_logs，通知 % 則）', p_job, v_err, v_sent;
end;
$function$;

select cron.schedule('sales_order_draft_remind', '*/10 * * * *', $$select public.eip_cron_guarded('eip_remind_stale_order_drafts')$$);
