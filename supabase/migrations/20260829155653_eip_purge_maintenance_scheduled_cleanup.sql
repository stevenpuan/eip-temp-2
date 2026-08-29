-- 後台定期清除程式：參數表 + 執行紀錄 + 統一清除函式
-- 2026-08-29 客戶決策：系統日誌維持 90 天；成長表分類保留；回收區 180 天且沿用既有稽核保護。

-- ────────────────────────────────────────────────────────────
-- 1) 可調參數表（日誌與成長表）
-- ────────────────────────────────────────────────────────────
create table if not exists public.eip_purge_policy (
  key        text primary key,
  label      text not null,
  days       integer not null check (days > 0),
  is_active  boolean not null default true,
  note       text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

comment on table public.eip_purge_policy is
  '後台定期清除程式的保留天數設定；改這裡就會生效，不必改程式碼。';

insert into public.eip_purge_policy(key, label, days, note) values
  ('error_logs',            '錯誤紀錄 error_logs',              90,  '系統錯誤日誌'),
  ('activity_logs',         '操作紀錄 activity_logs',            90,  '使用者操作軌跡'),
  ('audit_logs',            '稽核紀錄 audit_logs',               90,  '權限與資料稽核軌跡'),
  ('notification',          '站內通知 notification',            180, '超過保留期一併清除；那麼久的 LINE 待送也已無法送出'),
  ('eip_notification_miss', '通知失敗紀錄 eip_notification_miss', 90,  '純除錯用，沒有任何頁面在讀'),
  ('eip_assistant',         'AI 助理對話',                       180, '依對話最後一則訊息時間計算，整段對話一起清'),
  ('line_bind_code',        'LINE 綁定碼',                       7,   '已使用或已過期的綁定碼')
on conflict (key) do nothing;

alter table public.eip_purge_policy enable row level security;

drop policy if exists eip_purge_policy_admin_read on public.eip_purge_policy;
create policy eip_purge_policy_admin_read on public.eip_purge_policy
  for select to authenticated
  using (coalesce(public.current_role_name()::text, '') = 'company_admin');

drop policy if exists eip_purge_policy_admin_write on public.eip_purge_policy;
create policy eip_purge_policy_admin_write on public.eip_purge_policy
  for update to authenticated
  using (coalesce(public.current_role_name()::text, '') = 'company_admin')
  with check (coalesce(public.current_role_name()::text, '') = 'company_admin');

-- ────────────────────────────────────────────────────────────
-- 2) 執行紀錄表（每天跑完留一筆，看得到刪了什麼）
-- ────────────────────────────────────────────────────────────
create table if not exists public.eip_purge_run_log (
  id          bigserial primary key,
  ran_at      timestamptz not null default now(),
  dry_run     boolean not null default false,
  ok          boolean not null,
  duration_ms integer,
  detail      jsonb,
  error       text
);

create index if not exists ix_eip_purge_run_log_ran_at
  on public.eip_purge_run_log (ran_at desc);

alter table public.eip_purge_run_log enable row level security;

drop policy if exists eip_purge_run_log_admin_read on public.eip_purge_run_log;
create policy eip_purge_run_log_admin_read on public.eip_purge_run_log
  for select to authenticated
  using (coalesce(public.current_role_name()::text, '') = 'company_admin');

-- ────────────────────────────────────────────────────────────
-- 3) 回收區保留天數：終於有程式會讀 retention_days 了
-- ────────────────────────────────────────────────────────────
update public.eip_deletion_policy
   set retention_days = 180
 where is_active and retention_days is null;

