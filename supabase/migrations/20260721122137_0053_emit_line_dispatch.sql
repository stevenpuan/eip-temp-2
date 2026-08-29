-- 在發送函式加入 LINE 分派：對 line_enabled 收件人，且確實新建了站內通知時，
-- 透過 pg_net 非同步呼叫 line-push（讀 app_config 的 URL 與 secret）
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
  v_url text;
  v_key text;
begin
  select tenant_id into v_tenant from public.department where id = p_department_id;
  if v_tenant is null and p_owner_id is not null then
    select tenant_id into v_tenant from public.app_user where id = p_owner_id;
  end if;
  v_tenant := coalesce(v_tenant, '00000000-0000-0000-0000-000000000001');

  select value into v_url from public.app_config where key = 'line_push_url';
  select value into v_key from public.app_config where key = 'line_push_secret';

  for rec in
    select * from public.eip_notification_recipients(p_event_code, p_department_id, p_owner_id, p_actor_id)
  loop
    v_ins := 0;
    if rec.in_app then
      insert into public.notification(tenant_id, user_id, type, entity_type, entity_id, message)
      select v_tenant, rec.user_id, p_notif_type, p_entity_type, p_entity_id, p_message
      where not exists (
        select 1 from public.notification n
        where n.user_id = rec.user_id and n.entity_id = p_entity_id
          and n.type = p_notif_type and n.created_at::date = current_date);
      get diagnostics v_ins = row_count;
      v_n := v_n + v_ins;
    end if;

    -- LINE：僅在確有新建站內通知時推播（天然去重、控量）
    if rec.line_enabled and v_ins > 0 and v_url is not null and v_key is not null then
      perform net.http_post(
        url     := v_url,
        headers := jsonb_build_object('Content-Type','application/json','x-push-key', v_key),
        body    := jsonb_build_object('user_id', rec.user_id, 'message', p_message)
      );
    end if;
  end loop;
  return v_n;
end;
$function$;

revoke execute on function public.eip_emit_notification(text,uuid,uuid,uuid,notification_entity,uuid,notification_type,text) from public;
revoke execute on function public.eip_emit_notification(text,uuid,uuid,uuid,notification_entity,uuid,notification_type,text) from anon;
grant execute on function public.eip_emit_notification(text,uuid,uuid,uuid,notification_entity,uuid,notification_type,text) to service_role;;
