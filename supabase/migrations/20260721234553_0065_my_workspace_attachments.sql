-- 個人附件(簡單結構):本人可增刪、其部門主管可看
create table if not exists public.personal_attachment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000001',
  user_id uuid not null default auth.uid() references public.app_user(id) on delete cascade,
  department_id uuid references public.department(id) on delete set null,
  title text not null,
  url text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.personal_attachment is '個人工作區附件(標題/連結/備註);本人可讀寫、其部門主管可讀';
create index if not exists ix_personal_attachment_user on public.personal_attachment (user_id, created_at desc);

alter table public.personal_attachment enable row level security;
drop policy if exists pa_read on public.personal_attachment;
create policy pa_read on public.personal_attachment for select to authenticated
  using (tenant_id = current_tenant_id()
         and (user_id = (select auth.uid()) or public.eip_is_dept_supervisor(department_id)));
drop policy if exists pa_insert on public.personal_attachment;
create policy pa_insert on public.personal_attachment for insert to authenticated
  with check (tenant_id = current_tenant_id() and user_id = (select auth.uid()));
drop policy if exists pa_update on public.personal_attachment;
create policy pa_update on public.personal_attachment for update to authenticated
  using (user_id = (select auth.uid()) or current_role_name() = 'company_admin')
  with check (user_id = (select auth.uid()) or current_role_name() = 'company_admin');
drop policy if exists pa_delete on public.personal_attachment;
create policy pa_delete on public.personal_attachment for delete to authenticated
  using (user_id = (select auth.uid()) or current_role_name() = 'company_admin');
grant select, insert, update, delete on public.personal_attachment to authenticated;
grant all on public.personal_attachment to service_role;

-- 選單:重新編號(留間距)並在「行事曆」之後插入「我的工作區 › 附件」
update public.menus set sort_order = 10  where menu_key = 'home';
update public.menus set sort_order = 20  where menu_key = 'eip_announcements';
update public.menus set sort_order = 30  where menu_key = 'eip_calendar';
update public.menus set sort_order = 50  where menu_key = 'eip_my_tasks';
update public.menus set sort_order = 60  where menu_key = 'notifications';
update public.menus set sort_order = 70  where menu_key = 'profile';
update public.menus set sort_order = 80  where menu_key = 'eip_group';
update public.menus set sort_order = 90  where menu_key = 'grp_use';
update public.menus set sort_order = 100 where menu_key = 'grp_acc';
update public.menus set sort_order = 110 where menu_key = 'grp_dev';
update public.menus set sort_order = 120 where menu_key = 'grp_sys';

insert into public.menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select 'my_workspace', null, '我的工作區', 'Briefcase', null, null, 40, true
where not exists (select 1 from public.menus where menu_key = 'my_workspace');

insert into public.menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select 'my_attachments', (select id from public.menus where menu_key='my_workspace'),
       '附件', 'Paperclip', '/dashboard/eip/attachments', null, 10, true
where not exists (select 1 from public.menus where menu_key = 'my_attachments');;
