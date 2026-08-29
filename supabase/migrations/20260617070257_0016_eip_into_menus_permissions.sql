-- =====================================================================
-- 0016 P0-b:把 EIP 模組納入「統一選單 + 權限」
--  - role_module_permissions:註冊 EIP 模組,各角色給適當權限
--  - menus:寫入 EIP 平台分組與項目(改由資料庫驅動,選單功能可管)
-- 註:前端 AppSidebar 仍有硬寫 EIP 區塊,需配套 Lovable 提示詞移除以免重複。
-- =====================================================================

-- 1) 權限:EIP 模組 × 角色
with mods(module_key, is_admin_only) as (
  values ('eip_tasks',false),('eip_my_tasks',false),('eip_meetings',false),
         ('eip_projects',false),('eip_announcements',false),('eip_feature_pool',false),
         ('eip_members',true)
)
insert into role_module_permissions (role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select r.id, m.module_key,
  case when m.is_admin_only then r.code in ('admin','manager') else true end,                                  -- view
  case when m.is_admin_only then r.code in ('admin','manager') else r.code in ('admin','manager','dept_manager','member') end, -- create
  case when m.is_admin_only then r.code in ('admin','manager') else r.code in ('admin','manager','dept_manager','member') end, -- edit
  case when m.is_admin_only then r.code in ('admin','manager') else r.code in ('admin','manager','dept_manager') end,          -- delete
  r.code in ('admin','manager','dept_manager')                                                                  -- export
from roles r cross join mods m
where not exists (select 1 from role_module_permissions p where p.role_id=r.id and p.module_key=m.module_key);

-- 2) 選單:EIP 平台分組 + 項目
insert into menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select 'eip_group', null, 'EIP 平台', 'LayoutGrid', null, null, 100, true
where not exists (select 1 from menus where menu_key='eip_group');

insert into menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select v.menu_key, (select id from menus where menu_key='eip_group'), v.title, v.icon, v.route, v.module_key, v.sort_order, true
from (values
  ('eip_tasks',         '任務看板',   'KanbanSquare', '/dashboard/eip/tasks',          'eip_tasks',         101),
  ('eip_my_tasks',      '我的任務',   'CheckSquare',  '/dashboard/eip/my-tasks',       'eip_my_tasks',      102),
  ('eip_meetings',      '會議',       'CalendarDays', '/dashboard/eip/meetings',       'eip_meetings',      103),
  ('eip_projects',      '專案',       'FolderKanban', '/dashboard/eip/projects',       'eip_projects',      104),
  ('eip_announcements', '公告',       'Megaphone',    '/dashboard/eip/announcements',  'eip_announcements', 105),
  ('eip_feature_pool',  '需求許願池', 'Lightbulb',    '/dashboard/eip/feature-requests','eip_feature_pool', 106),
  ('eip_members',       'EIP 成員',   'Users',        '/dashboard/eip/members',        'eip_members',       107)
) as v(menu_key, title, icon, route, module_key, sort_order)
where not exists (select 1 from menus m where m.menu_key = v.menu_key);;
