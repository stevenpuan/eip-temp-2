
-- 同 task 的修法：SELECT 政策原本呼叫會回查自身表的 STABLE 函式，
-- 導致 INSERT...RETURNING 看不到新列而被擋。改為直接用該列欄位判斷，語意不變。

alter policy announcement_read on public.announcement
using (
  tenant_id = current_tenant_id() and (
    current_role_name() = 'company_admin'
    or created_by = auth.uid()
    or (published_at is not null and (
          audience_type = 'all'
          or exists (select 1 from public.announcement_target t
                     where t.announcement_id = announcement.id
                       and (t.user_id = auth.uid()
                            or public.eip_can_view_dept_record(t.department_id)))
       ))
  )
);

alter policy meeting_read on public.meeting
using (
  tenant_id = current_tenant_id() and (
    current_role_name() = 'company_admin'
    or created_by = auth.uid()
    or visibility_scope = 'company'
    or (visibility_scope = 'department' and department_id is not null
        and public.eip_can_view_dept_record(department_id))
    or exists (select 1 from public.meeting_attendee ma
               where ma.meeting_id = meeting.id and ma.user_id = auth.uid())
  )
);

alter policy project_read on public.project
using (
  tenant_id = current_tenant_id() and (
    current_role_name() = 'company_admin'
    or owner_id = auth.uid()
    or visibility_scope = 'company'
    or (visibility_scope = 'department' and department_id is not null
        and public.eip_can_view_dept_record(department_id))
    or exists (select 1 from public.project_member pm
               where pm.project_id = project.id and pm.user_id = auth.uid())
  )
);
;
