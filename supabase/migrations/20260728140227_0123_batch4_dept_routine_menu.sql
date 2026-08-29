-- 0123 批4：部門例行彙總掛進側邊選單與角色權限
-- eip_dept_routine_summary 是 fail-closed，只允許 company_admin / dept_manager，
-- 所以 member / viewer 的 can_view 直接關掉 —— 讓他們連選單都看不到，
-- 而不是點進去才吃一個「權限不足」的錯誤。

insert into public.menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select 'eip_dept_routine',
       (select id from public.menus where menu_key = 'eip_group'),
       '部門例行彙總', 'Repeat', '/dashboard/eip/dept-routine', 'eip_dept_routine', 114, true
where not exists (select 1 from public.menus where menu_key = 'eip_dept_routine');

insert into public.role_module_permissions
  (role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select r.id, 'eip_dept_routine', v.can_view, false, false, false, v.can_view
from (values
  ('admin',        true ),
  ('manager',      true ),
  ('dept_manager', true ),
  ('member',       false),
  ('viewer',       false)
) v(code, can_view)
join public.roles r on r.code = v.code
where not exists (
  select 1 from public.role_module_permissions p
   where p.role_id = r.id and p.module_key = 'eip_dept_routine');;
