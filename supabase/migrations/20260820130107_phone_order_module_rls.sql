
-- ============ RLS ============
alter table public.phone_order_daily enable row level security;
alter table public.phone_order_month enable row level security;
alter table public.phone_order_lock  enable row level security;

grant select, insert, update, delete on public.phone_order_daily to authenticated;
grant select, insert, update, delete on public.phone_order_month to authenticated;
grant select, insert, update, delete on public.phone_order_lock  to authenticated;

-- ---- phone_order_daily ----
-- 檢視：本人 / 主管管轄該人部門 / 人資(company_admin)
drop policy if exists pod_select on public.phone_order_daily;
create policy pod_select on public.phone_order_daily for select using (
  tenant_id = current_tenant_id() and (
    user_id = (select auth.uid())
    or current_role_name() = 'company_admin'::user_role
    or eip_user_can_scope_dept((select department_id from public.app_user where id = phone_order_daily.user_id))
  )
);
-- 新增：本人且為接單人員、當月未鎖；或人資
drop policy if exists pod_insert on public.phone_order_daily;
create policy pod_insert on public.phone_order_daily for insert with check (
  tenant_id = current_tenant_id() and (
    ( user_id = (select auth.uid())
      and coalesce((select is_phone_order_staff from public.app_user where id = (select auth.uid())), false)
      and not public.eip_phone_order_month_locked(log_date) )
    or current_role_name() = 'company_admin'::user_role
  )
);
-- 修改：本人且未鎖；或人資
drop policy if exists pod_update on public.phone_order_daily;
create policy pod_update on public.phone_order_daily for update using (
  tenant_id = current_tenant_id() and (
    ( user_id = (select auth.uid()) and not public.eip_phone_order_month_locked(log_date) )
    or current_role_name() = 'company_admin'::user_role
  )
) with check (
  tenant_id = current_tenant_id() and (
    ( user_id = (select auth.uid()) and not public.eip_phone_order_month_locked(log_date) )
    or current_role_name() = 'company_admin'::user_role
  )
);
-- 刪除：本人且未鎖；或人資
drop policy if exists pod_delete on public.phone_order_daily;
create policy pod_delete on public.phone_order_daily for delete using (
  tenant_id = current_tenant_id() and (
    ( user_id = (select auth.uid()) and not public.eip_phone_order_month_locked(log_date) )
    or current_role_name() = 'company_admin'::user_role
  )
);

-- ---- phone_order_month（上班天數）----
drop policy if exists pom_select on public.phone_order_month;
create policy pom_select on public.phone_order_month for select using (
  tenant_id = current_tenant_id() and (
    user_id = (select auth.uid())
    or current_role_name() = 'company_admin'::user_role
    or eip_user_can_scope_dept((select department_id from public.app_user where id = phone_order_month.user_id))
  )
);
drop policy if exists pom_upsert on public.phone_order_month;
create policy pom_upsert on public.phone_order_month for insert with check (
  tenant_id = current_tenant_id() and (
    ( user_id = (select auth.uid())
      and coalesce((select is_phone_order_staff from public.app_user where id = (select auth.uid())), false)
      and not public.eip_phone_order_month_locked(ym) )
    or current_role_name() = 'company_admin'::user_role
  )
);
drop policy if exists pom_update on public.phone_order_month;
create policy pom_update on public.phone_order_month for update using (
  tenant_id = current_tenant_id() and (
    ( user_id = (select auth.uid()) and not public.eip_phone_order_month_locked(ym) )
    or current_role_name() = 'company_admin'::user_role
  )
) with check (
  tenant_id = current_tenant_id() and (
    ( user_id = (select auth.uid()) and not public.eip_phone_order_month_locked(ym) )
    or current_role_name() = 'company_admin'::user_role
  )
);

-- ---- phone_order_lock（人資一鍵上鎖/解鎖）----
-- 檢視：同租戶皆可看鎖定狀態
drop policy if exists pol_select on public.phone_order_lock;
create policy pol_select on public.phone_order_lock for select using (
  tenant_id = current_tenant_id()
);
-- 寫入（上鎖/解鎖）：僅人資/管理者
drop policy if exists pol_write on public.phone_order_lock;
create policy pol_write on public.phone_order_lock for all using (
  tenant_id = current_tenant_id() and current_role_name() = 'company_admin'::user_role
) with check (
  tenant_id = current_tenant_id() and current_role_name() = 'company_admin'::user_role
);
;
