
-- Tighten docver_read to respect parent document visibility
DROP POLICY IF EXISTS docver_read ON public.eip_document_version;
CREATE POLICY docver_read ON public.eip_document_version
FOR SELECT USING (
  tenant_id = current_tenant_id()
  AND EXISTS (
    SELECT 1 FROM public.eip_document d
    WHERE d.id = eip_document_version.document_id
      AND (
        current_role_name() = 'company_admin'
        OR d.owner_id = auth.uid()
        OR d.created_by = auth.uid()
        OR (d.status = 'published' AND (
              d.department_id IS NULL
              OR public.eip_can_view_dept_record(d.department_id)
            ))
      )
  )
);

-- Tighten meeting_agenda_item read to meeting visibility
DROP POLICY IF EXISTS agenda_read ON public.meeting_agenda_item;
CREATE POLICY agenda_read ON public.meeting_agenda_item
FOR SELECT USING (
  tenant_id = current_tenant_id()
  AND public.eip_can_see_meeting(meeting_id)
);

-- Tighten project_kpi and project_risk reads to project visibility
DROP POLICY IF EXISTS project_kpi_read ON public.project_kpi;
CREATE POLICY project_kpi_read ON public.project_kpi
FOR SELECT USING (
  tenant_id = current_tenant_id()
  AND public.eip_can_see_project(project_id)
);

DROP POLICY IF EXISTS project_risk_read ON public.project_risk;
CREATE POLICY project_risk_read ON public.project_risk
FOR SELECT USING (
  tenant_id = current_tenant_id()
  AND public.eip_can_see_project(project_id)
);
