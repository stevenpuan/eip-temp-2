-- 跨部門「唯讀」資料分享（不含工作日誌）
-- 設計：新增一張授權表 + 一個判定函式 eip_can_view_dept_shared()，
-- 只加進各模組的「讀取」政策（permissive，OR 疊加），完全不動既有政策，
-- 故只加讀、絕不加寫，也不觸及 work_log/attachment/review（它們只認 eip_is_dept_supervisor）。

-- 1) 授權表
create table if not exists public.eip_dept_view_grant (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id(),
  user_id uuid not null references public.app_user(id) on delete cascade,      -- 被授權人
  department_id uuid references public.department(id) on delete cascade,        -- NULL = 全部門
  include_subtree boolean not null default true,                                -- 選「部」時是否含底下「課」
  is_active boolean not null default true,
  note text,
  created_by uuid references public.app_user(id),
  created_at timestamptz not null default now()
);

-- 同一人對同一部門只一筆；全部門(NULL)也只一筆
create unique index if not exists eip_dept_view_grant_uk_dept
  on public.eip_dept_view_grant(tenant_id, user_id, department_id) where department_id is not null;
create unique index if not exists eip_dept_view_grant_uk_all
  on public.eip_dept_view_grant(tenant_id, user_id) where department_id is null;
-- RLS 熱路徑索引
create index if not exists eip_dept_view_grant_user_idx
  on public.eip_dept_view_grant(user_id, tenant_id) where is_active;
create index if not exists eip_dept_view_grant_dept_idx
  on public.eip_dept_view_grant(department_id);
create index if not exists eip_dept_view_grant_created_by_idx
  on public.eip_dept_view_grant(created_by);

-- 2) 判定函式：目前使用者是否被授權「唯讀」看某部門
create or replace function public.eip_can_view_dept_shared(p_dept uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  select p_dept is not null
     and (select auth.uid()) is not null
     and exists (
       select 1 from public.eip_dept_view_grant g
        where g.user_id = (select auth.uid())
          and g.tenant_id = current_tenant_id()
          and g.is_active
          and (
                g.department_id is null                                              -- 全部門
             or (g.include_subtree and public.eip_dept_in_subtree(p_dept, g.department_id))
             or (not g.include_subtree and p_dept = g.department_id)
          )
     );
$function$;

revoke all on function public.eip_can_view_dept_shared(uuid) from public;
grant execute on function public.eip_can_view_dept_shared(uuid) to anon, authenticated, service_role;

-- 3) 授權表自身 RLS：本人可見自己的授權；權限管理者可讀寫
alter table public.eip_dept_view_grant enable row level security;

create policy dept_view_grant_read on public.eip_dept_view_grant
  for select to authenticated
  using (
    tenant_id = current_tenant_id()
    and (
         user_id = (select auth.uid())
      or public.is_admin((select auth.uid()))
      or public.eip_has_perm('role_permissions','view')
    )
  );

create policy dept_view_grant_write on public.eip_dept_view_grant
  for all to authenticated
  using (
    tenant_id = current_tenant_id()
    and (public.is_admin((select auth.uid())) or public.eip_has_perm('role_permissions','edit'))
  )
  with check (
    tenant_id = current_tenant_id()
    and (public.is_admin((select auth.uid())) or public.eip_has_perm('role_permissions','edit'))
  );

-- 4) 稽核（比照 0059）
create trigger trg_audit_dept_view_grant
  after insert or update or delete on public.eip_dept_view_grant
  for each row execute function public.eip_audit();

-- 5) 各模組加「唯讀」政策（permissive，只加讀、與既有政策 OR 疊加）
--    比照各表既有「部門可視」分支，唯讀範圍＝該部門主管看得到的量；work_log 系列刻意不加。

create policy task_shared_read on public.task
  for select to authenticated
  using (
    tenant_id = current_tenant_id()
    and deleted_at is null
    and visibility_scope = 'department'
    and department_id is not null
    and public.eip_can_view_dept_shared(department_id)
  );

create policy project_shared_read on public.project
  for select to authenticated
  using (
    tenant_id = current_tenant_id()
    and visibility_scope = 'department'
    and department_id is not null
    and public.eip_can_view_dept_shared(department_id)
  );

create policy meeting_shared_read on public.meeting
  for select to authenticated
  using (
    tenant_id = current_tenant_id()
    and visibility_scope = 'department'
    and department_id is not null
    and public.eip_can_view_dept_shared(department_id)
  );

create policy recurring_shared_read on public.recurring_rule
  for select to authenticated
  using (
    tenant_id = current_tenant_id()
    and department_id is not null
    and public.eip_can_view_dept_shared(department_id)
  );

create policy qr_shared_read on public.eip_quick_report
  for select to authenticated
  using (
    tenant_id = current_tenant_id()
    and deleted_at is null
    and department_id is not null
    and public.eip_can_view_dept_shared(department_id)
  );

create policy document_shared_read on public.eip_document
  for select to authenticated
  using (
    tenant_id = current_tenant_id()
    and deleted_at is null
    and department_id is not null
    and public.eip_can_view_dept_shared(department_id)
  );

create policy docver_shared_read on public.eip_document_version
  for select to authenticated
  using (
    tenant_id = current_tenant_id()
    and exists (
      select 1 from public.eip_document d
       where d.id = eip_document_version.document_id
         and d.deleted_at is null
         and d.department_id is not null
         and public.eip_can_view_dept_shared(d.department_id)
    )
  );

create policy docfolder_shared_read on public.eip_doc_folder
  for select to authenticated
  using (
    tenant_id = current_tenant_id()
    and department_id is not null
    and public.eip_can_view_dept_shared(department_id)
  );
;
