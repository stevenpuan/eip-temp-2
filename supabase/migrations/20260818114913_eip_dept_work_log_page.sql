-- 主管檢視/編輯部屬工作日誌所需：可督導成員清單 RPC + 模組權限 + 選單（先停用，前端上線後再開）

-- 1) 可督導（可讀日誌）的在職成員清單。SECURITY DEFINER，內部用與 work_log RLS
--    相同的 eip_is_dept_supervisor 判斷，確保挑得到的人＝RLS 讓我讀得到的人。
create or replace function public.eip_worklog_supervised_members()
returns table(user_id uuid, name text, department_id uuid, department_name text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select u.id, u.name, u.department_id, d.name
  from public.app_user u
  left join public.department d on d.id = u.department_id
  where u.tenant_id = public.current_tenant_id()
    and u.status = 'active'
    and public.eip_is_dept_supervisor(u.department_id)
  order by d.name nulls last, u.name;
$$;

revoke all on function public.eip_worklog_supervised_members() from public;
grant execute on function public.eip_worklog_supervised_members() to authenticated;

-- 2) 新模組 eip_dept_work_log 的角色權限（鏡射「部門例行彙總」的主管可見設定，
--    另加 edit）。部門主管/管理者/系統設計師：view+edit+export；一般成員/唯讀：無。
insert into public.role_module_permissions (role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
values
  ('18618da2-712b-4b9e-8e55-3fc03419a943', 'eip_dept_work_log', true,  false, true,  false, true),   -- 部門主管
  ('55f62765-1e89-4711-bb8d-81da7b197bdc', 'eip_dept_work_log', true,  false, true,  false, true),   -- 管理者
  ('8d61f010-07b5-4cdb-8dcf-b309c1635377', 'eip_dept_work_log', true,  false, true,  false, true),   -- 系統設計師
  ('c7ebbab2-f7d7-4302-9353-6720c3835cf1', 'eip_dept_work_log', false, false, false, false, false),  -- 一般成員
  ('f7b190f7-83ad-4b18-aa77-4dbce53b0d90', 'eip_dept_work_log', false, false, false, false, false);  -- 唯讀

-- 3) 選單：放在「我的工作區」群組、工作日誌之後（sort 22）。先 is_active=false，
--    等前端頁面上線後再 UPDATE 成 true，避免點了 404。
insert into public.menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
values ('eip_dept_work_log', '870e596a-4e21-467e-b769-39b8e04a9ad7', '部門日誌', 'Users',
        '/dashboard/eip/dept-work-log', 'eip_dept_work_log', 22, false);
;
