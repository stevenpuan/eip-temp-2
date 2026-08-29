-- =====================================================================
-- 0021 週期任務引擎(第一階段)— 常態工作規則 + 任務週期關聯
-- =====================================================================
create table recurring_rule (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant(id) on delete cascade,
  title             text not null,
  description       text,
  owner_id          uuid not null references app_user(id),
  department_id     uuid references department(id) on delete set null,
  counterpart       text,                                   -- 對接人員(自由文字)
  priority          task_priority not null default 'normal',
  freq              text not null default 'monthly',        -- daily/weekly/monthly/yearly/manual
  months            int[],                                  -- 適用月份(null=每月);單月={1,3,5,7,9,11}
  weekday           int,                                    -- weekly:1=一..7=日
  days_of_month     int[],                                  -- monthly/yearly:哪幾日,如 {10,20,30}
  use_month_end     boolean not null default false,         -- 月底(當月最後一天)
  advance_days      int[] not null default '{1}',           -- 提前幾天提醒(可多段)
  repeat_every_days int,                                    -- 到期後每 N 天再提醒
  remind_until_done boolean not null default true,          -- 直到回報完成才停
  report_fields     jsonb,                                  -- [{label,type:text|checkbox|number|date}]
  is_active         boolean not null default true,
  last_run_on       date,                                   -- 排程器最後處理到的日期
  created_by        uuid references app_user(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index idx_recurring_tenant on recurring_rule(tenant_id);
create trigger trg_recurring_updated before update on recurring_rule
  for each row execute function set_updated_at();
alter table recurring_rule enable row level security;
create policy recurring_read on recurring_rule
  for select using (tenant_id = current_tenant_id());
create policy recurring_write on recurring_rule
  for all using (tenant_id = current_tenant_id() and current_role_name() in ('company_admin','dept_manager'))
  with check (tenant_id = current_tenant_id() and current_role_name() in ('company_admin','dept_manager'));

-- 任務關聯週期規則 + 結構化回報
alter table task add column recurring_rule_id uuid references recurring_rule(id) on delete set null;
alter table task add column occurrence_date date;          -- 此任務對應的週期日
alter table task add column report_data jsonb;             -- 結構化回報內容
create index idx_task_rule on task(recurring_rule_id, occurrence_date);;
