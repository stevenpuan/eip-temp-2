-- 0110 LINE／通知可靠性（第三輪稽核 H3 H4 M1 M2 M3 M4 M5 M10 M12 M14）
-- 稽核第三輪（2026-07-28）

alter table public.notification
  add column if not exists line_queued_at     timestamptz,
  add column if not exists line_blocked_until timestamptz;

comment on column public.notification.line_queued_at is
  '最後一次排入 pg_net 佇列的時間。判斷「推播回應遺失」用，不可用 created_at（H3）';
comment on column public.notification.line_blocked_until is
  'LINE 額度用盡等暫時性阻擋的解除時間。到期後兩支排程會自動重送（H4）';

create index if not exists idx_notification_line_blocked
  on public.notification(line_blocked_until)
  where line_pending and line_blocked_until is not null;

update public.notification
   set line_queued_at = coalesce(line_queued_at, created_at)
 where line_pending and line_request_id is not null and line_queued_at is null;

------------------------------------------------------------------
-- M4：content 是 text 且無 JSON 驗證，平台層回 HTML/純文字會讓
--     整支 eip_confirm_line_delivery 拋錯 → 送達確認全面停擺 6 小時
------------------------------------------------------------------
create or replace function public.eip_try_jsonb(t text)
 returns jsonb
 language plpgsql
 immutable
 set search_path to 'public'
as $function$
begin
  if t is null or btrim(t) = '' then return null; end if;
  return t::jsonb;
exception when others then
  return null;
end;
$function$;

revoke execute on function public.eip_try_jsonb(text) from anon, authenticated;

create or replace function public.eip_line_status(t text)
 returns int
 language sql
 immutable
 set search_path to 'public'
as $function$
  select nullif(regexp_replace(
           coalesce(public.eip_try_jsonb(t) ->> 'line_status', ''), '[^0-9]', '', 'g'), '')::int;
$function$;

revoke execute on function public.eip_line_status(text) from anon, authenticated;

------------------------------------------------------------------
-- M5：立即推播仍是預設 5000ms，已有實測「光 DNS 就吃掉 5000ms」的逾時案例
------------------------------------------------------------------
create or replace function public.eip_line_push_now(p_user_id uuid, p_message text)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_url text; v_key text; v_line text; v_req bigint;
begin
  select value into v_url from public.app_config where key = 'line_push_url';
  select value into v_key from public.app_config where key = 'line_push_secret';
  if v_url is null or v_key is null then return null; end if;

  select line_user_id into v_line from public.app_user
   where id = p_user_id and status = 'active';
  if v_line is null then return null; end if;

  select net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type','application/json','x-push-key', v_key),
    body    := jsonb_build_object('user_id', p_user_id, 'message', left(p_message, 4800)),
    timeout_milliseconds := 15000            -- M5：與彙整路徑一致
  ) into v_req;
  return v_req;   -- 只代表已排入送出佇列，不代表送達
end;
$function$;

------------------------------------------------------------------
-- 統一入口重寫：M1 / M2 / M10 / H3
------------------------------------------------------------------
create or replace function public.eip_emit_notification(
  p_event_code text, p_department_id uuid, p_owner_id uuid, p_actor_id uuid,
  p_entity_type notification_entity, p_entity_id uuid, p_notif_type notification_type,
  p_message text, p_priority text default 'normal'::text, p_extra_user_ids uuid[] default null::uuid[])
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_n int := 0; rec record; v_tenant uuid; v_req bigint;
  v_recips int := 0; v_inapp int := 0;
  v_exist_id uuid; v_exist_pri text; v_target uuid;
  v_pri text := coalesce(p_priority,'normal');
  v_urgent boolean := v_pri in ('high','urgent');
  v_msg text := case v_pri when 'urgent' then '【緊急】' when 'high' then '【重要】' else '' end
                || p_message;
