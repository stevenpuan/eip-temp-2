-- 0108 修 H-F（urgent 獨立重試）、M-10（彙整混批）、L-2（排程錯開）

/* ---------- H-F：urgent 失敗不該掉進「每 30 分鐘、只在上班時段」的彙整池 ---------- */
-- 原本 urgent 推播失敗後唯一會撿它的是彙整，
-- 若失敗發生在台北 19:30 之後，要等到隔天早上 08:00 才重試（延遲 12 小時以上）。
-- 前綴問題已在 0107 解掉（寫進 message 本身），這裡處理即時性。
create or replace function public.eip_retry_urgent_line()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare rec record; v_req bigint; v_n int := 0;
begin
  for rec in
    select n.id, n.user_id, n.message
      from public.notification n
      join public.app_user u on u.id = n.user_id
     where n.line_pending
       and n.line_request_id is null
       and n.priority in ('high','urgent')
       and n.line_attempts < 3
       and u.line_user_id is not null and u.status = 'active'
       -- 額度用盡的先擱著，等重置後由這支或彙整重送
       and coalesce(n.line_error,'') not like '%額度已用盡%'
     limit 50
  loop
    begin
      v_req := public.eip_line_push_now(rec.user_id, rec.message);
      if v_req is not null then
        update public.notification
           set line_request_id = v_req, line_attempts = line_attempts + 1
         where id = rec.id;
        v_n := v_n + 1;
      end if;
    exception when others then
      update public.notification
         set line_error = left('重試失敗：' || sqlerrm, 200),
             line_attempts = line_attempts + 1
       where id = rec.id;
    end;
  end loop;
  return v_n;
end;
$function$;

revoke all on function public.eip_retry_urgent_line() from public, anon, authenticated;

/* ---------- M-10：彙整按 line_attempts 分批，避免新舊混批 ---------- */
-- 原本 group by user_id，會把新通知（attempts=0）與已失敗兩次的舊通知（attempts=2）
-- 綁成同一則訊息、同一個命運。新通知的 3 次額度會在 1.5 小時內被燒完。
create or replace function public.eip_send_line_digests()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_url text; v_key text; rec record; v_msg text; v_n int := 0; v_req bigint;
begin
  update public.notification n set line_pending = false
    from public.app_user u
   where u.id = n.user_id and n.line_pending
     and (u.line_user_id is null or u.status <> 'active');

  select value into v_url from public.app_config where key = 'line_push_url';
  select value into v_key from public.app_config where key = 'line_push_secret';
  if v_url is null or v_key is null then return 0; end if;

  for rec in
    select n.user_id, n.line_attempts, count(*) as cnt, array_agg(n.id) as ids,
           string_agg('• ' || n.message, E'\n' order by n.created_at) as body
    from public.notification n
    join public.app_user u on u.id = n.user_id
    where n.line_pending
      and n.line_request_id is null
      and n.line_attempts < 3
      and coalesce(n.line_error,'') not like '%額度已用盡%'
      and u.line_user_id is not null and u.status = 'active'
    group by n.user_id, n.line_attempts        -- M-10：新舊分批
  loop
    begin
      v_msg := left('【陞煇 EIP】通知 ' || rec.cnt || ' 則' || E'\n' || rec.body, 4800);
      select net.http_post(
        url     := v_url,
        headers := jsonb_build_object('Content-Type','application/json','x-push-key', v_key),
        body    := jsonb_build_object('user_id', rec.user_id, 'message', v_msg),
        timeout_milliseconds := 15000            -- M-9：5 秒太短，DNS 就可能吃掉
      ) into v_req;

      update public.notification
         set line_request_id = v_req, line_attempts = line_attempts + 1
       where id = any(rec.ids);
      v_n := v_n + 1;
    exception when others then
      update public.notification
         set line_error = left('彙整推播失敗：' || sqlerrm, 200),
             line_attempts = line_attempts + 1
       where id = any(rec.ids);
    end;
  end loop;
  return v_n;
end;
$function$;

/* ---------- L-2：把確認排程錯開，避免與彙整同分鐘搶列鎖 ---------- */
select cron.alter_job(
  job_id   => (select jobid from cron.job where jobname = 'line_confirm_delivery'),
  schedule => '2-59/5 * * * *');

/* ---------- urgent 重試排程 ---------- */
select cron.schedule('line_retry_urgent', '4-59/5 * * * *',
                     $$ select public.eip_retry_urgent_line(); $$);
;
