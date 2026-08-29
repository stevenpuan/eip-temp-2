-- 1) task_checklist: 依任務可見性
DROP POLICY IF EXISTS task_checklist_read ON public.task_checklist;
CREATE POLICY task_checklist_read ON public.task_checklist
FOR SELECT TO authenticated
USING (public.eip_can_see_task(task_id));

-- 2) work_log_item: 比照 work_log 的檢視規則
DROP POLICY IF EXISTS wli_read ON public.work_log_item;
CREATE POLICY wli_read ON public.work_log_item
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.work_log w
  WHERE w.id = work_log_item.work_log_id
    AND w.tenant_id = public.current_tenant_id()
    AND w.deleted_at IS NULL
    AND (
      w.user_id = (SELECT auth.uid())
      OR public.eip_is_dept_supervisor(w.department_id)
      OR public.current_role_name() = 'company_admin'::user_role
    )
));

-- 3) 連結端點可見性：套用各表原本的檢視規則
CREATE OR REPLACE FUNCTION public.eip_link_endpoint_visible(p_type text, p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  select case p_type
    when 'task'     then public.eip_can_see_task(p_id)
    when 'meeting'  then public.eip_can_see_meeting(p_id)
    when 'project'  then public.eip_can_see_project(p_id)
    when 'document' then exists (
      select 1 from public.eip_document d
      where d.id = p_id
        and d.tenant_id = public.current_tenant_id()
        and d.deleted_at is null
        and (
          public.current_role_name() = 'company_admin'::user_role
          or d.status = 'published'
          or d.owner_id = (select auth.uid())
          or d.created_by = (select auth.uid())
          or (d.department_id is not null and public.eip_can_view_dept_record(d.department_id))
        )
    )
    when 'defect'   then exists (
      select 1 from public.eip_anomaly a
      where a.id = p_id
        and a.tenant_id = public.current_tenant_id()
        and a.deleted_at is null
        and (
          a.subject_id = (select auth.uid())
          or a.raised_by = (select auth.uid())
          or public.current_role_name() = 'company_admin'::user_role
          or public.eip_is_dept_supervisor(a.department_id)
        )
    )
    else false
  end;
$function$;

CREATE OR REPLACE FUNCTION public.eip_url_link_visible(p_entity_type text, p_entity_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  select case p_entity_type
    when 'task'     then public.eip_can_see_task(p_entity_id)
    when 'meeting'  then public.eip_can_see_meeting(p_entity_id)
    when 'project'  then public.eip_can_see_project(p_entity_id)
    when 'document' then public.eip_link_endpoint_visible('document', p_entity_id)
    when 'anomaly'  then public.eip_link_endpoint_visible('defect', p_entity_id)
    when 'work_log' then exists (
      select 1 from public.work_log w
      where w.id = p_entity_id
        and w.tenant_id = public.current_tenant_id()
        and w.deleted_at is null
        and (
          w.user_id = (select auth.uid())
          or public.eip_is_dept_supervisor(w.department_id)
          or public.current_role_name() = 'company_admin'::user_role
        )
    )
    else false
  end;
$function$;