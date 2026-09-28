-- 交接待辦：連續請假（不同假別分成多張假單）結案時，同一段裡「沒有代辦」的假單一起結案
--
-- 問題（2026-09-28 使用者回報）：
--   9/16 其他假（0 項代辦）＋ 9/17~9/27 婚假（13 項代辦）在畫面上併成一張交接卡，
--   新增的代辦都掛在主段（婚假）底下。代辦全部完成後 eip_lhi_rollup 只把婚假推成 done，
--   9/16 那張因為 total = 0 永遠不會被推動 → 卡片拆開，9/16 單獨留在「未結案」、代辦 0/0。
--
-- 修法（不改既有規則，只補「同一段一起結案」）：
--   1. eip_leave_same_span(a_end, b_start)：與前端 sameLeaveSpan 同一套規則
--      （相連/重疊，或中間空隙 ≤3 天且含週末）。
--   2. eip_leave_span_ids(report_id)：找出同一位申請人、同一段連續不在的所有請假單。
--   3. eip_close_empty_leave_siblings(report_id, by)：整段已經沒有未完成代辦時，
--      把同段中「沒有任何代辦」且未結案的假單一起結案。有代辦的假單仍由各自的完成度決定。
--   4. eip_lhi_rollup 與 eip_close_leave_handover 結案後呼叫 3。
--   5. 連帶結案不重發「請假代辦完成」通知（主段那張已經發過一次）。
--   6. 回補現有資料。
--   退回（取消勾選）時不動兄弟假單：前端本來就不把已結案/未結案併卡，畫面不會說謊。

create or replace function public.eip_leave_same_span(a_end date, b_start date)
returns boolean
language sql immutable
set search_path to 'public'
as $$
  select case
    when a_end is null or b_start is null then false
    when b_start <= a_end + 1 then true
    when b_start - a_end - 1 > 3 then false
    else exists (
      select 1 from generate_series(a_end + 1, b_start - 1, interval '1 day') d
       where extract(isodow from d) in (6, 7))
  end;
$$;

create or replace function public.eip_leave_span_ids(p_report_id uuid)
returns uuid[]
language plpgsql stable security definer
set search_path to 'public'
as $$
declare v_sub uuid; v_s date; v_e date; v_ids uuid[]; v_n int := 0; v_ns date; v_ne date;
begin
  select q.submitter_id,
         coalesce((q.leave_from at time zone 'Asia/Taipei')::date, q.report_date),
         coalesce((q.leave_to at time zone 'Asia/Taipei')::date,
                  (q.leave_from at time zone 'Asia/Taipei')::date, q.report_date)
    into v_sub, v_s, v_e
    from public.eip_quick_report q
   where q.id = p_report_id and q.type = 'leave' and q.deleted_at is null;
  if v_sub is null then return array[]::uuid[]; end if;

  loop
    select array_agg(x.id), min(x.s), max(x.e)
      into v_ids, v_ns, v_ne
      from (
        select q.id,
               coalesce((q.leave_from at time zone 'Asia/Taipei')::date, q.report_date) s,
               coalesce((q.leave_to at time zone 'Asia/Taipei')::date,
                        (q.leave_from at time zone 'Asia/Taipei')::date, q.report_date) e
          from public.eip_quick_report q
         where q.submitter_id = v_sub and q.type = 'leave' and q.deleted_at is null
      ) x
     where public.eip_leave_same_span(v_e, x.s)   -- 不晚於這一段結束後的相連範圍
       and public.eip_leave_same_span(x.e, v_s);  -- 不早於這一段開始前的相連範圍
    exit when coalesce(array_length(v_ids, 1), 0) = v_n;
    v_n := coalesce(array_length(v_ids, 1), 0);
    v_s := least(v_s, v_ns);
    v_e := greatest(v_e, v_ne);
  end loop;
  return coalesce(v_ids, array[p_report_id]);
end;
$$;

create or replace function public.eip_close_empty_leave_siblings(p_report_id uuid, p_by uuid)
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare v_ids uuid[]; v_n int := 0;
begin
  v_ids := public.eip_leave_span_ids(p_report_id);
  if coalesce(array_length(v_ids, 1), 0) <= 1 then return 0; end if;

  -- 整段還有沒做完的代辦 → 不動
  if exists (select 1 from public.eip_leave_handover_item i
              where i.quick_report_id = any(v_ids) and i.done_at is null) then
    return 0;
  end if;
  -- 整段都沒有代辦 → 不是這支的事（空單照舊由人手動結案）
  if not exists (select 1 from public.eip_leave_handover_item i
                  where i.quick_report_id = any(v_ids)) then
    return 0;
  end if;

  perform set_config('eip.leave_sibling_close', 'on', true);
  update public.eip_quick_report q
     set status = 'done', done_at = now(), done_by = p_by
   where q.id = any(v_ids)
     and q.id <> p_report_id
     and q.status <> 'done'
     and q.deleted_at is null
     and not exists (select 1 from public.eip_leave_handover_item i where i.quick_report_id = q.id);
  get diagnostics v_n = row_count;
  perform set_config('eip.leave_sibling_close', 'off', true);
  return v_n;