begin
  select tenant_id into v_tenant from public.department where id = p_department_id;
  if v_tenant is null and p_owner_id is not null then
    select tenant_id into v_tenant from public.app_user where id = p_owner_id;
  end if;
  v_tenant := coalesce(v_tenant, '00000000-0000-0000-0000-000000000001');

  for rec in
    select * from public.eip_notification_recipients(
      p_event_code, p_department_id, p_owner_id, p_actor_id, p_extra_user_ids)
  loop
    v_recips := v_recips + 1;
    if not rec.in_app then continue; end if;
    v_inapp := v_inapp + 1;

    v_target := null; v_exist_id := null; v_exist_pri := null;

    -- 去重：比對「去掉優先級前綴」的訊息，讓同一事件不因升級而重複（M2）
    select n.id, n.priority into v_exist_id, v_exist_pri
      from public.notification n
     where n.user_id = rec.user_id
       and n.entity_id is not distinct from p_entity_id
       and n.type = p_notif_type
       and regexp_replace(n.message, '^【(緊急|重要)】', '') = p_message
       and n.created_at > now() - interval '20 hours'
     order by n.created_at desc
     limit 1;

    if v_exist_id is null then
      insert into public.notification(tenant_id, user_id, type, entity_type, entity_id,
                                      message, line_pending, priority)
      values (v_tenant, rec.user_id, p_notif_type, p_entity_type, p_entity_id,
              v_msg, rec.line_enabled, v_pri)
      returning id into v_target;
      v_n := v_n + 1;

    elsif v_urgent and coalesce(v_exist_pri,'normal') not in ('high','urgent') then
      -- 已有同內容的通知，但這次升級成重要／緊急：改寫既有列並重開推播
      update public.notification
         set message = v_msg, priority = v_pri, is_read = false,
             line_pending = rec.line_enabled, line_request_id = null,
             line_error = null, line_queued_at = null, line_blocked_until = null
       where id = v_exist_id;
      v_target := v_exist_id;
      v_n := v_n + 1;
    end if;

    -- 立即推播：優先級要夠高，且該事件對這個人真的開了 LINE（M1）
    if v_target is not null and v_urgent and rec.line_enabled then
      begin
        v_req := public.eip_line_push_now(rec.user_id, v_msg);
        if v_req is not null then
          update public.notification
             set line_request_id = v_req, line_attempts = 1,
                 line_pending = true, line_queued_at = now()
           where id = v_target;
        end if;
      exception when others then
        update public.notification
           set line_error = left('立即推播失敗：' || sqlerrm, 200),
               line_pending = rec.line_enabled, line_request_id = null
         where id = v_target;
      end;
    end if;
  end loop;

  -- 漏發偵測：分開「查無收件人」與「有收件人但站內通知全關」（M10）
  if v_n = 0 then
    begin
      if v_recips = 0 then
        insert into public.eip_notification_miss(event_code, entity_type, entity_id, reason)
        values (p_event_code, p_entity_type::text, p_entity_id, '收件人解析為 0 人');
      elsif v_inapp = 0 then
        insert into public.eip_notification_miss(event_code, entity_type, entity_id, reason)
        values (p_event_code, p_entity_type::text, p_entity_id,
                '有 ' || v_recips || ' 位收件人，但站內通知全部關閉，此事件實際上沒有任何通道');
      end if;
    exception when others then
      raise warning 'eip_notification_miss 寫入失敗：%', sqlerrm;
    end;
  end if;

  return v_n;
end;
$function$;

revoke execute on function public.eip_emit_notification(
  text, uuid, uuid, uuid, notification_entity, uuid, notification_type, text, text, uuid[])
  from anon, authenticated;

