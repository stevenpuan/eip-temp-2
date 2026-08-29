
-- 人資 = 人事課部門成員 或 系統管理層(company_admin)
create or replace function public.eip_is_phone_order_hr()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select auth.uid() is not null and (
    current_role_name() = 'company_admin'::user_role
    or exists (
      select 1 from public.app_user a
        join public.department d on d.id = a.department_id
       where a.id = auth.uid() and d.tenant_id = current_tenant_id() and d.name = '人事課'
    )
  );
$$;
revoke all on function public.eip_is_phone_order_hr() from public, anon;
grant execute on function public.eip_is_phone_order_hr() to authenticated, service_role;

-- ===== 重建 daily 政策：開放任何在職者填自己（免名單/旗標）；人資可越權；鎖定後禁改 =====
drop policy if exists pod_select on public.phone_order_daily;
create policy pod_select on public.phone_order_daily for select using (
  tenant_id = current_tenant_id() and (
    user_id = (select auth.uid())
    or public.eip_is_phone_order_hr()
    or eip_user_can_scope_dept((select department_id from public.app_user where id = phone_order_daily.user_id))
  )
);
drop policy if exists pod_insert on public.phone_order_daily;
create policy pod_insert on public.phone_order_daily for insert with check (
  tenant_id = current_tenant_id() and (
    ( user_id = (select auth.uid()) and not public.eip_phone_order_month_locked(log_date) )
    or public.eip_is_phone_order_hr()
  )
);
drop policy if exists pod_update on public.phone_order_daily;
create policy pod_update on public.phone_order_daily for update using (
  tenant_id = current_tenant_id() and (
    ( user_id = (select auth.uid()) and not public.eip_phone_order_month_locked(log_date) )
    or public.eip_is_phone_order_hr()
  )
) with check (
  tenant_id = current_tenant_id() and (
    ( user_id = (select auth.uid()) and not public.eip_phone_order_month_locked(log_date) )
    or public.eip_is_phone_order_hr()
  )
);
drop policy if exists pod_delete on public.phone_order_daily;
create policy pod_delete on public.phone_order_daily for delete using (
  tenant_id = current_tenant_id() and (
    ( user_id = (select auth.uid()) and not public.eip_phone_order_month_locked(log_date) )
    or public.eip_is_phone_order_hr()
  )
);

-- ===== 重建 month 政策 =====
drop policy if exists pom_select on public.phone_order_month;
create policy pom_select on public.phone_order_month for select using (
  tenant_id = current_tenant_id() and (
    user_id = (select auth.uid())
    or public.eip_is_phone_order_hr()
    or eip_user_can_scope_dept((select department_id from public.app_user where id = phone_order_month.user_id))
  )
);
drop policy if exists pom_upsert on public.phone_order_month;
create policy pom_upsert on public.phone_order_month for insert with check (
  tenant_id = current_tenant_id() and (
    ( user_id = (select auth.uid()) and not public.eip_phone_order_month_locked(ym) )
    or public.eip_is_phone_order_hr()
  )
);
drop policy if exists pom_update on public.phone_order_month;
create policy pom_update on public.phone_order_month for update using (
  tenant_id = current_tenant_id() and (
    ( user_id = (select auth.uid()) and not public.eip_phone_order_month_locked(ym) )
    or public.eip_is_phone_order_hr()
  )
) with check (
  tenant_id = current_tenant_id() and (
    ( user_id = (select auth.uid()) and not public.eip_phone_order_month_locked(ym) )
    or public.eip_is_phone_order_hr()
  )
);

-- ===== 月鎖定：人資(人事課/管理層)才可上鎖/解鎖 =====
drop policy if exists pol_write on public.phone_order_lock;
create policy pol_write on public.phone_order_lock for all using (
  tenant_id = current_tenant_id() and public.eip_is_phone_order_hr()
) with check (
  tenant_id = current_tenant_id() and public.eip_is_phone_order_hr()
);

-- 不再需要名單旗標
alter table public.app_user drop column if exists is_phone_order_staff;
;
