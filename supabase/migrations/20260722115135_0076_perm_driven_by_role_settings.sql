-- ============================================================
-- 權限以「角色權限設定」為唯一準則：功能/後台閘門改讀 role_module_permissions
-- 資料可見範圍（部門/本人）維持依帳號角色+部門（current_role_name），不在此變動
-- ============================================================

-- 讀角色設定的判斷函式（供 RLS 使用；SECURITY DEFINER 以繞過表本身 RLS）
create or replace function public.eip_has_perm(p_module text, p_action text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_module_permissions p on p.role_id = ur.role_id
    where ur.user_id = (select auth.uid())
      and p.module_key = p_module
      and case p_action
            when 'view'   then p.can_view
            when 'create' then p.can_create
            when 'edit'   then p.can_edit
            when 'delete' then p.can_delete
            when 'export' then p.can_export
            else false end
  );
$$;
revoke execute on function public.eip_has_perm(text,text) from public;
grant execute on function public.eip_has_perm(text,text) to authenticated;

-- ---- 通知設定 ----
drop policy if exists ns_write on public.notification_setting;
create policy ns_write on public.notification_setting for all to authenticated
  using (eip_has_perm('eip_notification_settings','edit')) with check (eip_has_perm('eip_notification_settings','edit'));

-- ---- 角色權限 / 頁面權限 / 角色（保留系統設計師防鎖死後路）----
drop policy if exists "rmp admin write" on public.role_module_permissions;
create policy "rmp admin write" on public.role_module_permissions for all to authenticated
  using (eip_has_perm('role_permissions','edit') or is_admin((select auth.uid())))
  with check (eip_has_perm('role_permissions','edit') or is_admin((select auth.uid())));
drop policy if exists "rpp admin write" on public.role_page_permissions;
create policy "rpp admin write" on public.role_page_permissions for all to authenticated
  using (eip_has_perm('role_permissions','edit') or is_admin((select auth.uid())))
  with check (eip_has_perm('role_permissions','edit') or is_admin((select auth.uid())));
drop policy if exists "roles admin write" on public.roles;
create policy "roles admin write" on public.roles for all to authenticated
  using (eip_has_perm('role_permissions','edit') or is_admin((select auth.uid())))
  with check (eip_has_perm('role_permissions','edit') or is_admin((select auth.uid())));

-- ---- 帳號 / 角色指派 / 邀請 / 個人檔（帳號管理 users；保留防鎖死）----
drop policy if exists "user_roles admin write" on public.user_roles;
create policy "user_roles admin write" on public.user_roles for all to authenticated
  using (eip_has_perm('users','edit') or is_admin((select auth.uid())))
  with check (eip_has_perm('users','edit') or is_admin((select auth.uid())));
drop policy if exists "invitations admin all" on public.invitations;
create policy "invitations admin all" on public.invitations for all to authenticated
  using (eip_has_perm('users','edit')) with check (eip_has_perm('users','edit'));
drop policy if exists "profiles admin all" on public.profiles;
create policy "profiles admin all" on public.profiles for all to authenticated
  using (eip_has_perm('users','edit')) with check (eip_has_perm('users','edit'));

-- ---- 選單 / 資料字典 / 假別 / 環境參數 / AI 關鍵字 / 系統文件 ----
drop policy if exists "menus admin write" on public.menus;
create policy "menus admin write" on public.menus for all to authenticated
  using (eip_has_perm('menu_management','edit')) with check (eip_has_perm('menu_management','edit'));
drop policy if exists "lk admin write" on public.lookups;
create policy "lk admin write" on public.lookups for all to authenticated
  using (eip_has_perm('lookups','edit')) with check (eip_has_perm('lookups','edit'));
drop policy if exists leave_type_write on public.leave_type;
create policy leave_type_write on public.leave_type for all to authenticated
  using (eip_has_perm('lookups','edit')) with check (eip_has_perm('lookups','edit'));
drop policy if exists "cfg admin write" on public.system_configs;
create policy "cfg admin write" on public.system_configs for all to authenticated
  using (eip_has_perm('system_config','edit')) with check (eip_has_perm('system_config','edit'));
drop policy if exists app_config_admin on public.app_config;
create policy app_config_admin on public.app_config for all to authenticated
  using (eip_has_perm('system_config','edit')) with check (eip_has_perm('system_config','edit'));
drop policy if exists "eip_assistant_intent_write" on public.eip_assistant_intent;
create policy "eip_assistant_intent_write" on public.eip_assistant_intent for all to authenticated
  using (eip_has_perm('assistant_intent','edit')) with check (eip_has_perm('assistant_intent','edit'));
drop policy if exists "doc admin write" on public.doc_pages;
create policy "doc admin write" on public.doc_pages for all to authenticated
  using (eip_has_perm('system_docs','edit')) with check (eip_has_perm('system_docs','edit'));
drop policy if exists "cl admin write" on public.changelogs;
create policy "cl admin write" on public.changelogs for all to authenticated
  using (eip_has_perm('dev_history','edit')) with check (eip_has_perm('dev_history','edit'));

-- ---- 系統開發：問題反饋 / 代辦 / 日誌 ----
drop policy if exists "ir admin write" on public.issue_reports;
create policy "ir admin write" on public.issue_reports for update to authenticated
  using (eip_has_perm('issue_reports','edit')) with check (eip_has_perm('issue_reports','edit'));
drop policy if exists "ir admin del" on public.issue_reports;
create policy "ir admin del" on public.issue_reports for delete to authenticated
  using (eip_has_perm('issue_reports','delete'));
drop policy if exists "dt admin write" on public.dev_todos;
create policy "dt admin write" on public.dev_todos for update to authenticated
  using (eip_has_perm('dev_todos','edit')) with check (eip_has_perm('dev_todos','edit'));
drop policy if exists "dt admin del" on public.dev_todos;
create policy "dt admin del" on public.dev_todos for delete to authenticated
  using (eip_has_perm('dev_todos','delete'));
drop policy if exists "al admin read" on public.activity_logs;
create policy "al admin read" on public.activity_logs for select to authenticated
  using (eip_has_perm('activity_logs','view'));
drop policy if exists "au admin read" on public.audit_logs;
create policy "au admin read" on public.audit_logs for select to authenticated
  using (eip_has_perm('audit_logs','view'));
drop policy if exists "el admin read" on public.error_logs;
create policy "el admin read" on public.error_logs for select to authenticated
  using (eip_has_perm('error_logs','view'));

-- ---- 後台函式：設定使用者角色改讀設定（保留系統設計師防鎖死）----
create or replace function public.eip_set_user_roles(p_user_id uuid, p_role_ids uuid[])
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not (public.eip_has_perm('users','edit') or public.is_admin(auth.uid())) then
    raise exception 'not authorized';
  end if;
  if p_role_ids is null or array_length(p_role_ids,1) is null then
    raise exception 'at least one role is required';
  end if;
  delete from public.user_roles where user_id = p_user_id;
  insert into public.user_roles(user_id, role_id)
    select p_user_id, rid from unnest(p_role_ids) as rid
    where exists (select 1 from public.roles r where r.id = rid);
end;
$function$;;
