-- 在目標 Supabase 專案的 SQL Editor 以 postgres 執行。
-- 安裝不會立即刪除資料；首次清理在下一次台北 06:00。
-- 僅清理 error_logs / activity_logs / audit_logs；既有綜合清理排程不取代。
begin;

do $check$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception '請先在 Supabase 啟用 pg_cron，再執行本程式';
  end if;
  if current_setting('cron.timezone', true) is not null
     and current_setting('cron.timezone', true) not in ('GMT', 'UTC', 'Etc/UTC') then
    raise exception 'cron.timezone 必須為 UTC / GMT，避免清理時間錯位';
  end if;
  if to_regclass('public.error_logs') is null
     or to_regclass('public.activity_logs') is null
     or to_regclass('public.audit_logs') is null
     or to_regclass('public.eip_purge_policy') is null
     or to_regclass('public.eip_purge_run_log') is null then
    raise exception '請先完成 EIP 資料表遷移，缺少日誌、清理設定或清理執行紀錄表';
  end if;
end;
$check$;

create or replace function public.eip_cleanup_system_logs(
  p_dry_run boolean default true,
  p_batch_size integer default 5000
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_started timestamptz := clock_timestamp();
  v_cutoff timestamptz;
  v_table text;
  v_days integer;
  v_active boolean;
  v_count bigint;
  v_detail jsonb := '{}'::jsonb;
  v_ok boolean := true;
  v_error text;
begin
  if p_dry_run is null or p_batch_size is null
     or p_batch_size < 1 or p_batch_size > 50000 then
    raise exception '試跑參數不可為空，每張表每次清理筆數必須介於 1 與 50000';
  end if;

  -- 同時執行的手動／排程清理只允許一個；交易結束後自動解鎖。
  if not pg_try_advisory_xact_lock(hashtextextended('eip_cleanup_system_logs', 0)) then
    return jsonb_build_object('ok', true, 'skipped', 'already_running');
  end if;

  foreach v_table in array array['error_logs', 'activity_logs', 'audit_logs'] loop
    begin
      select days, is_active into v_days, v_active
        from public.eip_purge_policy where key = v_table;
      -- 保留現有設定；設定不存在時沿用既有系統日誌預設 90 天。
      if not found then
        v_days := 90;
        v_active := true;
      end if;
      if not v_active then
        v_detail := v_detail || jsonb_build_object(v_table, jsonb_build_object('skipped', 'disabled'));
        continue;
      end if;
      if v_days is null or v_days < 1 then
        raise exception '無效的保留天數：%', v_table;
      end if;
      v_cutoff := now() - make_interval(days => v_days);

      if p_dry_run then
        execute format('select count(*) from public.%I where created_at < $1', v_table)
          into v_count using v_cutoff;
      else
        -- 每表限制筆數；SKIP LOCKED 避免等待使用中的紀錄。
        execute format(
          'with doomed as (
             select ctid from public.%I where created_at < $1
             order by created_at limit $2 for update skip locked
           ) delete from public.%I where ctid in (select ctid from doomed)',
          v_table, v_table)
          using v_cutoff, p_batch_size;
        get diagnostics v_count = row_count;
      end if;
      v_detail := v_detail || jsonb_build_object(v_table,
        jsonb_build_object('days', v_days, 'rows', v_count, 'dry_run', p_dry_run));
    exception when others then
      v_ok := false;
      get stacked diagnostics v_error = message_text;
      v_detail := v_detail || jsonb_build_object(v_table, jsonb_build_object('error', v_error));
    end;
  end loop;

  insert into public.eip_purge_run_log(dry_run, ok, duration_ms, detail, error)
  values (p_dry_run, v_ok,
    (extract(epoch from (clock_timestamp() - v_started)) * 1000)::integer,
    jsonb_build_object('job', 'eip_cleanup_system_logs', 'tables', v_detail),
    case when v_ok then null else '部分日誌清理失敗，請查看 detail' end);
  if not v_ok then
    raise warning '部分日誌清理失敗，詳見 eip_purge_run_log';
  end if;
  return jsonb_build_object('ok', v_ok, 'dry_run', p_dry_run, 'tables', v_detail);
end;
$function$;

-- 不允許一般使用者透過 RPC 永久刪除日誌；僅排程與可信任服務可執行。
revoke all on function public.eip_cleanup_system_logs(boolean, integer) from public, anon, authenticated;
grant execute on function public.eip_cleanup_system_logs(boolean, integer) to postgres, service_role;

do $schedule$
declare
  v_job record;
  v_command text := 'select public.eip_cleanup_system_logs(false, 5000);';
begin
  select jobid, command into v_job from cron.job
    where jobname = 'eip-log-purge-daily' and username = current_user;
  if found then
    if position('eip_purge_maintenance' in v_job.command) > 0 then
      -- 綜合清理還包含通知、對話、回收區；保留原指令及其他工作。
      perform cron.alter_job(v_job.jobid, schedule := '0 22 * * *', active := true);
      raise notice '保留既有綜合清理程式，每天台北 06:00 執行；新增日誌程式可手動試跑';
    elsif position('eip_purge_old_logs' in v_job.command) > 0
       or position('eip_cleanup_system_logs' in v_job.command) > 0 then
      perform cron.alter_job(v_job.jobid, schedule := '0 22 * * *', command := v_command, active := true);
    else
      raise exception '同名排程使用未知指令，已取消安裝，避免覆寫其他工作';
    end if;
  else
    perform cron.schedule('eip-log-purge-daily', '0 22 * * *', v_command);
  end if;
end;
$schedule$;

commit;

-- 安裝後確認排程（不刪資料）。
select jobname, schedule, command, active from cron.job
where jobname = 'eip-log-purge-daily' and username = current_user;

-- 手動試跑：只統計待清理筆數，仍會新增一筆執行紀錄。
-- select public.eip_cleanup_system_logs(true, 5000);
-- 手動正式清理（不可在尚未確認試跑結果前執行）：
-- select public.eip_cleanup_system_logs(false, 5000);
-- 查看最近結果：
-- select ran_at, dry_run, ok, duration_ms, detail, error
-- from public.eip_purge_run_log order by ran_at desc limit 20;
-- 停用每天清理（不移除資料或程式）：
-- select cron.alter_job(jobid, active := false) from cron.job
-- where jobname = 'eip-log-purge-daily' and username = current_user;