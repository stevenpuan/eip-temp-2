-- 通知中心（個人，所有人可見）：頂層選單
insert into public.menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select 'notifications', null, '通知中心', 'Bell', '/dashboard/notifications', null, 5, true
where not exists (select 1 from public.menus where menu_key='notifications');

-- 讓個人設定排到通知中心之後
update public.menus set sort_order = 6 where menu_key = 'profile';

-- 後台通知設定（僅管理者）：放在「系統設定」群組底下
insert into public.menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select 'eip_notification_settings',
       (select id from public.menus where menu_key='grp_sys'),
       '通知設定', 'BellRing', '/dashboard/notification-settings', 'eip_notification_settings', 10, true
where not exists (select 1 from public.menus where menu_key='eip_notification_settings');

-- 權限：系統設計師(admin) 與 管理者(manager) 可檢視/編輯通知設定
insert into public.role_module_permissions (role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select r.id, 'eip_notification_settings', true, true, true, true, false
from public.roles r
where r.code in ('admin','manager')
  and not exists (
    select 1 from public.role_module_permissions p
    where p.role_id = r.id and p.module_key = 'eip_notification_settings');;
