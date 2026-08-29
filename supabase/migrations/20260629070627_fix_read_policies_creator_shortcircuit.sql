
-- 改用「建立者短路 OR 原函式」：避免 inline 子表造成的遞迴，
-- 又能讓 INSERT...RETURNING 在建立者欄位即通過（不觸發看不到新列的 STABLE 函式）。

alter policy announcement_read on public.announcement
using (
  tenant_id = current_tenant_id()
  and (created_by = auth.uid() or public.eip_can_see_announcement(id))
);

alter policy meeting_read on public.meeting
using (
  tenant_id = current_tenant_id()
  and (created_by = auth.uid() or public.eip_can_see_meeting(id))
);

alter policy project_read on public.project
using (
  tenant_id = current_tenant_id()
  and (owner_id = auth.uid() or public.eip_can_see_project(id))
);
;
