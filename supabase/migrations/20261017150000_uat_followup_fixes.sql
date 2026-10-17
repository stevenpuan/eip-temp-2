-- 客戶測試前總檢查・後續修正（2026-10-17）
-- 已套用到 Supabase 專案 tjkeycrbgkyvlxwywyvt（分兩段：uat_followup_fixes_a＝第 1、2、4 節的函式與設定；
--   uat_followup_fixes_b＝第 3 節與 eip_purge_line_data／排程，含刪除語句需人工確認）

------------------------------------------------------------
-- 1. 公告：指定部門／指定人員的公告不會發通知
--    前台先新增公告、再寫發布對象（announcement_target）；新增公告當下觸發器找不到對象 → 0 人。
--    改成：新增公告時若還沒有對象就先不發，由「寫入對象」時補發；已通知過的人不再重複通知。
------------------------------------------------------------
create or replace function public.eip_notify_announcement_published()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_user_ids uuid[] := '{}';
begin
  if NEW.published_at is null then return NEW; end if;
  if TG_OP = 'UPDATE' and OLD.published_at is not null then return NEW; end if;

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

  -- 指定部門／人員但對象還沒寫入：交給 announcement_target 的觸發器發
  if NEW.audience_type in ('department', 'users') and coalesce(array_length(v_user_ids, 1), 0) = 0 then
    return NEW;
  end if;

  perform public.eip_emit_notification(
    'announcement_published', null, NEW.created_by, NEW.created_by,
    'announcement'::notification_entity, NEW.id, 'announcement'::notification_type,
    '新公告：' || NEW.title, 'normal', v_user_ids);
  return NEW;
end;
$function$;

create or replace function public.eip_notify_announcement_targets()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare a record; v_ids uuid[];
begin
  for a in
    select distinct an.id, an.tenant_id, an.title, an.created_by, an.audience_type
      from public.announcement an
      join new_rows t on t.announcement_id = an.id
     where an.published_at is not null and an.deleted_at is null
       and an.audience_type in ('department', 'users')
  loop
    v_ids := array(
      select distinct u.id
        from public.app_user u
        join new_rows t on t.announcement_id = a.id
         and ((a.audience_type = 'department' and t.department_id = u.department_id)
           or (a.audience_type = 'users' and t.user_id = u.id))
       where u.tenant_id = a.tenant_id and u.status = 'active'
         and not exists (select 1 from public.notification n
                          where n.user_id = u.id and n.entity_id = a.id
                            and n.type = 'announcement'::notification_type));
    if coalesce(array_length(v_ids, 1), 0) > 0 then
      perform public.eip_emit_notification(
        'announcement_published', null, a.created_by, a.created_by,
        'announcement'::notification_entity, a.id, 'announcement'::notification_type,
        '新公告：' || a.title, 'normal', v_ids);
    end if;
  end loop;
  return null;
end;
$function$;

create or replace trigger trg_announcement_target_notify
  after insert on public.announcement_target
  referencing new table as new_rows
  for each statement execute function public.eip_notify_announcement_targets();

------------------------------------------------------------
-- 2. 會議決議轉任務：帶入部門（負責人的部門，沒有就用會議的部門）與專案；
--    「僅成員可見」的會議，轉出的任務也只限相關人員
------------------------------------------------------------
create or replace function public.trg_action_item_auto_convert_task()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_sid uuid; v_task_id uuid; v_creator uuid;
  v_m_dept uuid; v_m_proj uuid; v_m_scope visibility_scope; v_owner_dept uuid;
