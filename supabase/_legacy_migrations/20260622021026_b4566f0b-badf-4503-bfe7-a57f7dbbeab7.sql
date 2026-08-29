
DROP POLICY IF EXISTS "eip_docfiles_delete" ON storage.objects;
CREATE POLICY "eip_docfiles_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = current_tenant_id()::text
    AND (
      current_role_name() = 'company_admin'
      OR EXISTS (
        SELECT 1 FROM public.attachment a
        WHERE a.storage_path = name AND a.uploaded_by = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.eip_document_version v
        WHERE v.storage_path = name AND v.created_by = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "meeting_attendee_read" ON public.meeting_attendee;
CREATE POLICY "meeting_attendee_read" ON public.meeting_attendee
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.meeting m
      WHERE m.id = meeting_attendee.meeting_id
        AND m.tenant_id = current_tenant_id()
    )
  );

DROP POLICY IF EXISTS "project_member_read" ON public.project_member;
CREATE POLICY "project_member_read" ON public.project_member
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.project p
      WHERE p.id = project_member.project_id
        AND p.tenant_id = current_tenant_id()
    )
  );
