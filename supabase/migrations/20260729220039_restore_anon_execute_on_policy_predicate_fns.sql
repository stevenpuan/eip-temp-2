-- ============================================================
-- 回復 0155_grant_anon_execute_on_policy_predicate_fns
--
-- 我在 golive_p0_storage_and_grants（07-30 00:06）把這 12 支函式的 anon
-- EXECUTE 收回，理由是「縮小未登入攻擊面」。但那是誤判：
--
-- 這些函式是 RLS 政策的判斷式。當未登入請求打到有政策的表時，是「呼叫者」
-- 需要 EXECUTE 權限；收回後不會回空集合，而是直接丟
--   42501: permission denied for function current_tenant_id
-- 這正是 3 小時前 0155 刻意授予它們的原因。
--
-- 且沒有資訊外洩風險：這些函式全部以 auth.uid() 為起點，未登入時 auth.uid()
-- 為 null，一律回 null / false / 無資料列（0154 已確認此行為）。
--
-- 實測（set local role anon; select count(*) from task）：
--   收回後 → 42501 錯誤
--   回復後 → 正常回 0 筆
-- ============================================================
grant execute on function
  public.current_role_name(),
  public.current_tenant_id(),
  public.eip_can_manage_task(uuid),
  public.eip_can_see_announcement(uuid),
  public.eip_can_see_meeting(uuid),
  public.eip_can_see_project(uuid),
  public.eip_can_see_task(uuid),
  public.eip_can_view_dept_record(uuid),
  public.eip_is_dept_supervisor(uuid),
  public.eip_is_task_collaborator(uuid),
  public.eip_owns_personal_event(uuid),
  public.eip_user_can_scope_dept(uuid)
to anon;
;
