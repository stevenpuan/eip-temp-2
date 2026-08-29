
DROP POLICY IF EXISTS eip_docfiles_update ON storage.objects;
CREATE POLICY eip_docfiles_update ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'documents'
  AND (storage.foldername(name))[1] = (current_tenant_id())::text
  AND (
    current_role_name() = 'company_admin'
    OR EXISTS (SELECT 1 FROM public.attachment a
               WHERE a.storage_path = objects.name AND a.uploaded_by = auth.uid())
    OR EXISTS (SELECT 1 FROM public.eip_document_version v
               WHERE v.storage_path = objects.name AND v.created_by = auth.uid())
  )
)
WITH CHECK (
  bucket_id = 'documents'
  AND (storage.foldername(name))[1] = (current_tenant_id())::text
  AND (
    current_role_name() = 'company_admin'
    OR EXISTS (SELECT 1 FROM public.attachment a
               WHERE a.storage_path = objects.name AND a.uploaded_by = auth.uid())
    OR EXISTS (SELECT 1 FROM public.eip_document_version v
               WHERE v.storage_path = objects.name AND v.created_by = auth.uid())
  )
);
