
-- 1. invitations: drop public read
DROP POLICY IF EXISTS "invitations read all auth" ON public.invitations;

-- 2. profiles: drop blanket read, self only (admin already covered)
DROP POLICY IF EXISTS "profiles read all" ON public.profiles;
CREATE POLICY "profiles self read" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid());

-- 3. app_user: prevent self privilege escalation via trigger
CREATE OR REPLACE FUNCTION public.prevent_app_user_self_escalation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Only restrict when the row owner is updating their own row and is not company_admin
  IF auth.uid() = NEW.id AND COALESCE(current_role_name()::text, '') <> 'company_admin' THEN
    NEW.role := OLD.role;
    NEW.tenant_id := OLD.tenant_id;
    NEW.status := OLD.status;
    NEW.department_id := OLD.department_id;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.prevent_app_user_self_escalation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_prevent_app_user_self_escalation ON public.app_user;
CREATE TRIGGER trg_prevent_app_user_self_escalation
  BEFORE UPDATE ON public.app_user
  FOR EACH ROW EXECUTE FUNCTION public.prevent_app_user_self_escalation();

-- 4. audit_logs / activity_logs: force user_id to be the caller
DROP POLICY IF EXISTS "au insert any auth" ON public.audit_logs;
CREATE POLICY "au insert self" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "al insert any auth" ON public.activity_logs;
CREATE POLICY "al insert self" ON public.activity_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 5. announcement_target: scope read to visible announcements
DROP POLICY IF EXISTS "ann_target_read" ON public.announcement_target;
CREATE POLICY "ann_target_read" ON public.announcement_target
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.announcement a
      WHERE a.id = announcement_target.announcement_id
        AND a.tenant_id = current_tenant_id()
        AND (
          current_role_name() = 'company_admin'::user_role
          OR a.created_by = auth.uid()
          OR (a.published_at IS NOT NULL
              AND (a.audience_type = 'all'::announcement_audience
                   OR eip_announcement_targeted(a.id)))
        )
    )
  );

-- 6. attachment: split ALL into INSERT/UPDATE/DELETE
DROP POLICY IF EXISTS "attachment_write" ON public.attachment;
CREATE POLICY "attachment_insert" ON public.attachment
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id() AND uploaded_by = auth.uid());
CREATE POLICY "attachment_update" ON public.attachment
  FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id() AND (uploaded_by = auth.uid() OR current_role_name() = 'company_admin'::user_role))
  WITH CHECK (tenant_id = current_tenant_id() AND (uploaded_by = auth.uid() OR current_role_name() = 'company_admin'::user_role));
CREATE POLICY "attachment_delete" ON public.attachment
  FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id() AND (uploaded_by = auth.uid() OR current_role_name() = 'company_admin'::user_role));

-- 7. eip_document_version: inherit parent document visibility
DROP POLICY IF EXISTS "docver_read" ON public.eip_document_version;
CREATE POLICY "docver_read" ON public.eip_document_version
  FOR SELECT USING (
    tenant_id = current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.eip_document d
      WHERE d.id = eip_document_version.document_id
        AND d.tenant_id = current_tenant_id()
        AND (
          current_role_name() = 'company_admin'::user_role
          OR d.owner_id = auth.uid()
          OR d.created_by = auth.uid()
          OR COALESCE(d.status, '') = 'published'
        )
    )
  );

-- 8. eip_rule_due_on: set search_path
ALTER FUNCTION public.eip_rule_due_on(recurring_rule, date) SET search_path = public;

-- 9. Revoke EXECUTE on SECURITY DEFINER functions not meant for end-user calls
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_profile_to_app_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.eip_notify_quick_report() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.eip_run_recurring(date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

-- Revoke anon on RLS helpers (keep authenticated EXECUTE)
REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_department_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_role_name() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.eip_can_see_task(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.eip_can_manage_task(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.eip_is_task_collaborator(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.eip_announcement_targeted(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.redeem_invitation(text) FROM PUBLIC, anon;
