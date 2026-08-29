-- 讓前端「立即產生」可用：授權 authenticated 執行 eip_run_recurring，
-- 並加守衛：cron/postgres(auth.uid() null) 放行；前端僅 company_admin/dept_manager 可呼叫，其餘登入者擋下。
-- 函式主體與 0022 一致，僅在 begin 後加守衛。
create or replace function public.eip_run_recurring(p_date date default current_date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r recurring_rule; d date; horizon int; due date; ndays int; t record; sid uuid;
begin
  -- 守衛：背景排程(auth.uid() 為 null)放行；前端僅允許管理者/部門主管
  if auth.uid() is not null
     and coalesce(current_role_name()::text, '') not in ('company_admin','dept_manager') then
    raise exception '權限不足：僅管理者或部門主管可手動產生常態任務';
  end if;

  for r in select * from recurring_rule where is_active loop
    horizon := coalesce((select max(x) from unnest(r.advance_days) x), 0);
    select id into sid from task_status
      where tenant_id = r.tenant_id and is_default and not is_done_state
      order by sort_order limit 1;

    -- 1) 生成 [今天 ~ 今天+最大提前天數] 內的到期任務
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

    -- 2) 對此規則「未完成」的週期任務發提醒
    for t in
      select tk.* from task tk
      where tk.recurring_rule_id = r.id and tk.occurrence_date is not null
        and tk.status_id not in (select id from task_status where is_done_state)
    loop
      due := t.occurrence_date; ndays := due - p_date;
      if (ndays >= 0 and ndays = any(r.advance_days))
         or (p_date = due)
         or (p_date > due and r.remind_until_done and r.repeat_every_days is not null
             and ((p_date - due) % r.repeat_every_days) = 0)
      then
        if not exists (select 1 from notification
                       where entity_type='task' and entity_id = t.id and created_at::date = p_date) then
          insert into notification (tenant_id, user_id, type, entity_type, entity_id, message)
          values (r.tenant_id, t.owner_id,
                  (case when p_date > due then 'overdue' else 'due_soon' end)::notification_type,
                  'task', t.id,
                  (case when p_date > due then '【逾期】' else '【提醒】' end)
                    || r.title || '(期限 ' || to_char(due,'MM/DD') || ')');
        end if;
      end if;
    end loop;

    update recurring_rule set last_run_on = p_date where id = r.id;
  end loop;
end; $function$;

revoke execute on function public.eip_run_recurring(date) from public, anon;
grant  execute on function public.eip_run_recurring(date) to authenticated;;
