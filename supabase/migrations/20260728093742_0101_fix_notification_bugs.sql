-- 0101 通知系統全面檢查後的修正（五個 bug）
--
-- ① p_actor_id 參數從未被使用 → 動作發起人會收到自己動作的通知
--    實證：吳巧蕙、王曉鳳、王儷瑾 都收到自己送出的臨時回報通知。
--    eip_notify_worklog_submitted 裡那段「保險：移除發給自己的通知」的 delete
--    就是為了繞過這個 bug 而存在的補丁。
-- ② line_pending 取自「通知設定的 line_enabled」而非「該收件人有沒有綁 LINE」
--    → 沒綁 LINE 的人 line_pending 永遠是 true，彙整函式又只處理有綁的人，
--      這些列永遠不會被清掉。現況已卡住 24 筆，而且會一直長。
-- ③ 同日去重（created_at::date = current_date）把同一天的多次狀態變更吃掉
--    實證：「覆核訂單」7/23 狀態變更 3 次只發 1 則通知，同仁不知道它完成了。
--    共 6 個真實案例。
-- ④ owner / deputy / dept_manager / user: 四種收件範圍沒過濾已停用帳號
-- ⑤ 公告與會議邀請兩支函式也用設定值當 line_pending（同 ②）

/* ---------- 收件人解析：排除發起人、排除停用帳號 ---------- */

create or replace function public.eip_notification_recipients(
  p_event_code text, p_department_id uuid default null,
  p_owner_id uuid default null, p_actor_id uuid default null)
