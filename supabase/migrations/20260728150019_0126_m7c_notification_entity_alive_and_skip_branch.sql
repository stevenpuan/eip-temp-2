-- 0126 稽核收尾兩項：M7c（通知比實體活得久）＋ line-push 的 skip 分支被誤判為失敗

------------------------------------------------------------------
-- M7c：notification.entity_id 對各實體表沒有 FK，實體被軟刪或硬刪之後通知還留著。
--      使用者點下去 → RLS 回 0 列 → 空白頁或 404，看起來像壞掉。
--      不用 trigger 去追（硬刪的 project / meeting 沒有 guard 可掛，追不到），
--      改成讀取時即時判定：一支函式回「這則通知指向的東西還在不在」。
--
--      SECURITY DEFINER 是必要的：要能看穿 RLS 才判斷得出「存在但你看不到」
--      與「已經不存在」的差別。只回 boolean，且使用者本來就持有這則通知，
--      不會因此多知道任何事。
------------------------------------------------------------------
create or replace function public.eip_notification_entity_alive(
  p_entity_type notification_entity, p_entity_id uuid)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_alive boolean;
begin
  if p_entity_id is null then return true; end if;   -- 沒指向實體的通知（純訊息）視為有效

  case p_entity_type
    when 'task' then
      select exists (select 1 from public.task where id = p_entity_id and deleted_at is null) into v_alive;
    when 'announcement' then
      select exists (select 1 from public.announcement where id = p_entity_id and deleted_at is null) into v_alive;
    when 'quick_report' then
      select exists (select 1 from public.eip_quick_report where id = p_entity_id and deleted_at is null) into v_alive;
    when 'leave_handover' then
      select exists (select 1 from public.eip_quick_report where id = p_entity_id and deleted_at is null) into v_alive;
    when 'work_log' then
      select exists (select 1 from public.work_log where id = p_entity_id and deleted_at is null) into v_alive;
    when 'anomaly' then
      select exists (select 1 from public.eip_anomaly where id = p_entity_id and deleted_at is null) into v_alive;
    when 'meeting' then
      -- 硬刪表，沒有 deleted_at
      select exists (select 1 from public.meeting where id = p_entity_id) into v_alive;
    when 'project' then
      select exists (select 1 from public.project where id = p_entity_id) into v_alive;
    when 'handover' then
      select exists (select 1 from public.eip_handover_item where id = p_entity_id) into v_alive;
    else
      v_alive := true;   -- 未知類別不要誤判成已刪除
  end case;

  return coalesce(v_alive, false);
end;
$function$;

revoke execute on function public.eip_notification_entity_alive(notification_entity, uuid) from public, anon;
grant execute on function public.eip_notification_entity_alive(notification_entity, uuid) to authenticated;

-- 通知中心讀這個 view：多一個 entity_alive 欄位，前端就能把已失效的那則
-- 標成「原項目已刪除」並停用連結，而不是讓人點進空白頁。
-- security_invoker = true → notification 自己的 RLS 照常生效（只看得到自己的）。
create or replace view public.eip_my_notifications as
  select n.*,
         public.eip_notification_entity_alive(n.entity_type, n.entity_id) as entity_alive
    from public.notification n;

alter view public.eip_my_notifications set (security_invoker = true);
grant select on public.eip_my_notifications to authenticated;
revoke all on public.eip_my_notifications from anon;

------------------------------------------------------------------
-- line-push 的 skip 分支：缺 LINE_CHANNEL_ACCESS_TOKEN、或使用者未綁 LINE 時，
-- Edge Function 回 200 但 body 是 {"skip":"原因"}、沒有 line_status。
-- 原本 eip_line_status() 回 null → coalesce(...,0) → 判為失敗 → 重試 3 次 →
-- 最後寫「HTTP 200（已重試 3 次）」，訊息完全誤導（真正原因是設定或綁定問題）。
--
-- 這兩種原因重試都不會好，所以直接結案並寫下真正的原因。
------------------------------------------------------------------
create or replace function public.eip_line_skip_reason(t text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select public.eip_try_jsonb(t) ->> 'skip';
$function$;

revoke execute on function public.eip_line_skip_reason(text) from public, anon, authenticated;

create or replace function public.eip_confirm_line_delivery()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_ok int := 0; v_reset timestamptz;
begin
  v_reset := date_trunc('month', now()) + interval '1 month';

  -- 真正送達：Edge Function 2xx 且 LINE 也回 2xx
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

  -- skip：設定或綁定問題，重試不會好 → 直接結案並寫真正的原因，不要再耗 3 次重試
  update public.notification n
     set line_pending = false,
         line_request_id = null,
         line_error = left('未送出：' || public.eip_line_skip_reason(r.content), 200)
    from net._http_response r
   where r.id = n.line_request_id and n.line_pending
     and public.eip_line_skip_reason(r.content) is not null;

  -- LINE 429 月額度用盡：改記「封鎖到額度重置」，不消耗重試次數
  update public.notification n
     set line_request_id = null,
         line_blocked_until = v_reset,
         line_error = 'LINE 月推播額度已用盡（429），' ||
                      to_char(v_reset, 'MM/DD') || ' 額度重置後自動重送'
    from net._http_response r
   where r.id = n.line_request_id and n.line_pending
     and coalesce(public.eip_line_status(r.content), 0) = 429;

  -- 其他失敗且還有重試額度
  update public.notification n
     set line_request_id = null,
         line_error = left(coalesce(
           'LINE ' || public.eip_line_status(r.content)::text,
           r.error_msg,
           'HTTP ' || r.status_code::text), 200)
    from net._http_response r
   where r.id = n.line_request_id and n.line_pending
     and public.eip_line_skip_reason(r.content) is null
     and coalesce(public.eip_line_status(r.content), 0) <> 429
     and (r.status_code is null or r.status_code >= 300
          or coalesce(public.eip_line_status(r.content), 0) >= 300)
     and n.line_attempts < 3;

  -- 重試耗盡
  update public.notification n
     set line_pending = false,
         line_error = left(coalesce(
           'LINE ' || public.eip_line_status(r.content)::text,
           r.error_msg,
           'HTTP ' || r.status_code::text), 180) || '（已重試 3 次）'
    from net._http_response r
   where r.id = n.line_request_id and n.line_pending
     and public.eip_line_skip_reason(r.content) is null
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

  -- H4 絕對上限：卡超過 30 天一律放棄
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

revoke execute on function public.eip_confirm_line_delivery() from public, anon, authenticated;;
