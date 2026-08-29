
update menus
set module_key = 'eip_work_log'
where menu_key = 'eip_work_log' and module_key is null;

insert into role_module_permissions (role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select r.id, 'eip_work_log', m.can_view, m.can_create, m.can_edit, m.can_delete, m.can_export
from (values
  ('admin',        true, true,  true,  true,  true),
  ('manager',      true, true,  true,  true,  true),
  ('dept_manager', true, true,  true,  true,  true),
  ('member',       true, true,  true,  false, false),
  ('viewer',       true, false, false, false, false)
) as m(code, can_view, can_create, can_edit, can_delete, can_export)
join roles r on r.code = m.code
where not exists (
  select 1 from role_module_permissions x
  where x.role_id = r.id and x.module_key = 'eip_work_log'
);
;