------------------------------------------------------------------
-- M3：讓 retry 與 digest 的集合互斥（high/urgent vs 其餘），
--     不再需要行鎖也不會重複推播。H4：額度封鎖改讀 line_blocked_until
------------------------------------------------------------------
create or replace function public.eip_retry_urgent_line()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare rec record; v_req bigint; v_n int := 0;
begin
  for rec in
    select n.id, n.user_id, n.message
      from public.notification n
      join public.app_user u on u.id = n.user_id
     where n.line_pending
       and n.line_request_id is null
       and n.priority in ('high','urgent')
       and n.line_attempts < 3
       and (n.line_blocked_until is null or n.line_blocked_until <= now())
       and u.line_user_id is not null and u.status = 'active'
     order by n.created_at
     limit 50
  loop
    begin
      v_req := public.eip_line_push_now(rec.user_id, rec.message);
      if v_req is not null then
        update public.notification
           set line_request_id = v_req, line_attempts = line_attempts + 1,
               line_queued_at = now()
         where id = rec.id;
        v_n := v_n + 1;
      end if;
    exception when others then
      update public.notification
         set line_error = left('重試失敗：' || sqlerrm, 200),
             line_attempts = line_attempts + 1
       where id = rec.id;
    end;
  end loop;
  return v_n;
end;
$function$;

create or replace function public.eip_send_line_digests()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_url text; v_key text; rec record; v_msg text; v_n int := 0; v_req bigint;
begin
  update public.notification n set line_pending = false
    from public.app_user u
   where u.id = n.user_id and n.line_pending
     and (u.line_user_id is null or u.status <> 'active');

  select value into v_url from public.app_config where key = 'line_push_url';
  select value into v_key from public.app_config where key = 'line_push_secret';
  if v_url is null or v_key is null then return 0; end if;

  for rec in
    select n.user_id, n.line_attempts, count(*) as cnt, array_agg(n.id) as ids,
           string_agg('• ' || n.message, E'\n' order by n.created_at) as body
    from public.notification n
    join public.app_user u on u.id = n.user_id
    where n.line_pending
      and n.line_request_id is null
      and n.priority not in ('high','urgent')       -- M3：與 retry 集合互斥
      and n.line_attempts < 3
      and (n.line_blocked_until is null or n.line_blocked_until <= now())
      and u.line_user_id is not null and u.status = 'active'
    group by n.user_id, n.line_attempts
  loop
    begin
      v_msg := left('【陞煇 EIP】通知 ' || rec.cnt || ' 則' || E'\n' || rec.body, 4800);
      select net.http_post(
        url     := v_url,
        headers := jsonb_build_object('Content-Type','application/json','x-push-key', v_key),
        body    := jsonb_build_object('user_id', rec.user_id, 'message', v_msg),
        timeout_milliseconds := 15000
      ) into v_req;

      update public.notification
         set line_request_id = v_req, line_attempts = line_attempts + 1,
             line_queued_at = now()
       where id = any(rec.ids);
      v_n := v_n + 1;
    exception when others then
      update public.notification
         set line_error = left('彙整推播失敗：' || sqlerrm, 200),
             line_attempts = line_attempts + 1
       where id = any(rec.ids);
    end;
  end loop;
  return v_n;
end;
$function$;

