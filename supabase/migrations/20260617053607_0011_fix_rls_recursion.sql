-- =====================================================================
-- 0011_fix_rls_recursion — 打斷 task↔task_collaborator、announcement↔announcement_target
-- 的 RLS 互相遞迴。改用 SECURITY DEFINER 輔助函式(內部查詢繞過 RLS)。
-- =====================================================================

-- ---- 輔助函式(SECURITY DEFINER,繞過 RLS,打斷遞迴) ----
create or replace function eip_is_task_collaborator(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from task_collaborator
                where task_id = p_task_id and user_id = auth.uid());
$$;

create or replace function eip_can_see_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from task t
    where t.id = p_task_id and t.tenant_id = current_tenant_id() and (
      current_role_name() = 'company_admin'
      or t.department_id = current_department_id()
      or t.owner_id = auth.uid()
      or t.created_by = auth.uid()
      or exists(select 1 from task_collaborator tc
                where tc.task_id = t.id and tc.user_id = auth.uid())
    )
  );
$$;

create or replace function eip_can_manage_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from task t
    where t.id = p_task_id and t.tenant_id = current_tenant_id() and (
      current_role_name() = 'company_admin'
      or (current_role_name() = 'dept_manager' and t.department_id = current_department_id())
      or t.owner_id = auth.uid()
    )
  );
$$;

create or replace function eip_announcement_targeted(p_announcement_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from announcement_target at
    where at.announcement_id = p_announcement_id
      and (at.department_id = current_department_id() or at.user_id = auth.uid())
  );
$$;

revoke execute on function eip_is_task_collaborator(uuid)   from public, anon;
revoke execute on function eip_can_see_task(uuid)           from public, anon;
revoke execute on function eip_can_manage_task(uuid)        from public, anon;
revoke execute on function eip_announcement_targeted(uuid)  from public, anon;
grant execute on function eip_is_task_collaborator(uuid)    to authenticated;
grant execute on function eip_can_see_task(uuid)            to authenticated;
grant execute on function eip_can_manage_task(uuid)         to authenticated;
grant execute on function eip_announcement_targeted(uuid)   to authenticated;

-- ---- task:把 task_collaborator 子查詢換成函式 ----
drop policy task_read on task;
create policy task_read on task
  for select using (
    tenant_id = current_tenant_id() and (
      current_role_name() = 'company_admin'
      or department_id = current_department_id()
      or owner_id = auth.uid()
      or created_by = auth.uid()
      or eip_is_task_collaborator(id)
    )
  );

-- ---- task_collaborator:把 task 子查詢換成函式 ----
drop policy task_collab_read on task_collaborator;
create policy task_collab_read on task_collaborator
  for select using (eip_can_see_task(task_id));

drop policy task_collab_write on task_collaborator;
create policy task_collab_write on task_collaborator
  for all using (eip_can_manage_task(task_id))
  with check (eip_can_manage_task(task_id));

-- ---- task_update:把 task 子查詢換成函式 ----
drop policy task_update_read on task_update;
create policy task_update_read on task_update
  for select using (tenant_id = current_tenant_id() and eip_can_see_task(task_id));

drop policy task_update_insert on task_update;
create policy task_update_insert on task_update
  for insert with check (
    tenant_id = current_tenant_id() and user_id = auth.uid()
    and eip_can_see_task(task_id)
  );

-- ---- announcement:把 announcement_target 子查詢換成函式 ----
drop policy announcement_read on announcement;
create policy announcement_read on announcement
  for select using (
    tenant_id = current_tenant_id() and (
      current_role_name() = 'company_admin'
      or created_by = auth.uid()
      or (published_at is not null and (
            audience_type = 'all'
            or eip_announcement_targeted(id)
      ))
    )
  );;
