-- 通知設定：可設定每個事件的接收對象（依角色與部門階層）與管道（站內 / LINE）
-- 純新增；不更動任何現有表或政策

create table if not exists public.notification_setting (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default '00000000-0000-0000-0000-000000000001',
  event_code     text not null,
  department_id  uuid references public.department(id) on delete cascade,
  recipient_scopes text[] not null default '{}',
  notif_type     text,
  in_app_enabled boolean not null default true,
  line_enabled   boolean not null default false,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.notification_setting is '通知設定：每個事件的接收對象與管道；department_id 為 NULL 代表全公司預設，非 NULL 代表該部門覆寫。';
comment on column public.notification_setting.recipient_scopes is '接收對象 tokens：owner / dept_manager / parent_dept_manager / all_company / role:<user_role> / user:<uuid>';
comment on column public.notification_setting.notif_type is '對應 notification.type 列舉字串（產生通知時採用）';

-- 唯一性：全公司預設每事件一筆；部門覆寫每(事件,部門)一筆
create unique index if not exists ux_notif_setting_default
  on public.notification_setting (tenant_id, event_code) where department_id is null;
create unique index if not exists ux_notif_setting_dept
  on public.notification_setting (tenant_id, event_code, department_id) where department_id is not null;

alter table public.notification_setting enable row level security;

-- 讀取：同租戶已登入者可讀（供產生通知與後台顯示）
drop policy if exists ns_select on public.notification_setting;
create policy ns_select on public.notification_setting for select to authenticated
  using (tenant_id = (select tenant_id from public.app_user where id = (select auth.uid())));

-- 寫入：僅系統管理員
drop policy if exists ns_write on public.notification_setting;
create policy ns_write on public.notification_setting for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));

grant select, insert, update, delete on public.notification_setting to authenticated;
grant all on public.notification_setting to service_role;

-- 層級解析函式：依事件與部門，回傳應收到通知的 user_id 與管道旗標
create or replace function public.eip_notification_recipients(
  p_event_code   text,
  p_department_id uuid default null,
  p_owner_id     uuid default null,
  p_actor_id     uuid default null
) returns table(user_id uuid, in_app boolean, line_enabled boolean)
language plpgsql
stable
security definer
set search_path to 'public'
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

  -- 優先取部門覆寫，否則取全公司預設
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
    elsif v_scope = 'dept_manager' then
      v_uids := v_uids || array(
        select manager_id from public.department
        where id = p_department_id and manager_id is not null);
    elsif v_scope = 'parent_dept_manager' then
      select parent_id into v_parent from public.department where id = p_department_id;
      v_uids := v_uids || array(
        select manager_id from public.department
        where id = v_parent and manager_id is not null);
    elsif v_scope = 'all_company' then
      v_uids := v_uids || array(
        select id from public.app_user
        where tenant_id = v_tenant and status = 'active');
    elsif v_scope like 'role:%' then
      v_uids := v_uids || array(
        select id from public.app_user
        where tenant_id = v_tenant and status = 'active'
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

grant execute on function public.eip_notification_recipients(text, uuid, uuid, uuid) to authenticated, service_role;

-- 預設資料（全公司層級）
insert into public.notification_setting (event_code, notif_type, recipient_scopes, in_app_enabled, line_enabled)
select v.event_code, v.notif_type, v.scopes, v.in_app, v.line
from (values
  ('task_assigned',          'assigned',     array['owner']::text[],                              true,  true),
  ('task_status_changed',    'status_changed', array['owner','dept_manager']::text[],             true,  false),
  ('quick_report_submitted', 'quick_report', array['dept_manager']::text[],                       true,  true),
  ('recurring_overdue',      'overdue',      array['dept_manager','parent_dept_manager']::text[], true,  true),
  ('announcement_published', 'announcement', array['all_company']::text[],                        true,  false),
  ('meeting_invited',        'assigned',     array['owner']::text[],                              true,  false)
) as v(event_code, notif_type, scopes, in_app, line)
where not exists (
  select 1 from public.notification_setting s
  where s.tenant_id = '00000000-0000-0000-0000-000000000001'
    and s.event_code = v.event_code and s.department_id is null
);;
