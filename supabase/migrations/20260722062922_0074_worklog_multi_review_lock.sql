-- 批示與鎖定分離：work_log 加獨立鎖定欄位
alter table public.work_log add column if not exists locked boolean not null default false;
alter table public.work_log add column if not exists locked_by uuid references public.app_user(id);
alter table public.work_log add column if not exists locked_at timestamptz;

-- 多人批示：一份日誌多筆批示（經理 / 單位主管）
create table if not exists public.work_log_review (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000001',
  work_log_id uuid not null references public.work_log(id) on delete cascade,
  reviewer_id uuid not null default auth.uid() references public.app_user(id) on delete cascade,
  reviewer_role text not null default 'unit' check (reviewer_role in ('manager','unit')),
  comment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_wlr_worklog on public.work_log_review(work_log_id, created_at);

alter table public.work_log_review enable row level security;
-- 讀：日誌本人或其主管(含 company_admin / 部門主管子樹)
drop policy if exists wlr_read on public.work_log_review;
create policy wlr_read on public.work_log_review for select to authenticated
  using (exists (select 1 from public.work_log wl where wl.id = work_log_id
     and (wl.user_id = (select auth.uid()) or public.eip_is_dept_supervisor(wl.department_id))));
-- 新增批示：主管身分、且日誌未鎖定
drop policy if exists wlr_insert on public.work_log_review;
create policy wlr_insert on public.work_log_review for insert to authenticated
  with check (reviewer_id = (select auth.uid()) and exists (
     select 1 from public.work_log wl where wl.id = work_log_id
       and public.eip_is_dept_supervisor(wl.department_id) and wl.locked = false));
-- 修改自己的批示：未鎖定時
drop policy if exists wlr_update on public.work_log_review;
create policy wlr_update on public.work_log_review for update to authenticated
  using (reviewer_id = (select auth.uid()) and exists (
     select 1 from public.work_log wl where wl.id = work_log_id and wl.locked = false))
  with check (reviewer_id = (select auth.uid()));
-- 刪除自己的批示（或 company_admin）：未鎖定時
drop policy if exists wlr_delete on public.work_log_review;
create policy wlr_delete on public.work_log_review for delete to authenticated
  using ((reviewer_id = (select auth.uid()) or current_role_name() = 'company_admin')
     and exists (select 1 from public.work_log wl where wl.id = work_log_id and wl.locked = false));
grant select, insert, update, delete on public.work_log_review to authenticated;;
