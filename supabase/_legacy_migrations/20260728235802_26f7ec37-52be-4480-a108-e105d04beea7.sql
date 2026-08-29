INSERT INTO public.role_module_permissions (role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
SELECT r.id, m.module_key, false, false, false, false, false
FROM public.roles r
CROSS JOIN (VALUES ('org'), ('eip_notification_settings')) AS m(module_key)
WHERE r.code = 'viewer'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_module_permissions p
    WHERE p.role_id = r.id AND p.module_key = m.module_key
  );