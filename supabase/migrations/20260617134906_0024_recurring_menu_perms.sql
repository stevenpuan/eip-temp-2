-- 常態工作設定 module(管理者/主管才管理規則)
insert into role_module_permissions (role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select r.id, 'eip_recurring',
  r.code in ('admin','manager','dept_manager'),
  r.code in ('admin','manager','dept_manager'),
  r.code in ('admin','manager','dept_manager'),
  r.code in ('admin','manager'),
  r.code in ('admin','manager','dept_manager')
from roles r
where not exists (select 1 from role_module_permissions p where p.role_id=r.id and p.module_key='eip_recurring');

insert into menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select 'eip_recurring', (select id from menus where menu_key='eip_group'),
       '常態工作', 'Repeat', '/dashboard/eip/recurring', 'eip_recurring', 109, true
where not exists (select 1 from menus where menu_key='eip_recurring');;