-- ────────────────────────────────────────────────────────────
-- 4) 統一清除函式
-- ────────────────────────────────────────────────────────────
create or replace function public.eip_purge_maintenance(
  p_dry_run       boolean default false,
  p_max_per_table integer default 500
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_start   timestamptz := clock_timestamp();
  v_detail  jsonb := '{}'::jsonb;
  v_err     text;
  v_days    int;
  v_n       bigint;
  r         record;
begin
  -- 由 cron 呼叫時 auth.uid() 是 null；從前台呼叫則限管理者。
  if auth.uid() is not null
     and coalesce(public.current_role_name()::text, '') <> 'company_admin' then
    raise exception '權限不足：只有管理者可以執行資料清除';
  end if;

  ------------------------------------------------------------
  -- A. 三張系統日誌（created_at 為準，硬刪）
  ------------------------------------------------------------
  for r in
    select key, days from public.eip_purge_policy
     where is_active and key in ('error_logs', 'activity_logs', 'audit_logs')
     order by key
  loop
    begin
      if p_dry_run then
        execute format(
          'select count(*) from public.%I where created_at < now() - make_interval(days => $1)',
          r.key) into v_n using r.days;
      else
        execute format(
          'delete from public.%I where created_at < now() - make_interval(days => $1)',
          r.key) using r.days;
        get diagnostics v_n = row_count;
      end if;
      v_detail := v_detail || jsonb_build_object(r.key, v_n);
    exception when others then
      get stacked diagnostics v_err = message_text;
      v_detail := v_detail || jsonb_build_object(r.key, 'ERROR: ' || v_err);
    end;
  end loop;

  ------------------------------------------------------------
  -- B1. 站內通知
  ------------------------------------------------------------
  select days into v_days from public.eip_purge_policy
   where key = 'notification' and is_active;
  if v_days is not null then
    begin
      if p_dry_run then
        select count(*) into v_n from public.notification
         where created_at < now() - make_interval(days => v_days);
      else
        delete from public.notification
         where created_at < now() - make_interval(days => v_days);
        get diagnostics v_n = row_count;
      end if;
      v_detail := v_detail || jsonb_build_object('notification', v_n);
    exception when others then
      get stacked diagnostics v_err = message_text;
      v_detail := v_detail || jsonb_build_object('notification', 'ERROR: ' || v_err);
    end;
  end if;

  ------------------------------------------------------------
  -- B2. 通知失敗紀錄
  ------------------------------------------------------------
  select days into v_days from public.eip_purge_policy
   where key = 'eip_notification_miss' and is_active;
  if v_days is not null then
    begin
      if p_dry_run then
        select count(*) into v_n from public.eip_notification_miss
         where created_at < now() - make_interval(days => v_days);
      else
        delete from public.eip_notification_miss
         where created_at < now() - make_interval(days => v_days);
        get diagnostics v_n = row_count;
      end if;
      v_detail := v_detail || jsonb_build_object('eip_notification_miss', v_n);
    exception when others then
      get stacked diagnostics v_err = message_text;
      v_detail := v_detail || jsonb_build_object('eip_notification_miss', 'ERROR: ' || v_err);
    end;
  end if;

  ------------------------------------------------------------
  -- B3. AI 助理對話（刪對話，訊息 cascade 一起走）
  ------------------------------------------------------------
  select days into v_days from public.eip_purge_policy
   where key = 'eip_assistant' and is_active;
  if v_days is not null then
    begin
      if p_dry_run then
        select count(*) into v_n
          from public.eip_assistant_conversation c
         where greatest(
                 c.created_at,
                 coalesce((select max(m.created_at) from public.eip_assistant_message m
                            where m.conversation_id = c.id), c.created_at)
               ) < now() - make_interval(days => v_days);
      else
        delete from public.eip_assistant_conversation c
         where greatest(
                 c.created_at,
                 coalesce((select max(m.created_at) from public.eip_assistant_message m
                            where m.conversation_id = c.id), c.created_at)
               ) < now() - make_interval(days => v_days);
        get diagnostics v_n = row_count;
      end if;
      v_detail := v_detail || jsonb_build_object('eip_assistant_conversation', v_n);
    exception when others then
      get stacked diagnostics v_err = message_text;
      v_detail := v_detail || jsonb_build_object('eip_assistant_conversation', 'ERROR: ' || v_err);
    end;
  end if;

  ------------------------------------------------------------
  -- B4. LINE 綁定碼（已用 / 已過期 / 太舊）
  ------------------------------------------------------------
  select days into v_days from public.eip_purge_policy
   where key = 'line_bind_code' and is_active;
  if v_days is not null then
    begin
      if p_dry_run then
        select count(*) into v_n from public.line_bind_code
         where coalesce(used_at, expires_at, created_at) < now() - make_interval(days => v_days);
      else
        delete from public.line_bind_code
         where coalesce(used_at, expires_at, created_at) < now() - make_interval(days => v_days);
        get diagnostics v_n = row_count;
      end if;
      v_detail := v_detail || jsonb_build_object('line_bind_code', v_n);
    exception when others then
      get stacked diagnostics v_err = message_text;
      v_detail := v_detail || jsonb_build_object('line_bind_code', 'ERROR: ' || v_err);
    end;
  end if;

  ------------------------------------------------------------
  -- C. 回收區（軟刪除）：超過 retention_days 才永久刪，
  --    且沿用 purge_guard —— 有協作者／變更紀錄／主管看過的一律留著。
  ------------------------------------------------------------
  declare
    v_purged_all int := 0;
    v_blocked_all int := 0;
  begin
    for r in
      select module_key, table_name, purge_guard, retention_days
        from public.eip_deletion_policy
       where is_active and coalesce(retention_days, 0) > 0
       order by module_key
    loop
      declare
        v_id      uuid;
        v_block   text;
        v_purged  int := 0;
        v_blocked int := 0;
      begin
        for v_id in execute format(
          'select id from public.%I
            where deleted_at is not null
              and deleted_at < now() - make_interval(days => $1)
            order by deleted_at
            limit $2', r.table_name)
          using r.retention_days, p_max_per_table
        loop
          v_block := null;
          if r.purge_guard is not null then
            execute format('select public.%I($1)', r.purge_guard) into v_block using v_id;
          end if;

          if v_block is not null then
            v_blocked := v_blocked + 1;
            continue;
          end if;

          if not p_dry_run then
            -- 9 張表有 BEFORE DELETE 軟刪除守衛，這個旗標才放行真正的 DELETE
            perform set_config('eip.allow_purge', 'on', true);
            begin
              execute format('delete from public.%I where id = $1', r.table_name) using v_id;
            exception when others then
              perform set_config('eip.allow_purge', 'off', true);
              raise;
            end;
            perform set_config('eip.allow_purge', 'off', true);
          end if;

          v_purged := v_purged + 1;
        end loop;

        v_detail := v_detail || jsonb_build_object(
          'recycle:' || r.module_key,
          jsonb_build_object('purged', v_purged, 'blocked', v_blocked));
        v_purged_all  := v_purged_all + v_purged;
        v_blocked_all := v_blocked_all + v_blocked;
      exception when others then
        get stacked diagnostics v_err = message_text;
        perform set_config('eip.allow_purge', 'off', true);
        v_detail := v_detail || jsonb_build_object(
          'recycle:' || r.module_key, 'ERROR: ' || v_err);
      end;
    end loop;

    v_detail := v_detail || jsonb_build_object(
      'recycle_total',
      jsonb_build_object('purged', v_purged_all, 'blocked', v_blocked_all));
  end;

  ------------------------------------------------------------
  insert into public.eip_purge_run_log(dry_run, ok, duration_ms, detail)
  values (p_dry_run, true,
          (extract(epoch from (clock_timestamp() - v_start)) * 1000)::int,
          v_detail);

  return v_detail;
end;
$fn$;

comment on function public.eip_purge_maintenance(boolean, integer) is
  '後台定期清除程式。保留天數讀 eip_purge_policy 與 eip_deletion_policy.retention_days；'
  '每次執行寫一筆 eip_purge_run_log。p_dry_run=true 只統計不刪。';

revoke all on function public.eip_purge_maintenance(boolean, integer) from public, anon;
grant execute on function public.eip_purge_maintenance(boolean, integer) to authenticated;

-- ────────────────────────────────────────────────────────────
-- 5) 排程包裝函式加上新分支（舊的 eip_purge_old_logs 保留不動）
-- ────────────────────────────────────────────────────────────
create or replace function public.eip_cron_guarded(p_job text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
      else raise exception '未知的排程工作：%', p_job;
    end case;
    return;
  exception when others then
    get stacked diagnostics
      v_err   = message_text,
      v_state = returned_sqlstate,
      v_ctx   = pg_exception_context;
  end;

  -- 訊息刻意只帶「台北日期＋工作名＋錯誤」，不帶時間：
  -- eip_emit_notification 會用訊息內容在 20 小時內去重，
  -- 所以每 5 分鐘執行的工作連續失敗也只會通知一次。
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
$function$;;
