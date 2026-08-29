-- LINE 改每日彙整：通知加 line_pending 標記，發送函式不再即時推播，改由每日 cron 彙整
alter table public.notification add column if not exists line_pending boolean not null default false;
alter table public.notification add column if not exists line_sent_at timestamptz;
create index if not exists idx_notification_line_pending on public.notification (user_id) where line_pending;

-- 發送函式：改為「新建站內通知時，若該事件開 LINE 就標記 line_pending」，不再即時 net.http_post
create or replace function public.eip_emit_notification(
  p_event_code   text,
  p_department_id uuid,
  p_owner_id     uuid,
  p_actor_id     uuid,
  p_entity_type  notification_entity,
  p_entity_id    uuid,
  p_notif_type   notification_type,
  p_message      text
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n int := 0;
  v_ins int;
  rec record;
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.department where id = p_department_id;
  if v_tenant is null and p_owner_id is not null then
    select tenant_id into v_tenant from public.app_user where id = p_owner_id;
  end if;
  v_tenant := coalesce(v_tenant, '00000000-0000-0000-0000-000000000001');

  for rec in
    select * from public.eip_notification_recipients(p_event_code, p_department_id, p_owner_id, p_actor_id)
  loop
    if rec.in_app then
      insert into public.notification(tenant_id, user_id, type, entity_type, entity_id, message, line_pending)
      select v_tenant, rec.user_id, p_notif_type, p_entity_type, p_entity_id, p_message, rec.line_enabled
      where not exists (
        select 1 from public.notification n
        where n.user_id = rec.user_id and n.entity_id = p_entity_id
          and n.type = p_notif_type and n.created_at::date = current_date);
      get diagnostics v_ins = row_count;
      v_n := v_n + v_ins;
    end if;
  end loop;
  return v_n;
end;
$function$;

-- 每日彙整發送：每位有 line_pending 且已綁定 LINE 的使用者，發一則合併訊息，然後標記已送
create or replace function public.eip_send_line_digests()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_url text; v_key text; rec record; v_msg text; v_n int := 0;
begin
  select value into v_url from public.app_config where key = 'line_push_url';
  select value into v_key from public.app_config where key = 'line_push_secret';
  if v_url is null or v_key is null then return 0; end if;

  for rec in
    select n.user_id,
           count(*) as cnt,
           string_agg('• ' || n.message, E'\n' order by n.created_at) as body
    from public.notification n
    join public.app_user u on u.id = n.user_id
    where n.line_pending and u.line_user_id is not null and u.status = 'active'
    group by n.user_id
  loop
    v_msg := left('【陞煇 EIP】今日通知 ' || rec.cnt || ' 則' || E'\n' || rec.body, 4800);
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type','application/json','x-push-key', v_key),
      body    := jsonb_build_object('user_id', rec.user_id, 'message', v_msg)
    );
    update public.notification
      set line_pending = false, line_sent_at = now()
      where user_id = rec.user_id and line_pending;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

revoke execute on function public.eip_send_line_digests() from public, anon;
grant execute on function public.eip_send_line_digests() to service_role;

-- 每天 08:00（台北 = 00:00 UTC）執行彙整
select cron.unschedule('line_daily_digest')
where exists (select 1 from cron.job where jobname = 'line_daily_digest');
select cron.schedule('line_daily_digest', '0 0 * * *', $$ select public.eip_send_line_digests(); $$);;
