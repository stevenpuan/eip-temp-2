
-- (1) 撤銷 eip_phone_order_month_locked 的 anon/public 執行權（比照其他 SECURITY DEFINER 函式）
revoke all on function public.eip_phone_order_month_locked(date) from public, anon;
grant execute on function public.eip_phone_order_month_locked(date) to authenticated, service_role;

-- (2) phone_order_lock：原 pol_write 用 FOR ALL 會與 pol_select 在 SELECT 上重疊。
--     改為只針對 INSERT/UPDATE/DELETE 的三條政策，SELECT 只留 pol_select（同租戶可讀）。
drop policy if exists pol_write on public.phone_order_lock;
create policy pol_lock_insert on public.phone_order_lock for insert
  with check (tenant_id = current_tenant_id() and public.eip_is_phone_order_hr());
create policy pol_lock_update on public.phone_order_lock for update
  using (tenant_id = current_tenant_id() and public.eip_is_phone_order_hr())
  with check (tenant_id = current_tenant_id() and public.eip_is_phone_order_hr());
create policy pol_lock_delete on public.phone_order_lock for delete
  using (tenant_id = current_tenant_id() and public.eip_is_phone_order_hr());
;
