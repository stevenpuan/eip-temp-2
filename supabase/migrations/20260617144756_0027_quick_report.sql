-- =====================================================================
-- 0027 臨時工作自助回報(遲到/請假/事件)+ 自動通知主管
-- 交辦(主管指派臨時任務)沿用既有 task,不另建表。
-- =====================================================================
create table eip_quick_report (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id) on delete cascade,
  type         text not null default 'late',   -- late 遲到 / leave 請假 / other 其他
  submitter_id uuid not null references app_user(id),
  report_date  date not null default current_date,
  detail       text,                            -- 事由/說明
  eta          text,                            -- 遲到:預計到達
  leave_from   timestamptz,                     -- 請假起
  leave_to     timestamptz,                     -- 請假迄
  status       text not null default 'open',    -- open / acknowledged
  created_at   timestamptz not null default now()
);
create index idx_qr_tenant on eip_quick_report(tenant_id);
alter table eip_quick_report enable row level security;

-- 任何登入者可送自己的回報
create policy qr_insert on eip_quick_report
  for insert with check (tenant_id = current_tenant_id() and submitter_id = auth.uid());
-- 本人看自己的;主管/管理者看全部
create policy qr_read on eip_quick_report
  for select using (
    tenant_id = current_tenant_id()
    and (submitter_id = auth.uid() or current_role_name() in ('company_admin','dept_manager'))
  );
-- 主管/管理者可更新狀態(確認)
create policy qr_update on eip_quick_report
  for update using (tenant_id = current_tenant_id() and current_role_name() in ('company_admin','dept_manager'))
  with check (tenant_id = current_tenant_id());

-- 送出時自動通知所有管理者/主管
create or replace function eip_notify_quick_report()
returns trigger language plpgsql security definer set search_path = public as $$
declare sname text;
begin
  select name into sname from app_user where id = new.submitter_id;
  insert into notification (tenant_id, user_id, type, entity_type, entity_id, message)
  select new.tenant_id, mgr.user_id, 'quick_report'::notification_type, 'quick_report'::notification_entity,
         new.id,
         (case new.type when 'late' then '【遲到回報】' when 'leave' then '【請假回報】' else '【事件回報】' end)
           || coalesce(sname,'') || ' ' || coalesce(new.detail,'')
  from (
    select distinct ur.user_id
    from user_roles ur join roles r on r.id = ur.role_id
    where r.code in ('admin','manager','dept_manager')
  ) mgr;
  return new;
end; $$;
create trigger trg_qr_notify after insert on eip_quick_report
  for each row execute function eip_notify_quick_report();

-- 權限 + 選單(主管/管理者檢視臨時回報)
insert into role_module_permissions (role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select r.id, 'eip_quick_reports',
  r.code in ('admin','manager','dept_manager'), true,
  r.code in ('admin','manager','dept_manager'),
  r.code in ('admin','manager'),
  r.code in ('admin','manager','dept_manager')
from roles r
where not exists (select 1 from role_module_permissions p where p.role_id=r.id and p.module_key='eip_quick_reports');

insert into menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select 'eip_quick_reports', (select id from menus where menu_key='eip_group'),
       '臨時回報', 'Bell', '/dashboard/eip/quick-reports', 'eip_quick_reports', 110, true
where not exists (select 1 from menus where menu_key='eip_quick_reports');;
