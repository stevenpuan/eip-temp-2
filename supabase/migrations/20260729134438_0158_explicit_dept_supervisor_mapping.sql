-- ============================================================
-- 0157 把「管轄範圍」收斂成只認 department.manager_id，
-- 但 department 只能有一個 manager_id，而實務上總經理室需要兩位督導
-- （曾俊凱是 manager_id，曾義仁也要保留同等權限 —— 使用者定案）。
--
-- 不退回 0157：退回等於「坐在總經理室 + 有 dept_manager 角色代碼」
-- 就自動取得全公司 17 個部門的 UPDATE/DELETE 權，下一個被放進總經理室的人
-- 會再次無聲取得同樣權限。
--
-- 改成明確登記：新增 eip_dept_supervisor 對應表，管轄 = manager_id ∪ 明確登記，
-- 兩者都往子樹展開。權限一樣，但有紀錄、可查、不會外溢。
-- ============================================================

create table if not exists public.eip_dept_supervisor (
  tenant_id     uuid not null default '00000000-0000-0000-0000-000000000001',
  department_id uuid not null references public.department(id) on delete cascade,
  user_id       uuid not null references public.app_user(id)  on delete cascade,
  note          text,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.app_user(id),
  primary key (department_id, user_id)
);

comment on table public.eip_dept_supervisor is
  '部門的額外督導（department.manager_id 之外）。管轄範圍＝manager_id ∪ 這張表，兩者都往子樹展開（0158）。';

alter table public.eip_dept_supervisor enable row level security;

-- 讀：登入者都可讀（前端要顯示「誰是督導」）；寫：只有管理者
drop policy if exists eds_read on public.eip_dept_supervisor;
create policy eds_read on public.eip_dept_supervisor
  for select to authenticated using (tenant_id = current_tenant_id());

drop policy if exists eds_admin_write on public.eip_dept_supervisor;
create policy eds_admin_write on public.eip_dept_supervisor
  for all to authenticated
  using (tenant_id = current_tenant_id() and current_role_name() = 'company_admin')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'company_admin');

-- 曾義仁 → 總經理室（定案：權限保留）
insert into public.eip_dept_supervisor (department_id, user_id, note)
select d.id, u.id, '0158：定案保留原有權限。原本靠「所屬部門＋dept_manager 角色代碼」取得，改為明確登記。'
  from public.department d, public.app_user u
 where d.name = '總經理室' and u.name = '曾義仁'
on conflict (department_id, user_id) do nothing;

-- ---------- 三支判定函式併入明確登記 ----------
create or replace function public.eip_user_can_scope_dept(p_dept uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  -- 管轄 = department.manager_id ∪ eip_dept_supervisor，各自往子樹展開。
  -- 刻意不含 current_department_id()：坐在某個部門不等於管那個部門（0157）。
  select p_dept is not null and exists (
    select 1
      from (
        select d.id from public.department d
         where d.manager_id = auth.uid() and d.tenant_id = current_tenant_id()
        union
        select s.department_id from public.eip_dept_supervisor s
         where s.user_id = auth.uid() and s.tenant_id = current_tenant_id()
      ) roots
     where public.eip_dept_in_subtree(p_dept, roots.id)
  );
$function$;

create or replace function public.eip_is_any_dept_supervisor()
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  select auth.uid() is not null
     and (coalesce(current_role_name()::text,'') = 'company_admin'
          or exists (select 1 from public.department d where d.manager_id = (select auth.uid()))
          or exists (select 1 from public.eip_dept_supervisor s where s.user_id = (select auth.uid())));
$function$;

create or replace function public.eip_is_dept_supervisor(p_dept uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  select current_role_name() = 'company_admin'
      or (p_dept is not null and (
            exists (select 1 from public.department d
                     where d.manager_id = (select auth.uid())
                       and public.eip_dept_in_subtree(p_dept, d.id))
         or exists (select 1 from public.eip_dept_supervisor s
                     where s.user_id = (select auth.uid())
                       and public.eip_dept_in_subtree(p_dept, s.department_id))));
$function$;

revoke all on function public.eip_user_can_scope_dept(uuid) from public;
grant execute on function public.eip_user_can_scope_dept(uuid) to authenticated, anon;
revoke all on function public.eip_is_any_dept_supervisor() from public, anon;
grant execute on function public.eip_is_any_dept_supervisor() to authenticated;
revoke all on function public.eip_is_dept_supervisor(uuid) from public;
grant execute on function public.eip_is_dept_supervisor(uuid) to authenticated, anon;;
