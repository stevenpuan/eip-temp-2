-- 收緊 announcement_target 寫入：WITH CHECK 對齊 USING（admin 或 發布者本人＋管轄子樹），
-- 取代 0041 留下的 WITH CHECK (true)。INSERT/UPDATE 的 NEW row 也需通過同一條件。
drop policy if exists ann_target_write on public.announcement_target;
create policy ann_target_write on public.announcement_target for all using (
  exists (select 1 from public.announcement a where a.id = announcement_target.announcement_id and (
    current_role_name() = 'company_admin'
    or (current_role_name() = 'dept_manager' and a.created_by = auth.uid()
        and (announcement_target.department_id is null
             or public.eip_user_can_scope_dept(announcement_target.department_id)))
  ))
) with check (
  exists (select 1 from public.announcement a where a.id = announcement_target.announcement_id and (
    current_role_name() = 'company_admin'
    or (current_role_name() = 'dept_manager' and a.created_by = auth.uid()
        and (announcement_target.department_id is null
             or public.eip_user_can_scope_dept(announcement_target.department_id)))
  ))
);;
