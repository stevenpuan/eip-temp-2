-- 交接待辦：沒有任何代辦的請假單，請假結束隔天清晨自動結案（2026-09-28 客戶需求，使用者拍板）
--
-- 規則：
--   ・只處理「0 項代辦」且未結案的請假單；有代辦（不論做完與否）一律不動，照原本完成度決定。
--   ・以「同一段連續請假」為單位（eip_leave_span_ids，與前端併卡同一套規則）：
--     整段的最後一天已經過去，而且整段沒有未完成代辦，才結案。
--     → 9/16 空單 ＋ 9/17~9/27 婚假（代辦還沒做完）時，9/16 不會先被關掉、把卡片拆開。
--   ・done_by 留空＝系統自動結案；不發「請假代辦完成」通知（沒有代辦可言）。
--   ・排程：台北每天 05:30（UTC 21:30），走 eip_cron_guarded，失敗會通知管理者。

create or replace function public.eip_auto_close_empty_leaves()
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  r record; v_ids uuid[]; v_end date; v_n int := 0; v_k int;
begin
  perform set_config('eip.leave_sibling_close', 'on', true);

  for r in
    select q.id
      from public.eip_quick_report q
     where q.type = 'leave' and q.deleted_at is null and q.status <> 'done'
       and coalesce((q.leave_to at time zone 'Asia/Taipei')::date,
                    (q.leave_from at time zone 'Asia/Taipei')::date, q.report_date) < v_today
       and not exists (select 1 from public.eip_leave_handover_item i where i.quick_report_id = q.id)
  loop
    v_ids := public.eip_leave_span_ids(r.id);
    if coalesce(array_length(v_ids, 1), 0) = 0 then continue; end if;

    select max(coalesce((q.leave_to at time zone 'Asia/Taipei')::date,
                        (q.leave_from at time zone 'Asia/Taipei')::date, q.report_date))
      into v_end
      from public.eip_quick_report q where q.id = any(v_ids);
    if v_end is null or v_end >= v_today then continue; end if;   -- 整段還沒請完

    if exists (select 1 from public.eip_leave_handover_item i
                where i.quick_report_id = any(v_ids) and i.done_at is null) then
      continue;                                                   -- 整段還有交接沒做完
    end if;

    update public.eip_quick_report
       set status = 'done', done_at = now(), done_by = null
     where id = r.id and status <> 'done';
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end loop;

  perform set_config('eip.leave_sibling_close', 'off', true);
  return v_n;
end;
$$;

revoke all on function public.eip_auto_close_empty_leaves() from public, anon, authenticated;

-- 排程守衛加一個工作名（其餘內容與現行版本相同）
create or replace function public.eip_cron_guarded(p_job text)
returns void
language plpgsql security definer
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
      when 'eip_auto_close_empty_leaves' then perform public.eip_auto_close_empty_leaves();
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
$function$;

-- 台北 05:30 ＝ UTC 21:30
select cron.unschedule(jobid) from cron.job where jobname = 'eip-leave-auto-close-empty';
select cron.schedule('eip-leave-auto-close-empty', '30 21 * * *',
                     $$select public.eip_cron_guarded('eip_auto_close_empty_leaves')$$);
