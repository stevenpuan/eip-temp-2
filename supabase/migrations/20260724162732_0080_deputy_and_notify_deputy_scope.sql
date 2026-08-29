
-- 1) 員工職務代理人（職代）
alter table public.app_user
  add column if not exists deputy_id uuid references public.app_user(id) on delete set null;
comment on column public.app_user.deputy_id is '職務代理人（職代）：用於通知等場景';

-- 2) 收件人解析函式加入 deputy 對象（該對象＝owner 的職代）
create or replace function public.eip_notification_recipients(
  p_event_code text, p_department_id uuid default null, p_owner_id uuid default null, p_actor_id uuid default null)
returns table(user_id uuid, in_app boolean, line_enabled boolean)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_tenant  uuid;
  v_setting public.notification_setting;
  v_scope   text;
  v_parent  uuid;
  v_uids    uuid[] := '{}';
begin
  select tenant_id into v_tenant from public.department where id = p_department_id;
  if v_tenant is null and p_owner_id is not null then
    select tenant_id into v_tenant from public.app_user where id = p_owner_id;
  end if;
  v_tenant := coalesce(v_tenant, '00000000-0000-0000-0000-000000000001');

  select * into v_setting
  from public.notification_setting s
  where s.tenant_id = v_tenant
    and s.event_code = p_event_code
    and s.is_active
    and (s.department_id = p_department_id or s.department_id is null)
  order by (s.department_id is not null) desc
  limit 1;

  if not found then
    return;
  end if;

  foreach v_scope in array v_setting.recipient_scopes loop
    if v_scope = 'owner' then
      if p_owner_id is not null then v_uids := v_uids || p_owner_id; end if;
    elsif v_scope = 'deputy' then
      -- 職務代理人：通知該事件當事人(owner)的職代
      if p_owner_id is not null then
        v_uids := v_uids || array(
          select deputy_id from public.app_user where id = p_owner_id and deputy_id is not null);
      end if;
    elsif v_scope = 'dept_manager' then
      v_uids := v_uids || array(
        select manager_id from public.department where id = p_department_id and manager_id is not null);
    elsif v_scope = 'parent_dept_manager' then
      select parent_id into v_parent from public.department where id = p_department_id;
      v_uids := v_uids || array(
        select manager_id from public.department where id = v_parent and manager_id is not null);
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

  return query
    select distinct u, v_setting.in_app_enabled, v_setting.line_enabled
    from unnest(v_uids) as u
    where u is not null;
end;
$function$;
;