end;
$$;

revoke all on function public.eip_close_empty_leave_siblings(uuid, uuid) from public, anon, authenticated;
revoke all on function public.eip_leave_span_ids(uuid) from public, anon;

create or replace function public.eip_lhi_rollup()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $function$
declare v_rid uuid; v_total int; v_done int; v_status text; v_by uuid;
begin
  v_rid := coalesce(new.quick_report_id, old.quick_report_id);
  select count(*), count(*) filter (where done_at is not null)
    into v_total, v_done
    from public.eip_leave_handover_item where quick_report_id = v_rid;

  select status into v_status from public.eip_quick_report where id = v_rid;

  if v_total > 0 and v_done = v_total and v_status <> 'done' then
    v_by := coalesce(new.done_by, auth.uid());
    update public.eip_quick_report
       set status = 'done', done_at = now(), done_by = v_by
     where id = v_rid;
    -- 同一段連續請假裡沒有代辦的假單一起結案（見檔頭）
    perform public.eip_close_empty_leave_siblings(v_rid, v_by);
  elsif v_done < v_total and v_status = 'done' then
    -- 退回 'open'，不要用 'acknowledged'：那是舊制「主管已確認」的值，
    -- 前端把它當「已完成」顯示，退回到那裡會讓畫面說謊。
    update public.eip_quick_report
       set status = 'open', done_at = null, done_by = null
     where id = v_rid;
  end if;
  return null;
end $function$;

create or replace function public.eip_close_leave_handover(p_report_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $function$
declare v_me uuid := auth.uid(); r public.eip_quick_report; v_total int; v_open int;
begin
  if v_me is null then raise exception '需要登入身分'; end if;

  select * into r from public.eip_quick_report
   where id = p_report_id and deleted_at is null;
  if r.id is null then raise exception '找不到這筆回報'; end if;
  if r.type <> 'leave' then raise exception '這支只處理請假代辦'; end if;
  if not public.eip_can_see_leave(p_report_id) then
    raise exception '權限不足：只有當事人、代理人、單位主管或管理者可以結案';
  end if;
  if r.status = 'done' then
    return jsonb_build_object('ok', true, 'already_done', true);
  end if;

  select count(*), count(*) filter (where done_at is null)
    into v_total, v_open
    from public.eip_leave_handover_item where quick_report_id = p_report_id;

  if v_open > 0 then
    raise exception '還有 % 項代辦未完成，不能結案', v_open;
  end if;

  update public.eip_quick_report
     set status = 'done', done_at = now(), done_by = v_me
   where id = p_report_id;

  perform public.eip_close_empty_leave_siblings(p_report_id, v_me);

  return jsonb_build_object('ok', true, 'items', v_total, 'no_handover', v_total = 0);
end;
$function$;

create or replace function public.eip_notify_leave_handover_done()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $function$
declare sname text; dname text;
begin
  if new.type <> 'leave' then return new; end if;
  if new.status <> 'done' or old.status = 'done' then return new; end if;
  -- 連帶結案的兄弟假單不再發一次（主段那張已經通知過）
  if coalesce(current_setting('eip.leave_sibling_close', true), '') = 'on' then return new; end if;

  select name into sname from public.app_user where id = new.submitter_id;
  select name into dname from public.app_user where id = new.done_by;

  perform public.eip_emit_notification(
    'leave_handover_completed', new.department_id, new.submitter_id, new.done_by,
    'leave_handover'::notification_entity, new.id, 'handover_completed'::notification_type,
    format('【請假代辦完成】%s %s 的請假代辦已由 %s 處理完成',
           coalesce(sname,'同仁'), to_char(new.report_date, 'MM/DD'),
           coalesce(dname,'代理人')));
  return new;
end;
$function$;

-- 回補：已結案且有代辦的假單，把同段的空單補結案（done_by 沿用主段的完成者）
do $$
declare r record;
begin
  for r in
    select q.id, q.done_by from public.eip_quick_report q
     where q.type = 'leave' and q.deleted_at is null and q.status = 'done'
       and exists (select 1 from public.eip_leave_handover_item i where i.quick_report_id = q.id)
  loop
    perform public.eip_close_empty_leave_siblings(r.id, r.done_by);
  end loop;
end $$;
