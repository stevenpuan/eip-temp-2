alter table tenant                enable row level security;
alter table department            enable row level security;
alter table app_user              enable row level security;
alter table task_type             enable row level security;
alter table task_status           enable row level security;
alter table task                  enable row level security;
alter table task_collaborator     enable row level security;
alter table task_update           enable row level security;
alter table meeting               enable row level security;
alter table meeting_attendee      enable row level security;
alter table meeting_action_item   enable row level security;
alter table project               enable row level security;
alter table project_member        enable row level security;
alter table milestone             enable row level security;
alter table announcement          enable row level security;
alter table announcement_target   enable row level security;
alter table announcement_read     enable row level security;
alter table attachment            enable row level security;
alter table comment               enable row level security;
alter table notification          enable row level security;

create policy tenant_self_read on tenant
  for select using (id = current_tenant_id());

create policy department_tenant_read on department
  for select using (tenant_id = current_tenant_id());
create policy department_admin_write on department
  for all using (tenant_id = current_tenant_id() and current_role_name() = 'company_admin')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'company_admin');

create policy app_user_tenant_read on app_user
  for select using (tenant_id = current_tenant_id());
create policy app_user_self_update on app_user
  for update using (id = auth.uid())
  with check (id = auth.uid());
create policy app_user_admin_write on app_user
  for all using (tenant_id = current_tenant_id() and current_role_name() = 'company_admin')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'company_admin');

create policy task_type_read on task_type
  for select using (tenant_id = current_tenant_id());
create policy task_type_admin_write on task_type
  for all using (tenant_id = current_tenant_id()
                 and current_role_name() in ('company_admin','dept_manager'))
  with check (tenant_id = current_tenant_id()
              and current_role_name() in ('company_admin','dept_manager'));

create policy task_status_read on task_status
  for select using (tenant_id = current_tenant_id());
create policy task_status_admin_write on task_status
  for all using (tenant_id = current_tenant_id()
                 and current_role_name() in ('company_admin','dept_manager'))
  with check (tenant_id = current_tenant_id()
              and current_role_name() in ('company_admin','dept_manager'));

create policy task_read on task
  for select using (
    tenant_id = current_tenant_id() and (
      current_role_name() = 'company_admin'
      or department_id = current_department_id()
      or owner_id = auth.uid()
      or created_by = auth.uid()
      or exists (select 1 from task_collaborator tc
                 where tc.task_id = task.id and tc.user_id = auth.uid())
    )
  );

create policy task_insert on task
  for insert with check (
    tenant_id = current_tenant_id()
    and current_role_name() in ('company_admin','dept_manager','member')
  );

create policy task_update_policy on task
  for update using (
    tenant_id = current_tenant_id() and (
      current_role_name() = 'company_admin'
      or (current_role_name() = 'dept_manager' and department_id = current_department_id())
      or owner_id = auth.uid()
    )
  )
  with check (tenant_id = current_tenant_id());

create policy task_delete on task
  for delete using (
    tenant_id = current_tenant_id() and (
      current_role_name() = 'company_admin'
      or (current_role_name() = 'dept_manager' and department_id = current_department_id())
    )
  );

create policy task_collab_read on task_collaborator
  for select using (
    exists (select 1 from task t where t.id = task_id)
  );
create policy task_collab_write on task_collaborator
  for all using (
    exists (select 1 from task t where t.id = task_id and (
      current_role_name() = 'company_admin'
      or (current_role_name() = 'dept_manager' and t.department_id = current_department_id())
      or t.owner_id = auth.uid()
    ))
  )
  with check (true);

create policy task_update_read on task_update
  for select using (tenant_id = current_tenant_id()
                    and exists (select 1 from task t where t.id = task_id));
create policy task_update_insert on task_update
  for insert with check (
    tenant_id = current_tenant_id() and user_id = auth.uid()
    and exists (select 1 from task t where t.id = task_id and (
      current_role_name() = 'company_admin'
      or t.owner_id = auth.uid()
      or t.department_id = current_department_id()
      or exists (select 1 from task_collaborator tc
                 where tc.task_id = t.id and tc.user_id = auth.uid())
    ))
  );

