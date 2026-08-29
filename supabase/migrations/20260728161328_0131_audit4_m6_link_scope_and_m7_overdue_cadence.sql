-- ============================================================
-- 0131 第四輪稽核：M6（eip_link 讀取範圍）／M7（逾期通知頻率）
-- ============================================================

/* ---------- M6：eip_link_read 原本只擋 tenant，等於全公司都看得到
              「哪個任務連到哪份文件」的關聯圖與 UUID。
              改成「兩端至少有一端你看得到」才給讀。
              注意：這支函式必須是 SECURITY INVOKER，
              才會沿用各表自己的 RLS（definer 會整個穿透）。 ---------- */
create or replace function public.eip_link_endpoint_visible(p_type text, p_id uuid)
 returns boolean
 language sql
 stable
 set search_path to 'public'
as $function$
  select case p_type
    when 'task'     then public.eip_can_see_task(p_id)
    when 'document' then exists (select 1 from public.eip_document  d where d.id = p_id)
    when 'meeting'  then exists (select 1 from public.meeting       m where m.id = p_id)
    when 'project'  then exists (select 1 from public.project       p where p.id = p_id)
    when 'defect'   then exists (select 1 from public.eip_anomaly   a where a.id = p_id)
    else false
  end;
$function$;

revoke all on function public.eip_link_endpoint_visible(text, uuid) from public, anon;
grant execute on function public.eip_link_endpoint_visible(text, uuid) to authenticated, service_role;

drop policy if exists eip_link_read on public.eip_link;
create policy eip_link_read on public.eip_link
  for select to authenticated
  using (
    tenant_id = current_tenant_id()
    and (
      current_role_name() = 'company_admin'
      or created_by = (select auth.uid())
      or public.eip_link_endpoint_visible(from_type, from_id)
      or public.eip_link_endpoint_visible(to_type, to_id)
    )
  );

-- 建立連結時也要求「來源端你看得到」，否則任何人都能把別人的東西掛上關聯
drop policy if exists eip_link_write on public.eip_link;
create policy eip_link_write on public.eip_link
  for insert to authenticated
  with check (
    tenant_id = current_tenant_id()
    and (
      current_role_name() = 'company_admin'
      or public.eip_link_endpoint_visible(from_type, from_id)
    )
  );


/* ---------- M7：逾期未填報的通知原本每天無條件重發一次，
              而且 priority = high 會直接觸發 LINE 推播 → 每天被吵。
              改成遞減頻率：逾期第 1、3、7 天各一次，之後每 7 天一次。
              不加欄位、純用「今天 - 期限」判斷，重跑排程不會產生額外通知。 ---------- */
create or replace function public.eip_sweep_anomaly_overdue()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare a record; v_n int := 0; v_d int;
begin
  for a in
    select * from public.eip_anomaly
     where deleted_at is null
       and status = 'pending_fill'
       and fill_due_date is not null
       and fill_due_date < (now() at time zone 'Asia/Taipei')::date
  loop
    v_d := ((now() at time zone 'Asia/Taipei')::date - a.fill_due_date);
    -- 第 1／3／7 天各提醒一次，第 8 天之後每 7 天一次
    continue when not (v_d in (1, 3, 7) or (v_d > 7 and v_d % 7 = 0));

    begin
      if public.eip_emit_notification(
           'anomaly_overdue', a.department_id, a.subject_id, null,
           'anomaly'::notification_entity, a.id, 'anomaly_overdue'::notification_type,
           '【異常缺失逾期未填報】' || coalesce(a.code,'') || '「' || a.title
             || '」應於 ' || to_char(a.fill_due_date,'MM/DD') || ' 前填報，已逾期 '
             || v_d || ' 天',
           'high') > 0 then
        v_n := v_n + 1;
      end if;
    exception when others then
      raise warning 'anomaly overdue notify 失敗 %: %', a.id, sqlerrm;
    end;
  end loop;
  return v_n;
end;
$function$;

revoke all on function public.eip_sweep_anomaly_overdue() from public, anon, authenticated;
grant execute on function public.eip_sweep_anomaly_overdue() to service_role;;
