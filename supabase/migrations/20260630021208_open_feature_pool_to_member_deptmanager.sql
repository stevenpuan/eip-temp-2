
-- 許願池為全員功能：開放一般成員與部門主管 檢視+新增
update role_module_permissions
set can_view = true, can_create = true
where module_key = 'eip_feature_pool'
  and role_id in (select id from roles where code in ('member','dept_manager'));
;
