-- 0119 批5：把異常缺失掛進側邊選單與角色權限
-- 側邊欄是 DB 驅動的（menus 表），不是寫在程式碼裡，所以新頁面要在這裡註冊。
-- 權限比照「臨時回報」：admin / manager / dept_manager 全開，member 可看可編不可刪，viewer 全關。
-- （member 的「可編」＝能替自己開自主填報、能填報主管開給自己的缺失；
--   「確認並追蹤改善／結案／作廢」由 RLS 另外限定只有主管與管理者能做，
--   不靠前端權限旗標。）

insert into public.menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select 'eip_anomaly',
       (select id from public.menus where menu_key = 'eip_group'),
       '異常缺失', 'ShieldAlert', '/dashboard/eip/anomalies', 'eip_anomaly', 112, true
where not exists (select 1 from public.menus where menu_key = 'eip_anomaly');

insert into public.role_module_permissions
  (role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select r.id, 'eip_anomaly',
       v.can_view, v.can_create, v.can_edit, v.can_delete, v.can_export
from (values
  ('admin',        true,  true,  true,  true,  true ),
  ('manager',      true,  true,  true,  true,  true ),
  ('dept_manager', true,  true,  true,  true,  true ),
  ('member',       true,  true,  true,  false, false),
  ('viewer',       false, false, false, false, false)
) v(code, can_view, can_create, can_edit, can_delete, can_export)
join public.roles r on r.code = v.code
where not exists (
  select 1 from public.role_module_permissions p
   where p.role_id = r.id and p.module_key = 'eip_anomaly');;
