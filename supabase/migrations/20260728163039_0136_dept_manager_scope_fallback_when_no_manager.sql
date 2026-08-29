-- ============================================================
-- 0136 dept_manager 收件範圍的安全網
--
-- 實測發現：目前有 3 個「有在職成員但沒有指派主管」的部門
-- （分切課 1 人、學校課 2 人、衛管課 1 人）。
-- 只要事件的 recipient_scopes 是純 ['dept_manager']（例如 anomaly_filled），
-- 這些部門的通知就會**寄不到任何人**，缺失填報完會停在「待確認」沒人處理，
-- 而且不會留下任何錯誤 —— 這是最難發現的一種漏。
--
-- 修法：dept_manager 解析不到人時，往上找父部門主管；父部門也沒有，
-- 才退到 company_admin。這只是安全網，正解仍是把主管指派完整
-- （指派好之後這段路徑就不會被走到）。
-- ============================================================
create or replace function public.eip_notification_recipients(
  p_event_code text, p_department_id uuid default null,
  p_owner_id uuid default null, p_actor_id uuid default null,
  p_extra_user_ids uuid[] default null)
 returns table(user_id uuid, in_app boolean, line_enabled boolean)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_tenant uuid; v_setting public.notification_setting;
  v_scope text; v_parent uuid; v_uids uuid[] := '{}'; v_mgr uuid[];
begin
  select tenant_id into v_tenant from public.department where id = p_department_id;
  if v_tenant is null and p_owner_id is not null then
    select tenant_id into v_tenant from public.app_user where id = p_owner_id;
  end if;
  v_tenant := coalesce(v_tenant, '00000000-0000-0000-0000-000000000001');

  select * into v_setting
  from public.notification_setting s
  where s.tenant_id = v_tenant and s.event_code = p_event_code and s.is_active
    and (s.department_id = p_department_id or s.department_id is null)
  order by (s.department_id is not null) desc
  limit 1;

  -- 沒有啟用的設定＝這個事件不發通知（含 in_app 與 LINE）
  if not found then return; end if;

  -- 設定裡的收件範圍
  if v_setting.recipient_scopes is not null then
    foreach v_scope in array v_setting.recipient_scopes loop
      if v_scope = 'owner' then
        if p_owner_id is not null then v_uids := v_uids || p_owner_id; end if;
      elsif v_scope = 'deputy' then
        if p_owner_id is not null then
          v_uids := v_uids || array(
            select deputy_id from public.app_user where id = p_owner_id and deputy_id is not null);
        end if;
      elsif v_scope = 'dept_manager' then
        -- 只算「在職」的主管：離職的 manager_id 等於沒有主管（電宰會計課目前就是這種）
        v_mgr := array(
          select d.manager_id from public.department d
            join public.app_user a on a.id = d.manager_id and a.status = 'active'
           where d.id = p_department_id);
        -- 安全網①：本部門沒有在職主管 → 找父部門主管
        if coalesce(array_length(v_mgr, 1), 0) = 0 then
          select parent_id into v_parent from public.department where id = p_department_id;
          v_mgr := array(
            select d.manager_id from public.department d
              join public.app_user a on a.id = d.manager_id and a.status = 'active'
             where d.id = v_parent);
        end if;
        -- 安全網②：父部門也沒有 → 退到管理者，寧可多寄也不要整封消失
        if coalesce(array_length(v_mgr, 1), 0) = 0 then
          v_mgr := array(
            select a.id from public.app_user a
             where a.tenant_id = v_tenant and a.status = 'active'
               and a.role = 'company_admin'::user_role);
        end if;
        v_uids := v_uids || v_mgr;
      elsif v_scope = 'parent_dept_manager' then
        select parent_id into v_parent from public.department where id = p_department_id;
        v_uids := v_uids || array(
          select d.manager_id from public.department d
            join public.app_user a on a.id = d.manager_id and a.status = 'active'
           where d.id = v_parent);
      elsif v_scope = 'all_company' then
        v_uids := v_uids || array(
          select id from public.app_user where tenant_id = v_tenant and status = 'active');
      elsif v_scope like 'role:%' then
        v_uids := v_uids || array(
          select id from public.app_user where tenant_id = v_tenant and status = 'active'
            and role = substr(v_scope, 6)::user_role);
      elsif v_scope like 'user:%' then
        v_uids := v_uids || substr(v_scope, 6)::uuid;
      end if;
    end loop;
  end if;

  -- 各功能自行算出的指定名單（公告發布對象、會議出席者、特定處理人…）
  if p_extra_user_ids is not null then
    v_uids := v_uids || p_extra_user_ids;
  end if;

  -- 統一過濾：去重、排除發起人、只留在職、LINE 需真的綁定
  return query
    select distinct u.id, v_setting.in_app_enabled,
           (v_setting.line_enabled and u.line_user_id is not null)
    from unnest(v_uids) as uid
    join public.app_user u on u.id = uid
    where uid is not null
      and u.status = 'active'
      and (p_actor_id is null or u.id <> p_actor_id);
end;
$function$;

revoke all on function public.eip_notification_recipients(text, uuid, uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.eip_notification_recipients(text, uuid, uuid, uuid, uuid[]) to service_role;;
