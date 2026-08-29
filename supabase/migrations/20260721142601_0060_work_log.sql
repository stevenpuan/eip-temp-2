-- 工作日誌：每人每日一筆，例行(上午/下午)+特殊工作，單位主管批示
-- 主管判斷：管理該部門或其上層部門者（department.manager_id）或系統管理員
create or replace function public.eip_is_dept_supervisor(p_dept uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select current_role_name() = 'company_admin'
      or (p_dept is not null and exists (
            select 1 from public.department d
            where d.manager_id = (select auth.uid())
              and public.eip_dept_in_subtree(p_dept, d.id)));
$function$;
grant execute on function public.eip_is_dept_supervisor(uuid) to authenticated, service_role;

create table if not exists public.work_log (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default '00000000-0000-0000-0000-000000000001',
  user_id        uuid not null default auth.uid() references public.app_user(id) on delete cascade,
  department_id  uuid references public.department(id) on delete set null,
  log_date       date not null default current_date,
  routine_morning   jsonb not null default '[]',
  routine_afternoon jsonb not null default '[]',
  special_items     jsonb not null default '[]',
  status         text not null default 'draft',   -- draft / submitted / reviewed
  submitted_at   timestamptz,
  manager_comment text,
  reviewed_by    uuid references public.app_user(id),
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, user_id, log_date)
);
comment on table public.work_log is '行政人員工作日誌：例行(上午/下午)+特殊工作，單位主管批示';

create index if not exists ix_work_log_user on public.work_log (user_id, log_date desc);
create index if not exists ix_work_log_dept on public.work_log (department_id, log_date desc);

alter table public.work_log enable row level security;

drop policy if exists work_log_read on public.work_log;
create policy work_log_read on public.work_log for select to authenticated
  using (tenant_id = current_tenant_id()
         and (user_id = (select auth.uid()) or public.eip_is_dept_supervisor(department_id)));

drop policy if exists work_log_insert on public.work_log;
create policy work_log_insert on public.work_log for insert to authenticated
  with check (tenant_id = current_tenant_id() and user_id = (select auth.uid()));

drop policy if exists work_log_update on public.work_log;
create policy work_log_update on public.work_log for update to authenticated
  using (tenant_id = current_tenant_id()
         and (user_id = (select auth.uid()) or public.eip_is_dept_supervisor(department_id)))
  with check (tenant_id = current_tenant_id()
         and (user_id = (select auth.uid()) or public.eip_is_dept_supervisor(department_id)));

drop policy if exists work_log_delete on public.work_log;
create policy work_log_delete on public.work_log for delete to authenticated
  using (user_id = (select auth.uid()) or current_role_name() = 'company_admin');

grant select, insert, update, delete on public.work_log to authenticated;
grant all on public.work_log to service_role;

-- 選單：工作日誌（所有員工可見，放在 EIP 平台群組）
insert into public.menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select 'eip_work_log', (select id from public.menus where menu_key='eip_group'),
       '工作日誌', 'BookText', '/dashboard/eip/work-log', null, 8, true
where not exists (select 1 from public.menus where menu_key='eip_work_log');;
