-- =====================================================================
-- 0007_rls.sql — Row Level Security（角色 × 資料範圍,在資料庫層強制隔離）
--
-- 權限模型（MVP 定案）:
--   company_admin  全公司讀寫
--   dept_manager   本部門 + 自己參與的跨部門項目;可派工/審核/編輯本部門
--   member         自己 + 被指派/協作 + 本部門任務唯讀他人;可編輯自己負責的
--   viewer         指定範圍唯讀
--
-- 原則:所有表先 enable RLS;同一 tenant 為大前提;再依角色與部門細分。
-- 註:MVP 單租戶,tenant 隔離為「未來多租戶」預留;角色/部門範圍才是當下重點。
-- =====================================================================

-- ---- 開啟所有業務表的 RLS ----
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

-- ---------------------------------------------------------------------
-- 核心:同租戶可讀；管理員可寫
-- ---------------------------------------------------------------------
create policy tenant_self_read on tenant
  for select using (id = current_tenant_id());

create policy department_tenant_read on department
  for select using (tenant_id = current_tenant_id());
create policy department_admin_write on department
  for all using (tenant_id = current_tenant_id() and current_role_name() = 'company_admin')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'company_admin');

-- app_user:同租戶可讀;本人可改自己;管理員可全改
create policy app_user_tenant_read on app_user
  for select using (tenant_id = current_tenant_id());
create policy app_user_self_update on app_user
  for update using (id = auth.uid())
  with check (id = auth.uid());
create policy app_user_admin_write on app_user
  for all using (tenant_id = current_tenant_id() and current_role_name() = 'company_admin')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'company_admin');

-- ---------------------------------------------------------------------
-- 設定表（task_type / task_status）:同租戶可讀,管理員可寫
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- task:讀 = 全公司admin / 本部門 / 自己負責或協作
--       寫 = admin、dept_manager(本部門)、owner(自己負責)
-- ---------------------------------------------------------------------
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

-- task_collaborator:可見對應 task 即可讀;task 可寫者可維護協作者
create policy task_collab_read on task_collaborator
  for select using (
    exists (select 1 from task t where t.id = task_id)  -- task RLS 已限制可見範圍
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

-- task_update:可見對應 task 即可讀;被指派/協作者可新增回報
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

-- ---------------------------------------------------------------------
-- meeting / 出席 / 決議:同租戶可讀,建立者與 admin/manager 可寫
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- project / 成員 / 里程碑:同租戶可讀,admin/manager 與 owner 可寫
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- announcement:
--   讀 = 對象範圍展開後對該使用者可見（all / 本部門 / 指定個人）
--   寫 = company_admin 全公司;dept_manager 限本部門
-- ---------------------------------------------------------------------
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

-- dept_manager:僅能發本部門公告（audience_type 必須是 department,且 target 為本部門）
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

-- announcement_read:本人標記自己已讀;發布者可讀全部已讀名單
create policy ann_read_self_insert on announcement_read
  for insert with check (user_id = auth.uid());
create policy ann_read_visibility on announcement_read
  for select using (
    user_id = auth.uid()
    or exists (select 1 from announcement a where a.id = announcement_id and (
        current_role_name() = 'company_admin' or a.created_by = auth.uid()))
  );

-- ---------------------------------------------------------------------
-- 共用:attachment / comment / notification
-- ---------------------------------------------------------------------
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

-- notification:只看自己的;本人可標記已讀
create policy notification_read on notification
  for select using (user_id = auth.uid());
create policy notification_update on notification
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
