
DROP POLICY IF EXISTS "au insert self" ON public.audit_logs;
CREATE POLICY "au insert self" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

DROP POLICY IF EXISTS "al insert self" ON public.activity_logs;
CREATE POLICY "al insert self" ON public.activity_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

DROP POLICY IF EXISTS "fa_insert" ON public.eip_feature_analysis;
CREATE POLICY "fa_insert" ON public.eip_feature_analysis
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id() AND created_by = auth.uid());
