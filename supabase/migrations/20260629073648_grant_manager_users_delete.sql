
-- 開放「管理者」對帳號列表(users)的刪除權限（系統設計師已有）
update role_module_permissions
set can_delete = true
where module_key = 'users'
  and role_id = (select id from roles where code = 'manager');
;
