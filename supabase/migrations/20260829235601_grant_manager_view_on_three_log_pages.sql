-- 2026-08-29 客戶決定：三個日誌頁開放給「管理者」(manager) 檢視。
-- 只給 view，不給 create/edit/delete —— 日誌本來就不該手動增修刪。
-- 部門主管(dept_manager)與一般成員維持看不到。
--
-- 前端側欄 (AppSidebar 的 can(module_key,'view')）、頁面 RequirePerm、
-- 以及三張表的 RLS SELECT 政策 (eip_has_perm(...,'view')) 讀的是同一個旗標，
-- 所以改這一處三邊會同時生效。
update public.role_module_permissions rmp
   set can_view = true
  from public.roles r
 where r.id = rmp.role_id
   and r.code = 'manager'
   and rmp.module_key in ('activity_logs', 'audit_logs', 'error_logs');;
