-- 0090 修 eip_run_recurring 的 division by zero
-- 症狀：cron job eip-recurring-daily 自 2026-07-25 起每天失敗，常態工作停止產生任務。
-- 根因：逾期重複提醒的判斷 ((p_date - due) % r.repeat_every_days) 只檢查了 is not null，
--       但有規則把 repeat_every_days 設成 0（甚至 -1），% 0 直接 division by zero，
--       整個迴圈中斷，後面所有規則都不會被處理。

-- ① 資料修正：0 與負數視為「未設定」
update public.recurring_rule
   set repeat_every_days = null
 where repeat_every_days is not null and repeat_every_days < 1;

-- ② 加約束，避免再被寫進不合理的值
alter table public.recurring_rule
  drop constraint if exists recurring_rule_repeat_every_days_check;
alter table public.recurring_rule
  add constraint recurring_rule_repeat_every_days_check
  check (repeat_every_days is null or repeat_every_days >= 1);

-- ③ 函式加防護：除數必須 > 0
create or replace function public.eip_run_recurring(p_date date default current_date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r recurring_rule; d date; horizon int; due date; ndays int; t record; sid uuid;
begin
  if auth.uid() is not null
     and coalesce(current_role_name()::text, '') not in ('company_admin','dept_manager') then
    raise exception '權限不足：僅管理者或部門主管可手動產生常態任務';
  end if;

  for r in
    select rr.* from recurring_rule rr
    join app_user au on au.id = rr.owner_id
    where rr.is_active and au.status = 'active'      -- 防呆：負責人已停用者不再產生任務
  loop
    horizon := coalesce((select max(x) from unnest(r.advance_days) x), 0);
    select id into sid from task_status
      where tenant_id = r.tenant_id and is_default and not is_done_state
      order by sort_order limit 1;

    d := p_date;
    while d <= p_date + horizon loop
      if eip_rule_due_on(r, d) then
        if not exists (select 1 from task where recurring_rule_id = r.id and occurrence_date = d) then
          insert into task (tenant_id, title, description, owner_id, department_id, priority,
                            status_id, progress, due_date, created_by, recurring_rule_id, occurrence_date)
          values (r.tenant_id, r.title, r.description, r.owner_id, r.department_id, r.priority,
                  sid, 0, d, r.owner_id, r.id, d);
        end if;
      end if;
      d := d + 1;
    end loop;

    for t in
      select tk.* from task tk
      where tk.recurring_rule_id = r.id and tk.occurrence_date is not null
        and tk.status_id not in (select id from task_status where is_done_state)
    loop
      due := t.occurrence_date; ndays := due - p_date;
      if (ndays >= 0 and ndays = any(r.advance_days))
         or (p_date = due)
         or (p_date > due and r.remind_until_done
             and coalesce(r.repeat_every_days, 0) > 0          -- ← 修正：除數必須 > 0
             and ((p_date - due) % r.repeat_every_days) = 0)
      then
        perform public.eip_emit_notification(
          case when p_date > due then 'recurring_overdue' else 'recurring_due_soon' end,
          t.department_id, t.owner_id, null,
          'task'::notification_entity, t.id,
          (case when p_date > due then 'overdue' else 'due_soon' end)::notification_type,
          (case when p_date > due then '【逾期】' else '【提醒】' end)
            || r.title || '(期限 ' || to_char(due,'MM/DD') || ')');
      end if;
    end loop;

    update recurring_rule set last_run_on = p_date where id = r.id;
  end loop;
end;
$function$;

revoke all on function public.eip_run_recurring(date) from public, anon;
grant execute on function public.eip_run_recurring(date) to authenticated, service_role;
;
