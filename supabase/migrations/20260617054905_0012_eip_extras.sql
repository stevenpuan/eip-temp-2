-- =====================================================================
-- 0012_eip_extras — 把模板的「需求實驗室(許願)」「開發紀錄」改成 EIP 原生模組
-- 掛 tenant_id、用 app_user 身分、RLS 與現有 EIP 一致(無跨表遞迴)。
-- =====================================================================

-- ---- eip_feature_request（需求實驗室 / 許願清單） ----
create table eip_feature_request (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id) on delete cascade,
  title        text not null,
  area         text,
  description  text,
  points_cost  int  not null default 1 check (points_cost >= 0),
  submitter_id uuid references app_user(id),
  status       text not null default 'open',   -- open / planned / in_progress / done / rejected
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_fr_tenant on eip_feature_request(tenant_id);
create trigger trg_fr_updated before update on eip_feature_request
  for each row execute function set_updated_at();
alter table eip_feature_request enable row level security;

create policy fr_read on eip_feature_request
  for select using (tenant_id = current_tenant_id());
create policy fr_insert on eip_feature_request
  for insert with check (tenant_id = current_tenant_id() and submitter_id = auth.uid());
create policy fr_update_admin on eip_feature_request
  for update using (tenant_id = current_tenant_id()
                    and current_role_name() in ('company_admin','dept_manager'))
  with check (tenant_id = current_tenant_id());
create policy fr_update_own on eip_feature_request
  for update using (tenant_id = current_tenant_id() and submitter_id = auth.uid())
  with check (tenant_id = current_tenant_id() and submitter_id = auth.uid());
create policy fr_delete on eip_feature_request
  for delete using (tenant_id = current_tenant_id()
                    and (current_role_name() = 'company_admin' or submitter_id = auth.uid()));

-- ---- eip_changelog（開發紀錄 / 開發歷程） ----
create table eip_changelog (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  version     text not null,
  type        text not null default 'feature',  -- feature / fix / improvement / other
  title       text not null,
  content     text,
  released_at date not null default current_date,
  created_by  uuid references app_user(id),
  created_at  timestamptz not null default now()
);
create index idx_cl_tenant on eip_changelog(tenant_id);
alter table eip_changelog enable row level security;

create policy cl_read on eip_changelog
  for select using (tenant_id = current_tenant_id());
create policy cl_write on eip_changelog
  for all using (tenant_id = current_tenant_id()
                 and current_role_name() in ('company_admin','dept_manager'))
  with check (tenant_id = current_tenant_id()
              and current_role_name() in ('company_admin','dept_manager'));;