------------------------------------------------------------------
-- 送達確認重寫：M4 安全轉換 + 外層例外、H3 用 line_queued_at、H4 額度封鎖與 30 天上限
------------------------------------------------------------------
create or replace function public.eip_confirm_line_delivery()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_ok int := 0; v_reset timestamptz;
begin
  v_reset := date_trunc('month', now()) + interval '1 month';

  with done as (
    update public.notification n
       set line_pending = false, line_sent_at = now(), line_error = null,
           line_request_id = null, line_blocked_until = null
      from net._http_response r
     where r.id = n.line_request_id and n.line_pending
       and r.status_code between 200 and 299
       and coalesce(public.eip_line_status(r.content), 0) between 200 and 299
    returning 1)
  select count(*) into v_ok from done;

  -- LINE 429 月額度用盡：改記「封鎖到額度重置」，不消耗重試次數（H4）
  update public.notification n
     set line_request_id = null,
         line_blocked_until = v_reset,
         line_error = 'LINE 月推播額度已用盡（429），' ||
                      to_char(v_reset, 'MM/DD') || ' 額度重置後自動重送'
    from net._http_response r
   where r.id = n.line_request_id and n.line_pending
     and coalesce(public.eip_line_status(r.content), 0) = 429;

  update public.notification n
     set line_request_id = null,
         line_error = left(coalesce(
           'LINE ' || public.eip_line_status(r.content)::text,
           r.error_msg,
           'HTTP ' || r.status_code::text), 200)
    from net._http_response r
   where r.id = n.line_request_id and n.line_pending
     and coalesce(public.eip_line_status(r.content), 0) <> 429
     and (r.status_code is null or r.status_code >= 300
          or coalesce(public.eip_line_status(r.content), 0) >= 300)
     and n.line_attempts < 3;

  update public.notification n
     set line_pending = false,
         line_error = left(coalesce(
           'LINE ' || public.eip_line_status(r.content)::text,
           r.error_msg,
           'HTTP ' || r.status_code::text), 180) || '（已重試 3 次）'
    from net._http_response r
   where r.id = n.line_request_id and n.line_pending
     and coalesce(public.eip_line_status(r.content), 0) <> 429
     and (r.status_code is null or r.status_code >= 300
          or coalesce(public.eip_line_status(r.content), 0) >= 300)
     and n.line_attempts >= 3;

  -- 回應遺失：用真正排入佇列的時間判斷，不可用 created_at（H3）
  update public.notification n
     set line_request_id = null,
         line_error = coalesce(n.line_error || '；', '') || '推播回應遺失，重新排入'
   where n.line_pending and n.line_request_id is not null
     and n.line_attempts < 3
     and coalesce(n.line_queued_at, n.created_at) < now() - interval '15 minutes'
     and not exists (select 1 from net._http_response r where r.id = n.line_request_id);

  update public.notification n
     set line_pending = false,
         line_error = coalesce(n.line_error || '；', '') || '推播回應遺失且重試耗盡'
   where n.line_pending and n.line_request_id is not null
     and n.line_attempts >= 3
     and coalesce(n.line_queued_at, n.created_at) < now() - interval '15 minutes'
     and not exists (select 1 from net._http_response r where r.id = n.line_request_id);

  -- H4 絕對上限：卡超過 30 天一律放棄，否則佇列無限累積
  update public.notification
     set line_pending = false,
         line_error = left(coalesce(line_error || '；', ''), 150) || '逾 30 天未送出，已放棄'
   where line_pending and created_at < now() - interval '30 days';

  return v_ok;
exception when others then
  begin
    insert into public.eip_notification_miss(event_code, entity_type, entity_id, reason)
    values ('line_confirm', 'line', null, left('送達確認排程失敗：' || sqlerrm, 480));
  exception when others then null;
  end;
  raise warning 'eip_confirm_line_delivery 失敗：%', sqlerrm;
  return v_ok;
end;
$function$;

revoke execute on function public.eip_confirm_line_delivery() from anon, authenticated;
revoke execute on function public.eip_retry_urgent_line() from anon, authenticated;
revoke execute on function public.eip_send_line_digests() from anon, authenticated;
revoke execute on function public.eip_line_push_now(uuid, text) from anon, authenticated;

------------------------------------------------------------------
-- M14：一個 line_user_id 綁到兩位員工會讓助理整體癱瘓且推播送錯人。
--      套用前已確認 0 筆重複。
------------------------------------------------------------------
create unique index if not exists uq_app_user_line_user_id
  on public.app_user(line_user_id) where line_user_id is not null;

------------------------------------------------------------------
-- M12：notification 的授權面收乾淨，不再靠「RLS 剛好擋住」
------------------------------------------------------------------
revoke all on public.notification from anon;
revoke insert on public.notification from authenticated;;
