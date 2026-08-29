-- 0122 批6：績效儀表板掛進側邊選單與角色權限
-- 側邊欄是 DB 驅動的（menus 表），新頁面不註冊就不會出現。
--
-- 權限對照（前端用 can() 讀這張表，後端 RLS/函式守衛才是真正的授權）：
--   can_view   = 能進這一頁（一般同仁進來只看到自己的數字，由 eip_performance_summary 內部限制）
--   can_export = 借用來當「能看部門/全公司彙總」的旗標。
--              對應 eip_performance_by_dept 的 fail-closed 守衛（僅 company_admin / dept_manager）。
--              member/viewer 關掉，前端就不會去打那支必然被拒的 RPC。

insert into public.menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select 'eip_performance',
       (select id from public.menus where menu_key = 'eip_group'),
       '績效儀表板', 'BarChart3', '/dashboard/eip/performance', 'eip_performance', 113, true
where not exists (select 1 from public.menus where menu_key = 'eip_performance');

insert into public.role_module_permissions
  (role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select r.id, 'eip_performance',
       v.can_view, false, false, false, v.can_export
from (values
  ('admin',        true,  true ),
  ('manager',      true,  true ),
  ('dept_manager', true,  true ),
  ('member',       true,  false),
  ('viewer',       false, false)
) v(code, can_view, can_export)
join public.roles r on r.code = v.code
where not exists (
  select 1 from public.role_module_permissions p
   where p.role_id = r.id and p.module_key = 'eip_performance');;
