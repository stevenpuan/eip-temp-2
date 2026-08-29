-- ============================================================
-- 0144 純訊息通知（沒有指向任何實體）
--
-- 驗證催填功能時抓到的：notification.entity_id 是 NOT NULL，
-- 但「提醒你補填 X 月 X 日的日誌」這件事沒有實體可指（那天可能連日誌列都還沒有）。
-- 而 eip_notification_entity_alive() 早就寫了 `if p_entity_id is null then return true`
-- ——「純訊息」這個情境本來就在設計裡，只是欄位的 NOT NULL 沒放開。
--
-- 更要記一筆的是它為什麼沒被發現：eip_nudge_worklog 為了「一個人失敗不要中斷整批」
-- 把 emit 包在 exception 裡只 raise warning，結果 23502 被吞掉、函式回 0，
-- 從外面看就是「催填沒反應」。這種 per-item 隔離必須配一個「全部都失敗就要叫出來」
-- 的出口，否則就是把硬錯誤變成靜默失敗。下面一併改掉。
-- ============================================================
alter table public.notification alter column entity_id drop not null;
comment on column public.notification.entity_id is
  '指向的實體 id。可為 null＝純訊息通知（例如催填日誌），此時 eip_notification_entity_alive 一律視為有效，前端不要嘗試導頁。';

create or replace function public.eip_nudge_worklog(p_user_ids uuid[], p_date date default null)
 returns integer
 language plpgsql security definer set search_path to 'public'
as $function$
declare v_me uuid := auth.uid(); u record; v_n int := 0; v_tried int := 0; v_fail int := 0;
        v_name text; v_last text;
begin
  if v_me is null then raise exception '需要登入身分'; end if;
  if not public.eip_is_any_dept_supervisor() then
    raise exception '權限不足：只有管理者或部門主管可以催填';
  end if;
  p_date := coalesce(p_date, (now() at time zone 'Asia/Taipei')::date);
  if p_date > (now() at time zone 'Asia/Taipei')::date then
    raise exception '不能催未來日期';
  end if;
  if coalesce(array_length(p_user_ids,1),0) = 0 then return 0; end if;
  if array_length(p_user_ids,1) > 100 then raise exception '一次最多催 100 人'; end if;

  select name into v_name from public.app_user where id = v_me;

  for u in
    select a.id, a.department_id from public.app_user a
     where a.id = any(p_user_ids) and a.status = 'active'
       and (coalesce(current_role_name()::text,'') = 'company_admin'
            or (a.department_id is not null and public.eip_user_can_scope_dept(a.department_id)))
       and a.id <> v_me
  loop
    v_tried := v_tried + 1;
    begin
      if public.eip_emit_notification(
           'worklog_nudge', u.department_id, u.id, v_me,
           'work_log'::notification_entity, null, 'review_needed'::notification_type,
           format('【工作日誌未提交】%s 提醒您補填 %s 的工作日誌',
                  coalesce(v_name,'主管'), to_char(p_date, 'MM/DD')),
           'high') > 0 then
        v_n := v_n + 1;
      end if;
    exception when others then
      -- 單一收件人失敗不中斷整批，但要記下來
      v_fail := v_fail + 1;
      v_last := sqlerrm;
      raise warning '催填通知失敗 %: %', u.id, sqlerrm;
    end;
  end loop;

  -- 全部都失敗 → 這不是「沒人可催」，是系統壞了，必須讓呼叫端知道
  if v_tried > 0 and v_fail = v_tried then
    raise exception '催填通知全部失敗（%／% 人）：%', v_fail, v_tried, coalesce(v_last,'未知原因');
  end if;
  return v_n;
end;
$function$;
revoke all on function public.eip_nudge_worklog(uuid[], date) from public, anon;
grant execute on function public.eip_nudge_worklog(uuid[], date) to authenticated, service_role;;