begin
  if NEW.status <> 'converted'
     or NEW.linked_task_id is not null
     or (TG_OP = 'UPDATE' and OLD.status = 'converted') then
    return NEW;
  end if;

  select id into v_sid from task_status
    where tenant_id = NEW.tenant_id and is_default and not is_done_state
    order by sort_order limit 1;
  if v_sid is null then
    raise warning '找不到預設任務狀態，跳過自動轉任務 (action_item=%)', NEW.id;
    return NEW;
  end if;

  select m.department_id, m.project_id, m.visibility_scope
    into v_m_dept, v_m_proj, v_m_scope
    from meeting m where m.id = NEW.meeting_id;
  select department_id into v_owner_dept from app_user where id = NEW.owner_id;

  v_creator := coalesce(auth.uid(), NEW.owner_id);

  insert into task (tenant_id, title, owner_id, status_id, priority, progress, due_date, created_by,
                    department_id, project_id, visibility_scope)
  values (NEW.tenant_id, NEW.content, NEW.owner_id, v_sid, 'normal', 0, NEW.due_date, v_creator,
          coalesce(v_owner_dept, v_m_dept), v_m_proj,
          case when v_m_scope = 'members' then 'members'::visibility_scope else 'company'::visibility_scope end)
  returning id into v_task_id;

  NEW.linked_task_id := v_task_id;
  return NEW;
end;
$function$;

-- 既有已轉出的任務補上部門／專案
update public.task t
   set department_id = coalesce(t.department_id, u.department_id, m.department_id),
       project_id = coalesce(t.project_id, m.project_id)
  from public.meeting_action_item ai
  join public.meeting m on m.id = ai.meeting_id
  left join public.app_user u on u.id = ai.owner_id
 where ai.linked_task_id = t.id
   and (t.department_id is null or (t.project_id is null and m.project_id is not null));

------------------------------------------------------------
-- 3. 任務類型「拍攝影片」是陞輝遺留（艾士沒有這項作業）；沒有任務使用才移除
------------------------------------------------------------
delete from public.task_type tt
 where tt.name = '拍攝影片'
   and not exists (select 1 from public.task t where t.type_id = tt.id);

------------------------------------------------------------
-- 4. LINE 原始訊息與訂單附件：保存 180 天
--    * line_inbound_message：超過期限直接刪（訂單本身不受影響）
--    * 訂單附件檔：必須透過 Storage API 刪（直接刪 storage.objects 不會刪到實體檔），
--      由 line-push 的維護動作（action=purge_order_files）刪檔後，把訂單上的附件標成「已過保存期限」
------------------------------------------------------------
insert into public.eip_purge_policy (key, label, days, is_active, note) values
  ('line_inbound_message', 'LINE 原始訊息 line_inbound_message', 180, true, '老闆從 LINE 傳來的原文與 AI 解析紀錄；訂單本身不刪'),
  ('sales_order_files', '訂單附件檔案', 180, true, '訂單上的照片／PDF／Excel 原始檔；訂單與品項資料保留，附件標示「已過保存期限」')
on conflict (key) do nothing;

-- 到期的附件（只給後端維護動作用）
create or replace function public.eip_order_files_due(p_days int, p_limit int default 500)
returns table(order_id uuid, path text)
language sql stable security definer set search_path to 'public' as $$
  select o.id, a->>'path'
    from public.eip_sales_order o,
         jsonb_array_elements(case when jsonb_typeof(o.attachments) = 'array' then o.attachments else '[]'::jsonb end) a
   where o.created_at < now() - make_interval(days => greatest(coalesce(p_days, 180), 30))
     and coalesce((a->>'expired')::boolean, false) = false
     and nullif(a->>'path', '') is not null
   order by o.created_at
   limit greatest(coalesce(p_limit, 500), 1);
$$;

