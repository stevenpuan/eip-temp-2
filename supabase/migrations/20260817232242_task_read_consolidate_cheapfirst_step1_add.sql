-- Consolidate task SELECT RLS: single policy, cheap checks first so owner/company/collaborator
-- tasks short-circuit before the per-row department-permission function calls.
-- Semantics = exact union of existing task_read + task_shared_read (verified). Step 1: add alongside.
create policy task_read_v2 on public.task
  for select to public
  using (
    tenant_id = current_tenant_id()
    and deleted_at is null
    and (
         owner_id = (select auth.uid())
      or created_by = (select auth.uid())
      or visibility_scope = 'company'::visibility_scope
      or current_role_name() = 'company_admin'::user_role
      or exists (select 1 from public.task_collaborator tc
                 where tc.task_id = task.id and tc.user_id = (select auth.uid()))
      or (visibility_scope = 'department'::visibility_scope
          and department_id is not null
          and (eip_can_view_dept_record(department_id) or eip_can_view_dept_shared(department_id)))
    )
  );;
