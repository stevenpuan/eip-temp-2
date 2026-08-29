-- ============================================================
-- 排程失敗告警包裝層
--
-- 起因：eip_run_recurring 曾因 division by zero 連續 3 天失敗，
--       系統沒有任何地方會讓人知道，只能手動翻 cron.job_run_details。
--
-- 設計：白名單式（case，不用動態 SQL），失敗時寫 error_logs +
--       eip_notification_miss，並用 urgent 通知所有在職 company_admin。
--       原函式完全不動。
--
-- 注意：這裡「吞掉」例外而不 re-raise，因為 re-raise 會連同告警的 insert
--       一起 rollback（同一個交易）。代價是 cron.job_run_details 會記成
--       succeeded；真正的失敗紀錄在 error_logs 與通知中心。
-- ============================================================
create or replace function public.eip_cron_guarded(p_job text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
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
      else raise exception '未知的排程工作：%', p_job;
    end case;
    return;
  exception when others then
    get stacked diagnostics
      v_err   = message_text,
      v_state = returned_sqlstate,
      v_ctx   = pg_exception_context;
  end;

  -- 訊息刻意只帶「日期＋工作名＋錯誤」，不帶時間戳：
  -- eip_emit_notification 會用訊息內容在 20 小時內去重，
  -- 所以每 5 分鐘執行的工作連續失敗也只會通知一次。
  v_msg := '【系統異常】排程「' || p_job || '」於 ' || to_char(current_date, 'YYYY-MM-DD')
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
$$;

revoke all on function public.eip_cron_guarded(text) from public, anon, authenticated;
grant execute on function public.eip_cron_guarded(text) to postgres, service_role;
;
