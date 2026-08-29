-- 0104 LINE 送達確認與重試（修 H1、H2）
-- H1：net.http_post 是非同步 fire-and-forget，只回 request_id，成功與否要查 net._http_response。
--     原本兩支推播函式在 http_post 之後就直接標記已送出。
--     實證：2026-07-28 09:00 一筆 DNS timeout（net._http_response id=620），
--     同時 44 筆通知被標記已送出，該同仁整包 digest 沒收到且永不重試。
-- H2：立即推播寫在 insert 之前，不受去重保護 → LINE 收到但站內查不到。

/* ---------- ① 追蹤欄位 ---------- */
alter table public.notification
  add column if not exists line_request_id bigint,
  add column if not exists line_attempts int not null default 0,
  add column if not exists line_error text;

create index if not exists idx_notification_line_await
  on public.notification (line_request_id) where line_pending and line_request_id is not null;

/* ---------- ② 通知發送落空的紀錄表（H3 的觀測手段） ---------- */
create table if not exists public.eip_notification_miss (
  id bigserial primary key,
  event_code text not null,
  entity_type text,
  entity_id uuid,
  reason text not null,
  created_at timestamptz not null default now()
);
alter table public.eip_notification_miss enable row level security;
drop policy if exists enm_admin_read on public.eip_notification_miss;
create policy enm_admin_read on public.eip_notification_miss for select
  using (current_role_name() = 'company_admin'::user_role);

comment on table public.eip_notification_miss is
  '通知解析後收件人為 0 人的紀錄。「通知了 0 個人」與「成功通知」在系統裡原本完全無法區分，這是最危險的靜默盲點。';

/* ---------- ③ 立即推播：回傳 request_id ---------- */
drop function if exists public.eip_line_push_now(uuid, text);

create function public.eip_line_push_now(p_user_id uuid, p_message text)
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
    body    := jsonb_build_object('user_id', p_user_id, 'message', left(p_message, 4800))
  ) into v_req;
  return v_req;   -- 只代表已排入送出佇列，不代表送達
end;
$function$;

revoke all on function public.eip_line_push_now(uuid, text) from public, anon, authenticated;

/* ---------- ④ 唯一入口：推播移到 insert 之後 ---------- */
drop function if exists public.eip_emit_notification(
  text, uuid, uuid, uuid, notification_entity, uuid, notification_type, text, text, uuid[]);

create function public.eip_emit_notification(
  p_event_code text, p_department_id uuid, p_owner_id uuid, p_actor_id uuid,
  p_entity_type notification_entity, p_entity_id uuid, p_notif_type notification_type,
  p_message text,
  p_priority text default 'normal',
  p_extra_user_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n int := 0; rec record; v_tenant uuid; v_new_id uuid; v_req bigint;
  v_urgent boolean := coalesce(p_priority,'normal') in ('high','urgent');
  v_prefix text := case p_priority when 'urgent' then '【緊急】' when 'high' then '【重要】' else '' end;
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
    if rec.in_app then
      v_new_id := null;

      insert into public.notification(tenant_id, user_id, type, entity_type, entity_id,
                                      message, line_pending, priority)
      select v_tenant, rec.user_id, p_notif_type, p_entity_type, p_entity_id,
             p_message, rec.line_enabled, coalesce(p_priority,'normal')
      where not exists (
        select 1 from public.notification n
        where n.user_id = rec.user_id and n.entity_id = p_entity_id
          and n.type = p_notif_type and n.message = p_message
          -- 20 小時而非 24：日排程的秒級抖動會讓 24 小時視窗把當天的提醒吃掉
          and n.created_at > now() - interval '20 hours')
      returning id into v_new_id;

      if v_new_id is not null then
        v_n := v_n + 1;
        -- H2：只有真的寫入通知才推 LINE
        if v_urgent then
          v_req := public.eip_line_push_now(rec.user_id, v_prefix || p_message);
          if v_req is not null then
            -- H1：只記 request_id，line_pending 仍為 true，等確認排程放行
            update public.notification
               set line_request_id = v_req, line_attempts = 1, line_pending = true
             where id = v_new_id;
          end if;
        end if;
      end if;
    end if;
  end loop;

  if v_n = 0 then
    insert into public.eip_notification_miss(event_code, entity_type, entity_id, reason)
    values (p_event_code, p_entity_type::text, p_entity_id, '解析後收件人為 0 人或全數被去重');
  end if;

  return v_n;
end;
$function$;

revoke all on function public.eip_emit_notification(text, uuid, uuid, uuid, notification_entity, uuid, notification_type, text, text, uuid[]) from public, anon, authenticated;

comment on function public.eip_emit_notification(text, uuid, uuid, uuid, notification_entity, uuid, notification_type, text, text, uuid[]) is
  '全系統唯一的通知發送入口。所有發送規則只存在這裡。LINE 一律先寫 request_id、由 eip_confirm_line_delivery 確認 2xx 後才算送達。';

/* ---------- ⑤ 彙整推播：改成待確認，UPDATE 限定彙整到的 id ---------- */
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
    select n.user_id, count(*) as cnt, array_agg(n.id) as ids,
           string_agg('• ' || n.message, E'\n' order by n.created_at) as body
    from public.notification n
    join public.app_user u on u.id = n.user_id
    where n.line_pending
      and n.line_request_id is null      -- 已送出待確認的不重複發
      and n.line_attempts < 3
      and u.line_user_id is not null and u.status = 'active'
    group by n.user_id
  loop
    v_msg := left('【陞煇 EIP】通知 ' || rec.cnt || ' 則' || E'\n' || rec.body, 4800);
    select net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type','application/json','x-push-key', v_key),
      body    := jsonb_build_object('user_id', rec.user_id, 'message', v_msg)
    ) into v_req;

    update public.notification
       set line_request_id = v_req, line_attempts = line_attempts + 1
     where id = any(rec.ids);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

/* ---------- ⑥ 送達確認 ---------- */
create or replace function public.eip_confirm_line_delivery()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_ok int := 0;
begin
  with done as (
    update public.notification n
       set line_pending = false, line_sent_at = now(), line_error = null
      from net._http_response r
     where r.id = n.line_request_id and n.line_pending
       and r.status_code between 200 and 299
    returning 1)
  select count(*) into v_ok from done;

  -- 失敗但還有重試額度：清掉 request_id，下一輪彙整會再送
  update public.notification n
     set line_request_id = null,
         line_error = left(coalesce(r.error_msg, 'HTTP ' || r.status_code::text), 200)
    from net._http_response r
   where r.id = n.line_request_id and n.line_pending
     and (r.status_code is null or r.status_code >= 300)
     and n.line_attempts < 3;

  -- 已重試 3 次仍失敗：放棄並留下原因
  update public.notification n
     set line_pending = false,
         line_error = left(coalesce(r.error_msg, 'HTTP ' || r.status_code::text), 200)
                      || '（已重試 3 次仍失敗）'
    from net._http_response r
   where r.id = n.line_request_id and n.line_pending
     and (r.status_code is null or r.status_code >= 300)
     and n.line_attempts >= 3;

  return v_ok;
end;
$function$;

revoke all on function public.eip_confirm_line_delivery() from public, anon, authenticated;
;
