-- 0103 通知系統收攏成單一入口
--
-- 為什麼做這件事：
--   在此之前，寫入 notification 的路徑有四條，各自實作同一套規則：
--     eip_emit_notification / eip_notify_user
--     eip_notify_announcement_published / eip_notify_meeting_invited
--   結果同一個錯誤要修三到四次。2026-07-28 一天內實際發生：
--     line_pending 來源錯誤（四份中三份錯）、新增參數沒移除舊重載（兩支各一次）、
--     在職檢查缺漏（三處）。每改一條規則就有三次漏掉的機會。
--
-- 收攏後的分工：
--   「誰該收到」＝各功能自己的業務邏輯（公告有發布對象、會議有出席者名單），
--     由 trigger 算出來後以 p_extra_user_ids 傳入。
--   「怎麼發」＝全部集中在 eip_emit_notification 一支：
--     排除動作發起人 / 只發在職者 / LINE 綁定判斷 / 優先級即時推播 / 去重 / 站內開關。
--   之後改規則只需要改這一支。

/* ---------- ① 收件人解析：支援外部傳入的指定名單 ---------- */

drop function if exists public.eip_notification_recipients(text, uuid, uuid, uuid);

create or replace function public.eip_notification_recipients(
  p_event_code text,
  p_department_id uuid default null,
  p_owner_id uuid default null,
  p_actor_id uuid default null,
  p_extra_user_ids uuid[] default null)
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

  -- 沒有啟用的設定＝這個事件不發通知（含 in_app 與 LINE）
  if not found then return; end if;

  -- 設定裡的收件範圍
  if v_setting.recipient_scopes is not null then
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
  end if;

  -- 各功能自行算出的指定名單（公告發布對象、會議出席者、特定處理人…）
  if p_extra_user_ids is not null then
    v_uids := v_uids || p_extra_user_ids;
  end if;

  -- 統一過濾：去重、排除發起人、只留在職、LINE 需真的綁定
  return query
    select distinct u.id, v_setting.in_app_enabled,
           (v_setting.line_enabled and u.line_user_id is not null)
    from unnest(v_uids) as uid
    join public.app_user u on u.id = uid
    where uid is not null
      and u.status = 'active'
      and (p_actor_id is null or u.id <> p_actor_id);
end;
$function$;

revoke all on function public.eip_notification_recipients(text, uuid, uuid, uuid, uuid[]) from public, anon;
grant execute on function public.eip_notification_recipients(text, uuid, uuid, uuid, uuid[]) to authenticated, service_role;

/* ---------- ② 唯一的發送入口 ---------- */

drop function if exists public.eip_emit_notification(
  text, uuid, uuid, uuid, notification_entity, uuid, notification_type, text, text);

