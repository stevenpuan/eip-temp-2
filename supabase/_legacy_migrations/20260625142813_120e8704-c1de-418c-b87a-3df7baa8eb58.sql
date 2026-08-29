
INSERT INTO public.menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
VALUES ('org', 'a7186dad-b876-4b65-9a72-174dd207401b', '組織架構', 'Network', '/dashboard/org', 'org', 25, true)
ON CONFLICT (menu_key) DO UPDATE SET parent_id=EXCLUDED.parent_id, title=EXCLUDED.title, route=EXCLUDED.route, module_key=EXCLUDED.module_key, sort_order=EXCLUDED.sort_order, is_active=true;

INSERT INTO public.role_module_permissions (role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
SELECT id, 'org', true, false, false, false, false FROM public.roles WHERE code IN ('admin','manager','dept_manager')
ON CONFLICT (role_id, module_key) DO UPDATE SET can_view=true;
