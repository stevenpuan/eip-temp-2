-- 專案改由「專案成員」機制治理可見性，不再納入跨部門唯讀分享。
-- 移除後：跨部門資料授權(eip_dept_view_grant)不再讓非成員看到別部門的專案（連點擊檢視都不行）。
-- 專案仍可透過：負責人、專案成員、同部門(visibility=department)、全公司(visibility=company)、系統管理者 等正常管道可見。
drop policy if exists project_shared_read on public.project;;
