
-- 修正 INSERT...RETURNING 被 RLS 擋下的問題：
-- task_read 原本呼叫 eip_can_see_task(id)（STABLE 函式回查 task 表），
-- 在 INSERT...RETURNING 當下看不到新列。改為直接以該列欄位判斷可見性，語意不變。
alter policy task_read on public.task
using (
  tenant_id = current_tenant_id() and (
    current_role_name() = 'company_admin'
    or owner_id   = auth.uid()
    or created_by = auth.uid()
    or visibility_scope = 'company'
    or (visibility_scope = 'department' and department_id is not null
        and eip_can_view_dept_record(department_id))
    or exists (select 1 from task_collaborator tc
               where tc.task_id = task.id and tc.user_id = auth.uid())
  )
);
;
