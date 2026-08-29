
-- 1) Restrict announcement_target SELECT so recipients can only see their own row
DROP POLICY IF EXISTS ann_target_read ON public.announcement_target;
CREATE POLICY ann_target_read ON public.announcement_target
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM announcement a
    WHERE a.id = announcement_target.announcement_id
      AND a.tenant_id = current_tenant_id()
      AND (
        current_role_name() = 'company_admin'::user_role
        OR a.created_by = auth.uid()
        OR (
          a.published_at IS NOT NULL
          AND (
            announcement_target.user_id = auth.uid()
            OR announcement_target.department_id = current_department_id()
          )
        )
      )
  )
);

-- 2) Harden app_user self-update: non-admins cannot change role/tenant/department/status
DROP POLICY IF EXISTS app_user_self_update ON public.app_user;
CREATE POLICY app_user_self_update ON public.app_user
FOR UPDATE
USING (id = auth.uid())
WITH CHECK (
  id = auth.uid()
  AND (
    current_role_name() = 'company_admin'::user_role
    OR (
      role = (SELECT role FROM public.app_user WHERE id = auth.uid())
      AND tenant_id = (SELECT tenant_id FROM public.app_user WHERE id = auth.uid())
      AND department_id IS NOT DISTINCT FROM (SELECT department_id FROM public.app_user WHERE id = auth.uid())
      AND status = (SELECT status FROM public.app_user WHERE id = auth.uid())
    )
  )
);