create policy meeting_read on meeting
  for select using (tenant_id = current_tenant_id());
create policy meeting_write on meeting
  for all using (
    tenant_id = current_tenant_id() and (
      current_role_name() in ('company_admin','dept_manager')
      or created_by = auth.uid()
    )
  )
  with check (tenant_id = current_tenant_id());

create policy meeting_attendee_read on meeting_attendee
  for select using (exists (select 1 from meeting m where m.id = meeting_id));
create policy meeting_attendee_write on meeting_attendee
  for all using (exists (select 1 from meeting m where m.id = meeting_id and (
      current_role_name() in ('company_admin','dept_manager') or m.created_by = auth.uid())))
  with check (true);

create policy action_item_read on meeting_action_item
  for select using (tenant_id = current_tenant_id());
create policy action_item_write on meeting_action_item
  for all using (tenant_id = current_tenant_id()
                 and current_role_name() in ('company_admin','dept_manager'))
  with check (tenant_id = current_tenant_id());

create policy project_read on project
  for select using (tenant_id = current_tenant_id());
create policy project_write on project
  for all using (
    tenant_id = current_tenant_id() and (
      current_role_name() in ('company_admin','dept_manager')
      or owner_id = auth.uid()
    )
  )
  with check (tenant_id = current_tenant_id());

create policy project_member_read on project_member
  for select using (exists (select 1 from project p where p.id = project_id));
create policy project_member_write on project_member
  for all using (exists (select 1 from project p where p.id = project_id and (
      current_role_name() in ('company_admin','dept_manager') or p.owner_id = auth.uid())))
  with check (true);

create policy milestone_read on milestone
  for select using (tenant_id = current_tenant_id());
create policy milestone_write on milestone
  for all using (tenant_id = current_tenant_id()
                 and current_role_name() in ('company_admin','dept_manager'))
  with check (tenant_id = current_tenant_id());

create policy announcement_read on announcement
  for select using (
    tenant_id = current_tenant_id() and (
      current_role_name() = 'company_admin'
      or created_by = auth.uid()
      or (published_at is not null and (
            audience_type = 'all'
            or exists (select 1 from announcement_target at
                       where at.announcement_id = announcement.id
                         and (at.department_id = current_department_id()
                              or at.user_id = auth.uid()))
      ))
    )
  );

create policy announcement_admin_write on announcement
  for all using (tenant_id = current_tenant_id() and current_role_name() = 'company_admin')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'company_admin');

create policy announcement_manager_insert on announcement
  for insert with check (
    tenant_id = current_tenant_id()
    and current_role_name() = 'dept_manager'
    and audience_type = 'department'
  );
create policy announcement_manager_update on announcement
  for update using (
    tenant_id = current_tenant_id()
    and current_role_name() = 'dept_manager'
    and created_by = auth.uid()
  )
  with check (tenant_id = current_tenant_id());

create policy ann_target_read on announcement_target
  for select using (exists (select 1 from announcement a where a.id = announcement_id));
create policy ann_target_write on announcement_target
  for all using (exists (select 1 from announcement a where a.id = announcement_id and (
      current_role_name() = 'company_admin'
      or (current_role_name() = 'dept_manager' and a.created_by = auth.uid()))))
  with check (true);

create policy ann_read_self_insert on announcement_read
  for insert with check (user_id = auth.uid());
create policy ann_read_visibility on announcement_read
  for select using (
    user_id = auth.uid()
    or exists (select 1 from announcement a where a.id = announcement_id and (
        current_role_name() = 'company_admin' or a.created_by = auth.uid()))
  );

create policy attachment_read on attachment
  for select using (tenant_id = current_tenant_id());
create policy attachment_write on attachment
  for all using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id() and uploaded_by = auth.uid());

create policy comment_read on comment
  for select using (tenant_id = current_tenant_id());
create policy comment_insert on comment
  for insert with check (tenant_id = current_tenant_id() and user_id = auth.uid());
create policy comment_modify on comment
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy comment_delete on comment
  for delete using (user_id = auth.uid() or current_role_name() = 'company_admin');

create policy notification_read on notification
  for select using (user_id = auth.uid());
create policy notification_update on notification
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());;
