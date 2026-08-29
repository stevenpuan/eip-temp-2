-- =====================================================================
-- 0020 文件中心(支柱①):資料夾 + 文件 + 版本歷程 + 權限
-- RLS 走 current_tenant_id/current_role_name,無跨表遞迴。
-- =====================================================================

-- 1) 資料夾(可巢狀)
create table eip_doc_folder (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenant(id) on delete cascade,
  name       text not null,
  parent_id  uuid references eip_doc_folder(id) on delete cascade,
  sort_order int not null default 0,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now()
);
create index idx_docfolder_tenant on eip_doc_folder(tenant_id);
alter table eip_doc_folder enable row level security;
create policy docfolder_read on eip_doc_folder
  for select using (tenant_id = current_tenant_id());
create policy docfolder_write on eip_doc_folder
  for all using (tenant_id = current_tenant_id() and current_role_name() in ('company_admin','dept_manager'))
  with check (tenant_id = current_tenant_id() and current_role_name() in ('company_admin','dept_manager'));

-- 2) 文件
create table eip_document (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant(id) on delete cascade,
  folder_id       uuid references eip_doc_folder(id) on delete set null,
  title           text not null,
  doc_type        text not null default 'general',  -- sop/policy/form/guide/general
  status          text not null default 'draft',     -- draft/published/archived
  department_id   uuid references department(id) on delete set null,
  owner_id        uuid references app_user(id),
  current_version int not null default 1,
  summary         text,
  created_by      uuid references app_user(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_document_tenant on eip_document(tenant_id);
create index idx_document_folder on eip_document(folder_id);
create trigger trg_document_updated before update on eip_document
  for each row execute function set_updated_at();
alter table eip_document enable row level security;
create policy document_read on eip_document
  for select using (
    tenant_id = current_tenant_id() and (
      status = 'published'
      or created_by = auth.uid()
      or owner_id = auth.uid()
      or current_role_name() in ('company_admin','dept_manager')
    )
  );
create policy document_insert on eip_document
  for insert with check (
    tenant_id = current_tenant_id()
    and current_role_name() in ('company_admin','dept_manager','member')
  );
create policy document_update on eip_document
  for update using (
    tenant_id = current_tenant_id() and (
      current_role_name() in ('company_admin','dept_manager')
      or owner_id = auth.uid() or created_by = auth.uid()
    )
  )
  with check (tenant_id = current_tenant_id());
create policy document_delete on eip_document
  for delete using (
    tenant_id = current_tenant_id() and (
      current_role_name() = 'company_admin' or owner_id = auth.uid()
    )
  );

-- 3) 版本歷程
create table eip_document_version (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  document_id uuid not null references eip_document(id) on delete cascade,
  version_no  int not null,
  content     text,       -- 富文本 HTML
  file_url    text,       -- Supabase Storage(選配)
  file_name   text,
  note        text,       -- 版本說明
  created_by  uuid references app_user(id),
  created_at  timestamptz not null default now()
);
create index idx_docver_document on eip_document_version(document_id);
alter table eip_document_version enable row level security;
create policy docver_read on eip_document_version
  for select using (tenant_id = current_tenant_id());
create policy docver_insert on eip_document_version
  for insert with check (
    tenant_id = current_tenant_id() and (
      current_role_name() in ('company_admin','dept_manager')
      or exists (select 1 from eip_document d
                 where d.id = document_id
                   and (d.owner_id = auth.uid() or d.created_by = auth.uid()))
    )
  );

-- 4) 權限註冊(eip_documents 模組)
insert into role_module_permissions (role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select r.id, 'eip_documents',
  true,                                                       -- view 全員
  r.code in ('admin','manager','dept_manager','member'),      -- create
  r.code in ('admin','manager','dept_manager','member'),      -- edit
  r.code in ('admin','manager'),                              -- delete
  r.code in ('admin','manager','dept_manager')                -- export
from roles r
where not exists (select 1 from role_module_permissions p where p.role_id=r.id and p.module_key='eip_documents');

-- 5) 選單(EIP 平台分組)
insert into menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select 'eip_documents', (select id from menus where menu_key='eip_group'),
       '文件中心', 'FileText', '/dashboard/eip/documents', 'eip_documents', 108, true
where not exists (select 1 from menus where menu_key='eip_documents');

-- 6) 範例資料夾
insert into eip_doc_folder (tenant_id, name, sort_order)
select '00000000-0000-0000-0000-000000000001', v.name, v.so
from (values ('標準作業程序(SOP)',1),('公司制度規章',2),('表單範本',3)) as v(name, so)
where not exists (select 1 from eip_doc_folder where tenant_id='00000000-0000-0000-0000-000000000001');;