returns table(user_id uuid, in_app boolean, line_enabled boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid; v_setting public.notification_setting;
  v_scope text; v_parent uuid; v_uids uuid[] := '{}';
begin
  select tenant_id into v_tenant from public.department where id = p_department_id;
  if v_tenant is null and p_owner_id is not null then
    select tenant_id into v_tenant from public.app_user where id = p_owner_id;
  end if;
  v_tenant := coalesce(v_tenant, '00000000-0000-0000-0000-000000000001');

  select * into v_setting
  from public.notification_setting s
  where s.tenant_id = v_tenant and s.event_code = p_event_code and s.is_active
    and (s.department_id = p_department_id or s.department_id is null)
  order by (s.department_id is not null) desc
  limit 1;

  if not found then return; end if;

  foreach v_scope in array v_setting.recipient_scopes loop
    if v_scope = 'owner' then
      if p_owner_id is not null then v_uids := v_uids || p_owner_id; end if;
    elsif v_scope = 'deputy' then
      if p_owner_id is not null then
        v_uids := v_uids || array(
          select deputy_id from public.app_user where id = p_owner_id and deputy_id is not null);
      end if;
    elsif v_scope = 'dept_manager' then
      v_uids := v_uids || array(
        select manager_id from public.department where id = p_department_id and manager_id is not null);
    elsif v_scope = 'parent_dept_manager' then
      select parent_id into v_parent from public.department where id = p_department_id;
      v_uids := v_uids || array(
        select manager_id from public.department where id = v_parent and manager_id is not null);
    elsif v_scope = 'all_company' then
      v_uids := v_uids || array(
        select id from public.app_user where tenant_id = v_tenant and status = 'active');
    elsif v_scope like 'role:%' then
      v_uids := v_uids || array(
        select id from public.app_user where tenant_id = v_tenant and status = 'active'
          and role = substr(v_scope, 6)::user_role);
    elsif v_scope like 'user:%' then
      v_uids := v_uids || substr(v_scope, 6)::uuid;
    end if;
  end loop;

  return query
    select distinct u.id, v_setting.in_app_enabled,
           -- ② line_enabled 必須同時滿足「設定開啟」與「這個人真的綁了 LINE」
           (v_setting.line_enabled and u.line_user_id is not null)
    from unnest(v_uids) as uid
    join public.app_user u on u.id = uid
    where uid is not null
      and u.status = 'active'                              -- ④ 排除已停用
      and (p_actor_id is null or u.id <> p_actor_id);       -- ① 不通知動作發起人
end;
$function$;

revoke all on function public.eip_notification_recipients(text, uuid, uuid, uuid) from public, anon;
grant execute on function public.eip_notification_recipients(text, uuid, uuid, uuid) to authenticated, service_role;

/* ---------- ③ 去重改成看訊息內容，而非「同一天只發一則」 ---------- */

create or replace function public.eip_emit_notification(
  p_event_code text, p_department_id uuid, p_owner_id uuid, p_actor_id uuid,
  p_entity_type notification_entity, p_entity_id uuid, p_notif_type notification_type,
  p_message text, p_priority text default 'normal')
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n int := 0; v_ins int; rec record; v_tenant uuid;
  v_urgent boolean := coalesce(p_priority,'normal') in ('high','urgent');
  v_prefix text := case p_priority when 'urgent' then '【緊急】' when 'high' then '【重要】' else '' end;
  v_sent boolean;
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
      v_sent := false;
      if v_urgent and rec.line_enabled then
        v_sent := public.eip_line_push_now(rec.user_id, v_prefix || p_message);
      end if;

      insert into public.notification(tenant_id, user_id, type, entity_type, entity_id,
                                      message, line_pending, priority, line_sent_at)
      select v_tenant, rec.user_id, p_notif_type, p_entity_type, p_entity_id,
             p_message,
             case when v_sent then false else rec.line_enabled end,
             coalesce(p_priority,'normal'),
             case when v_sent then now() else null end
      -- 去重條件：24 小時內「同一人、同一對象、同一型別、且訊息內容完全相同」才擋。
      -- 這樣每日提醒（訊息內容固定）仍然只發一次，
      -- 但同一天內多次狀態變更（訊息不同）每一次都會通知。
      where not exists (
        select 1 from public.notification n
        where n.user_id = rec.user_id and n.entity_id = p_entity_id
          and n.type = p_notif_type and n.message = p_message
          and n.created_at > now() - interval '1 day');
      get diagnostics v_ins = row_count;
      v_n := v_n + v_ins;
    end if;
  end loop;
  return v_n;
end;
$function$;

revoke all on function public.eip_emit_notification(text, uuid, uuid, uuid, notification_entity, uuid, notification_type, text, text) from public, anon, authenticated;

/* ---------- ① 移除 worklog 那段補丁（已無 trigger，順手清掉函式殘留） ---------- */
drop function if exists public.eip_notify_worklog_submitted();

/* ---------- ⑤ 公告與會議邀請：line_pending 改看使用者是否綁 LINE ---------- */

create or replace function public.eip_notify_announcement_published()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_setting public.notification_setting; v_user_ids uuid[] := '{}'; v_msg text;
begin
  if NEW.published_at is null then return NEW; end if;
  if TG_OP = 'UPDATE' and OLD.published_at is not null then return NEW; end if;

  select * into v_setting from public.notification_setting s
   where s.tenant_id = NEW.tenant_id and s.event_code = 'announcement_published'
     and s.is_active and s.department_id is null
   limit 1;
  if not found or not v_setting.in_app_enabled then return NEW; end if;

  if NEW.audience_type = 'all' then
    v_user_ids := array(select id from public.app_user
                         where tenant_id = NEW.tenant_id and status = 'active');
  elsif NEW.audience_type = 'department' then
    v_user_ids := array(select u.id from public.app_user u
      join public.announcement_target t on t.department_id = u.department_id
      where t.announcement_id = NEW.id and u.tenant_id = NEW.tenant_id and u.status = 'active');
  elsif NEW.audience_type = 'users' then
    v_user_ids := array(select u.id from public.app_user u
      join public.announcement_target t on t.user_id = u.id
      where t.announcement_id = NEW.id and u.tenant_id = NEW.tenant_id and u.status = 'active');
  end if;

  v_msg := '新公告：' || NEW.title;

  insert into public.notification(tenant_id, user_id, type, entity_type, entity_id, message, line_pending)
  select NEW.tenant_id, u.id, 'announcement'::notification_type, 'announcement'::notification_entity,
         NEW.id, v_msg,
         (coalesce(v_setting.line_enabled, false) and u.line_user_id is not null)
  from unnest(v_user_ids) as uid
  join public.app_user u on u.id = uid
  where uid is not null
    and u.id <> coalesce(NEW.created_by, '00000000-0000-0000-0000-000000000000'::uuid)
    and not exists (
      select 1 from public.notification n
      where n.user_id = u.id and n.entity_id = NEW.id
        and n.type = 'announcement'::notification_type);
  return NEW;
end;
$function$;

create or replace function public.eip_notify_meeting_invited()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_m public.meeting; v_setting public.notification_setting; v_msg text; v_when text; v_line boolean;
begin
  select * into v_m from public.meeting where id = NEW.meeting_id;
  if v_m.id is null then return NEW; end if;

  select * into v_setting from public.notification_setting s
   where s.tenant_id = v_m.tenant_id and s.event_code = 'meeting_invited' and s.is_active
     and (s.department_id = v_m.department_id or s.department_id is null)
   order by (s.department_id is not null) desc limit 1;
  if not found or not v_setting.in_app_enabled then return NEW; end if;

  if NEW.user_id = coalesce(v_m.created_by, '00000000-0000-0000-0000-000000000000'::uuid) then
    return NEW;
  end if;

  select (coalesce(v_setting.line_enabled,false) and line_user_id is not null)
    into v_line from public.app_user where id = NEW.user_id and status = 'active';
  if v_line is null then return NEW; end if;   -- 收件人不存在或已停用

  v_when := coalesce(to_char(v_m.meeting_date, 'MM/DD'), '');
  v_msg := '【會議邀請】' || coalesce(v_m.title,'') ||
           case when v_when <> '' then '（' || v_when || '）' else '' end;

  insert into public.notification(tenant_id, user_id, type, entity_type, entity_id, message, line_pending)
  select v_m.tenant_id, NEW.user_id, 'assigned'::notification_type,
         'meeting'::notification_entity, v_m.id, v_msg, v_line
  where not exists (
    select 1 from public.notification n
    where n.user_id = NEW.user_id and n.entity_id = v_m.id
      and n.entity_type = 'meeting'::notification_entity
      and n.type = 'assigned'::notification_type);
  return NEW;
end;
$function$;

/* ---------- ② 清理已經卡住的 24 筆，並讓彙整函式自我修復 ---------- */

update public.notification n
   set line_pending = false
  from public.app_user u
 where u.id = n.user_id and n.line_pending
   and (u.line_user_id is null or u.status <> 'active');

create or replace function public.eip_send_line_digests()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_url text; v_key text; rec record; v_msg text; v_n int := 0;
begin
  -- 自我修復：沒綁 LINE 或已停用的人不該留在待推播佇列
  update public.notification n set line_pending = false
    from public.app_user u
   where u.id = n.user_id and n.line_pending
     and (u.line_user_id is null or u.status <> 'active');

  select value into v_url from public.app_config where key = 'line_push_url';
  select value into v_key from public.app_config where key = 'line_push_secret';
  if v_url is null or v_key is null then return 0; end if;

  for rec in
    select n.user_id, count(*) as cnt,
           string_agg('• ' || n.message, E'\n' order by n.created_at) as body
    from public.notification n
    join public.app_user u on u.id = n.user_id
    where n.line_pending and u.line_user_id is not null and u.status = 'active'
    group by n.user_id
  loop
    v_msg := left('【陞煇 EIP】通知 ' || rec.cnt || ' 則' || E'\n' || rec.body, 4800);
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
;
