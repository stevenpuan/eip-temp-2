
DROP POLICY IF EXISTS "el insert any auth" ON public.error_logs;
CREATE POLICY "el insert self" ON public.error_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);