create or replace function public.eip_emit_notification(
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
    select * from public.eip_notification_recipients(
      p_event_code, p_department_id, p_owner_id, p_actor_id, p_extra_user_ids)
  loop
    if rec.in_app then
      -- 緊急／高：例外通道，不看事件層的 LINE 開關，人有綁就立即推
      v_sent := false;
      if v_urgent then
        v_sent := public.eip_line_push_now(rec.user_id, v_prefix || p_message);
      end if;

      insert into public.notification(tenant_id, user_id, type, entity_type, entity_id,
                                      message, line_pending, priority, line_sent_at)
      select v_tenant, rec.user_id, p_notif_type, p_entity_type, p_entity_id,
             p_message,
             case when v_sent then false else rec.line_enabled end,
             coalesce(p_priority,'normal'),
             case when v_sent then now() else null end
      -- 去重：24 小時內同人同對象同型別且訊息完全相同才擋。
      -- 每日提醒（內容固定）只發一次；同日多次狀態變更（內容不同）每次都發。
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

revoke all on function public.eip_emit_notification(text, uuid, uuid, uuid, notification_entity, uuid, notification_type, text, text, uuid[]) from public, anon, authenticated;

comment on function public.eip_emit_notification(text, uuid, uuid, uuid, notification_entity, uuid, notification_type, text, text, uuid[]) is
  '全系統唯一的通知發送入口（0103 收攏）。所有發送規則只存在這裡：排除發起人、只發在職者、LINE 綁定判斷、緊急即時推播、24 小時同訊息去重。要改規則只改這一支。';

/* ---------- ③ eip_notify_user 改成薄包裝，不再自帶邏輯 ---------- */

drop function if exists public.eip_notify_user(
  uuid, notification_type, notification_entity, uuid, text, text);

create or replace function public.eip_notify_user(
  p_user_id uuid, p_type notification_type, p_entity_type notification_entity,
  p_entity_id uuid, p_message text, p_priority text default 'normal')
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_dept uuid;
begin
  if p_user_id is null then return 0; end if;
  select department_id into v_dept from public.app_user where id = p_user_id;
  -- 轉呼叫唯一入口。event_code 用 direct_notify（見 notification_setting），
  -- 收件人由 p_extra_user_ids 指定，不經收件範圍推導。
  return public.eip_emit_notification(
    'direct_notify', v_dept, p_user_id, null,
    p_entity_type, p_entity_id, p_type, p_message, p_priority,
    array[p_user_id]);
end;
$function$;

revoke all on function public.eip_notify_user(uuid, notification_type, notification_entity, uuid, text, text) from public, anon, authenticated;

-- direct_notify 的設定：收件範圍留空（由呼叫端指定），只控制開關
insert into public.notification_setting
  (tenant_id, event_code, department_id, recipient_scopes, notif_type, in_app_enabled, line_enabled, is_active)
select '00000000-0000-0000-0000-000000000001', 'direct_notify', null,
       '{}'::text[], 'assigned', true, true, true
where not exists (select 1 from public.notification_setting
                  where event_code='direct_notify' and department_id is null);

/* ---------- ④ 公告：收件人自算，發送走唯一入口 ---------- */

create or replace function public.eip_notify_announcement_published()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_user_ids uuid[] := '{}';
begin
  if NEW.published_at is null then return NEW; end if;
  if TG_OP = 'UPDATE' and OLD.published_at is not null then return NEW; end if;

  -- 公告有自己的發布對象邏輯，這是業務規則，留在這裡
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

  perform public.eip_emit_notification(
    'announcement_published', null, NEW.created_by, NEW.created_by,
    'announcement'::notification_entity, NEW.id, 'announcement'::notification_type,
    '新公告：' || NEW.title, 'normal', v_user_ids);
  return NEW;
end;
$function$;

-- 公告的收件人由 audience 決定，收件範圍不再需要 all_company（否則會蓋過指定對象）
update public.notification_setting
   set recipient_scopes = '{}'::text[], updated_at = now()
 where event_code = 'announcement_published';

/* ---------- ⑤ 會議邀請：同上 ---------- */

create or replace function public.eip_notify_meeting_invited()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_m public.meeting; v_when text;
begin
  select * into v_m from public.meeting where id = NEW.meeting_id;
  if v_m.id is null then return NEW; end if;

  v_when := coalesce(to_char(v_m.meeting_date, 'MM/DD'), '');

  -- 只通知這次新加入的出席者；建立者由 p_actor_id 排除
  perform public.eip_emit_notification(
    'meeting_invited', v_m.department_id, NEW.user_id, v_m.created_by,
    'meeting'::notification_entity, v_m.id, 'assigned'::notification_type,
    '【會議邀請】' || coalesce(v_m.title,'') ||
      case when v_when <> '' then '（' || v_when || '）' else '' end,
    'normal', array[NEW.user_id]);
  return NEW;
end;
$function$;

-- 會議邀請的收件人＝該出席者，收件範圍不再需要主管（維持原本只通知出席者的行為）
update public.notification_setting
   set recipient_scopes = '{}'::text[], updated_at = now()
 where event_code = 'meeting_invited';
;
