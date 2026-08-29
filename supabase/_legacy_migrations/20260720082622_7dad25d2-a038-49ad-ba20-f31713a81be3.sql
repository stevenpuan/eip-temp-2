
-- Allow creator + collaborator to edit tasks
DROP POLICY IF EXISTS task_update_policy ON public.task;
CREATE POLICY task_update_policy ON public.task
  FOR UPDATE USING (
    tenant_id = current_tenant_id() AND (
      current_role_name() = 'company_admin'
      OR (current_role_name() = 'dept_manager' AND department_id IS NOT NULL AND eip_user_can_scope_dept(department_id))
      OR owner_id = auth.uid()
      OR created_by = auth.uid()
      OR eip_is_task_collaborator(id)
    )
  );

-- Allow creator + collaborator to delete tasks
DROP POLICY IF EXISTS task_delete ON public.task;
CREATE POLICY task_delete ON public.task
  FOR DELETE USING (
    tenant_id = current_tenant_id() AND (
      current_role_name() = 'company_admin'
      OR (current_role_name() = 'dept_manager' AND department_id IS NOT NULL AND eip_user_can_scope_dept(department_id))
      OR owner_id = auth.uid()
      OR created_by = auth.uid()
      OR eip_is_task_collaborator(id)
    )
  );
