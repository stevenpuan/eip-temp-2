
-- 留言可見性綁定父項目（task/meeting/project）；本人留言與 company_admin 例外。
alter policy comment_read on public.comment
using (
  tenant_id = current_tenant_id() and (
    user_id = auth.uid()
    or current_role_name() = 'company_admin'
    or (entity_type = 'task'    and public.eip_can_see_task(entity_id))
    or (entity_type = 'meeting' and public.eip_can_see_meeting(entity_id))
    or (entity_type = 'project' and public.eip_can_see_project(entity_id))
  )
);

-- 只能對「看得到的項目」留言（寫入端一併收緊）
alter policy comment_insert on public.comment
with check (
  tenant_id = current_tenant_id() and user_id = auth.uid() and (
    current_role_name() = 'company_admin'
    or (entity_type = 'task'    and public.eip_can_see_task(entity_id))
    or (entity_type = 'meeting' and public.eip_can_see_meeting(entity_id))
    or (entity_type = 'project' and public.eip_can_see_project(entity_id))
  )
);
;
