-- 撤掉先前誤建的個人附件表與附件選單
drop table if exists public.personal_attachment cascade;
delete from public.menus where menu_key = 'my_attachments';

-- 把個人項目收進「我的工作區」可收合群組
update public.menus set parent_id = (select id from public.menus where menu_key='my_workspace'), sort_order = 10
  where menu_key = 'eip_my_tasks';   -- 我的工作
update public.menus set parent_id = (select id from public.menus where menu_key='my_workspace'), sort_order = 20
  where menu_key = 'eip_work_log';   -- 工作日誌
update public.menus set parent_id = (select id from public.menus where menu_key='my_workspace'), sort_order = 30
  where menu_key = 'notifications';  -- 通知中心
update public.menus set parent_id = (select id from public.menus where menu_key='my_workspace'), sort_order = 40
  where menu_key = 'profile';        -- 個人設定;
