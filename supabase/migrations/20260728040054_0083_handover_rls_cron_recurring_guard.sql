-- 0083: 交接佇列 RLS、每日掃描排程、常態工作規則防呆

alter table public.eip_handover_item enable row level security;

drop policy if exists ho_read on public.eip_handover_item;
create policy ho_read on public.eip_handover_item for select to authenticated
using (
  assignee_id = (select auth.uid())
  or leaver_id = (select auth.uid())
  or public.eip_is_dept_supervisor(department_id)
  or current_role_name() = 'company_admin'
);

drop policy if exists ho_update on public.eip_handover_item;
create policy ho_update on public.eip_handover_item for update to authenticated
using (
  assignee_id = (select auth.uid())
  or public.eip_is_dept_supervisor(department_id)
  or current_role_name() = 'company_admin'
)
with check (
  assignee_id = (select auth.uid())
  or public.eip_is_dept_supervisor(department_id)
  or current_role_name() = 'company_admin'
);

-- 不開放一般使用者 INSERT / DELETE：只能由 SECURITY DEFINER 函式建立，避免手動製造孤兒紀錄
revoke insert, delete on public.eip_handover_item from authenticated, anon;
grant select, update on public.eip_handover_item to authenticated;

-- ── 常態工作規則防呆：即使規則沒被停用，也不再為已停用的負責人產生任務
create or replace function public.eip_run_recurring(p_date date DEFAULT CURRENT_DATE)
returns void language plpgsql security definer set search_path to 'public' as $$
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
         or (p_date > due and r.remind_until_done and r.repeat_every_days is not null
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
$$;

-- ── 每日 08:20（台北）掃描交接佇列
do $$
begin
  perform cron.unschedule('eip-handover-sweep');
exception when others then null;
end $$;
select cron.schedule('eip-handover-sweep', '20 0 * * *', $$select public.eip_sweep_handover();$$);
;