-- 檔案刪除後，把訂單上的附件標成已過期（保留檔名，畫面顯示「已過保存期限」）
create or replace function public.eip_mark_order_files_expired(p_paths text[])
returns int language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  update public.eip_sales_order o
     set attachments = (
       select coalesce(jsonb_agg(case when x.a->>'path' = any(p_paths)
                                      then x.a || jsonb_build_object('expired', true, 'expired_at', now())
                                      else x.a end order by x.ord), '[]'::jsonb)
         from jsonb_array_elements(o.attachments) with ordinality as x(a, ord))
   where jsonb_typeof(o.attachments) = 'array'
     and exists (select 1 from jsonb_array_elements(o.attachments) e where e->>'path' = any(p_paths));
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.eip_order_files_due(int, int) from public, anon, authenticated;
revoke all on function public.eip_mark_order_files_expired(text[]) from public, anon, authenticated;
grant execute on function public.eip_order_files_due(int, int) to service_role;
grant execute on function public.eip_mark_order_files_expired(text[]) to service_role;

create or replace function public.eip_purge_line_data(p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_start timestamptz := clock_timestamp();
  v_detail jsonb := '{}'::jsonb;
  v_days int; v_n bigint; v_err text;
  v_url text; v_key text; v_req bigint;
begin
  if auth.uid() is not null and coalesce(public.current_role_name()::text, '') <> 'company_admin' then
    raise exception '權限不足：只有管理者可以執行資料清除';
  end if;

  -- LINE 原始訊息
  select days into v_days from public.eip_purge_policy where key = 'line_inbound_message' and is_active;
  if v_days is not null then
    begin
      if p_dry_run then
        select count(*) into v_n from public.line_inbound_message
         where created_at < now() - make_interval(days => v_days);
      else
        delete from public.line_inbound_message
         where created_at < now() - make_interval(days => v_days);
        get diagnostics v_n = row_count;
      end if;
      v_detail := v_detail || jsonb_build_object('line_inbound_message', v_n);
    exception when others then
      get stacked diagnostics v_err = message_text;
      v_detail := v_detail || jsonb_build_object('line_inbound_message', 'ERROR: ' || v_err);
    end;
  end if;

  -- 訂單附件檔：交給 line-push 的維護動作透過 Storage API 刪除
  select days into v_days from public.eip_purge_policy where key = 'sales_order_files' and is_active;
  if v_days is not null then
    begin
      select count(*) into v_n from public.eip_order_files_due(v_days, 100000);
      v_detail := v_detail || jsonb_build_object('sales_order_files_due', v_n);
      if not p_dry_run and v_n > 0 then
        select value into v_url from public.app_config where key = 'line_push_url';
        select value into v_key from public.app_config where key = 'line_push_secret';
        if v_url is not null and v_key is not null then
          select net.http_post(
            url := v_url,
            headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-key', v_key),
            body := jsonb_build_object('action', 'purge_order_files', 'days', v_days),
            timeout_milliseconds := 60000) into v_req;
          v_detail := v_detail || jsonb_build_object('sales_order_files_request', v_req);
        else
          v_detail := v_detail || jsonb_build_object('sales_order_files_request', 'SKIP: 尚未設定 line_push_url／line_push_secret');
        end if;
      end if;
    exception when others then
      get stacked diagnostics v_err = message_text;
      v_detail := v_detail || jsonb_build_object('sales_order_files', 'ERROR: ' || v_err);
    end;
  end if;

  insert into public.eip_purge_run_log(dry_run, ok, duration_ms, detail)
  values (p_dry_run, true, (extract(epoch from (clock_timestamp() - v_start)) * 1000)::int,
          v_detail || jsonb_build_object('job', 'eip_purge_line_data'));
  return v_detail;
end;
$function$;

revoke all on function public.eip_purge_line_data(boolean) from public, anon;
grant execute on function public.eip_purge_line_data(boolean) to authenticated, service_role;

-- 排程白名單加上新工作
create or replace function public.eip_cron_guarded(p_job text)
returns void language plpgsql security definer set search_path to 'public' as $function$
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
      when 'eip_purge_line_data'       then perform public.eip_purge_line_data();
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

-- 每天台北 06:10（UTC 22:10），排在既有 06:00 綜合清理之後
select cron.schedule('eip-line-data-purge-daily', '10 22 * * *',
                     $$select public.eip_cron_guarded('eip_purge_line_data')$$);
