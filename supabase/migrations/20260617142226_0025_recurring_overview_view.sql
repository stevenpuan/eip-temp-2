-- 常態工作儀表板用的整合視圖(security_invoker:沿用 task 的 RLS)
create or replace view eip_recurring_overview
with (security_invoker = true) as
select
  t.id              as task_id,
  t.recurring_rule_id,
  rr.title          as rule_title,
  t.owner_id,
  au.name           as owner_name,
  t.department_id,
  dp.name           as department_name,
  t.occurrence_date,
  t.due_date,
  ts.is_done_state  as is_done,
  (t.due_date < current_date and not ts.is_done_state) as is_overdue,
  (t.report_data is not null)                          as is_reported,
  ts.name           as status_name
from task t
join recurring_rule rr on rr.id = t.recurring_rule_id
left join app_user au   on au.id = t.owner_id
left join department dp on dp.id = t.department_id
join task_status ts     on ts.id = t.status_id;;
