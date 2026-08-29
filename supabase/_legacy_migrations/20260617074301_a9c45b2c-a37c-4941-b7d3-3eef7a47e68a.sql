
-- 新增 EIP 行事曆 menu 與所有角色的 view 權限
INSERT INTO menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
VALUES ('eip_calendar',
  (SELECT id FROM menus WHERE menu_key='eip_group'),
  '行事曆', 'CalendarDays', '/dashboard/eip/calendar', 'eip_calendar', 108, true)
ON CONFLICT DO NOTHING;

INSERT INTO role_module_permissions (role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
SELECT id, 'eip_calendar', true, false, false, false, false FROM roles
ON CONFLICT DO NOTHING;
