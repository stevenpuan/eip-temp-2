-- 0087: 為新模組建立選單與角色權限（前端 gating 仍走既有 can(module, action)）

-- 個人例行：放在「我的工作區」群組，排在「我的工作」之後、「工作日誌」之前
insert into public.menus(menu_key, parent_id, title, icon, route, module_key, page_key, sort_order, is_active)
select 'eip_personal_routine',
       (select id from public.menus where menu_key = 'my_workspace'),
       '個人例行', 'Repeat', '/dashboard/eip/personal-routine', 'eip_personal_routine', null, 15, true
where not exists (select 1 from public.menus where menu_key = 'eip_personal_routine');

-- 交接清單（待重新指派）：同樣放在我的工作區
insert into public.menus(menu_key, parent_id, title, icon, route, module_key, page_key, sort_order, is_active)
select 'eip_handover',
       (select id from public.menus where menu_key = 'my_workspace'),
       '交接待辦', 'UserMinus', '/dashboard/eip/handover', 'eip_handover', null, 25, true
where not exists (select 1 from public.menus where menu_key = 'eip_handover');

-- 權限：個人例行 → 全角色可用（自己管自己）；交接待辦 → 全角色可看可編（RLS 已限制只看到自己該處理的）
insert into public.role_module_permissions(role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select r.id, m.module_key, true,
       case when m.module_key = 'eip_personal_routine' then true else false end,
       true,
       case when m.module_key = 'eip_personal_routine' then true else false end,
       false
from public.roles r
cross join (values ('eip_personal_routine'), ('eip_handover')) as m(module_key)
where not exists (
  select 1 from public.role_module_permissions p
  where p.role_id = r.id and p.module_key = m.module_key);
;
