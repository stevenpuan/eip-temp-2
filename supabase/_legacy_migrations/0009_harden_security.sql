-- =====================================================================
-- 0009_harden_security.sql — 安全強化（對應 Supabase advisor 修正）
-- 1) 固定 trigger 函式 search_path
-- 2) RLS helper 函式：撤掉 anon/public 的 RPC 執行權,只留 authenticated（RLS 內部仍需）
-- 3) 四張關聯表的寫入 policy：把 with check (true) 收緊為與 using 相同條件
-- =====================================================================

-- 1)
alter function public.set_updated_at() set search_path = public;

-- 2)
revoke execute on function public.current_tenant_id()     from public, anon;
revoke execute on function public.current_role_name()     from public, anon;
revoke execute on function public.current_department_id() from public, anon;
grant  execute on function public.current_tenant_id()     to authenticated;
grant  execute on function public.current_role_name()     to authenticated;
grant  execute on function public.current_department_id() to authenticated;

-- 3)
drop policy task_collab_write on task_collaborator;
create policy task_collab_write on task_collaborator
  for all using (
    exists (select 1 from task t where t.id = task_id and (
      current_role_name() = 'company_admin'
      or (current_role_name() = 'dept_manager' and t.department_id = current_department_id())
      or t.owner_id = auth.uid()))
  )
  with check (
    exists (select 1 from task t where t.id = task_id and (
      current_role_name() = 'company_admin'
      or (current_role_name() = 'dept_manager' and t.department_id = current_department_id())
      or t.owner_id = auth.uid()))
  );

drop policy meeting_attendee_write on meeting_attendee;
create policy meeting_attendee_write on meeting_attendee
  for all using (
    exists (select 1 from meeting m where m.id = meeting_id and (
      current_role_name() in ('company_admin','dept_manager') or m.created_by = auth.uid()))
  )
  with check (
    exists (select 1 from meeting m where m.id = meeting_id and (
      current_role_name() in ('company_admin','dept_manager') or m.created_by = auth.uid()))
  );

drop policy project_member_write on project_member;
create policy project_member_write on project_member
  for all using (
    exists (select 1 from project p where p.id = project_id and (
      current_role_name() in ('company_admin','dept_manager') or p.owner_id = auth.uid()))
  )
  with check (
    exists (select 1 from project p where p.id = project_id and (
      current_role_name() in ('company_admin','dept_manager') or p.owner_id = auth.uid()))
  );

drop policy ann_target_write on announcement_target;
create policy ann_target_write on announcement_target
  for all using (
    exists (select 1 from announcement a where a.id = announcement_id and (
      current_role_name() = 'company_admin'
      or (current_role_name() = 'dept_manager' and a.created_by = auth.uid())))
  )
  with check (
    exists (select 1 from announcement a where a.id = announcement_id and (
      current_role_name() = 'company_admin'
      or (current_role_name() = 'dept_manager' and a.created_by = auth.uid())))
  );
