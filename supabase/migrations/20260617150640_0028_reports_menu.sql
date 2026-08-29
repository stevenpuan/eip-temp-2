-- 報表分析 module(主管/管理者)
insert into role_module_permissions (role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select r.id, 'eip_reports',
  r.code in ('admin','manager','dept_manager'), false, false, false,
  r.code in ('admin','manager','dept_manager')
from roles r
where not exists (select 1 from role_module_permissions p where p.role_id=r.id and p.module_key='eip_reports');

insert into menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select 'eip_reports', (select id from menus where menu_key='eip_group'),
       '報表分析', 'BarChart3', '/dashboard/eip/reports', 'eip_reports', 111, true
where not exists (select 1 from menus where menu_key='eip_reports');;
