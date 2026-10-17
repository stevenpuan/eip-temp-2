-- 2026-10-17 客戶要求：訂單相關功能獨立一個選單群組「訂單管理」（原本放在「EIP 平台」底下）
-- 只動選單資料：路由、權限模組（eip_sales_order／eip_order_master）都不變。可重複執行。已於正式庫套用。
insert into public.menus (menu_key, parent_id, title, icon, route, module_key, page_key, sort_order, is_active)
values ('grp_order', null, '訂單管理', 'ShoppingCart', null, null, null, 85, true)
on conflict (menu_key) do update
  set parent_id = null, title = excluded.title, icon = excluded.icon,
      route = null, module_key = null, sort_order = excluded.sort_order, is_active = true;

insert into public.menus (menu_key, parent_id, title, sort_order)
select m.menu_key, g.id, m.title, case m.menu_key when 'eip_sales_order' then 10 else 20 end
  from public.menus m
  cross join (select id from public.menus where menu_key = 'grp_order') g
 where m.menu_key in ('eip_sales_order', 'eip_order_master')
on conflict (menu_key) do update
  set parent_id = excluded.parent_id, sort_order = excluded.sort_order;
