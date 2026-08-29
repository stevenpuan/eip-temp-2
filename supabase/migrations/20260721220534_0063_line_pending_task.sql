-- LINE 下任務「先確認再建立」用的暫存表（每人最多一筆待確認）
create table if not exists public.line_pending_task (
  user_id uuid primary key references public.app_user(id) on delete cascade,
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000001',
  title text not null,
  due_date date,
  priority text not null default 'normal',
  description text,
  created_at timestamptz not null default now()
);
comment on table public.line_pending_task is 'LINE 建立任務前的暫存（待使用者回覆確認）；僅 edge function/service_role 存取';
alter table public.line_pending_task enable row level security;
-- 不建立任何 policy → 一般 anon/authenticated 無法存取；edge function 以 service_role 操作（繞過 RLS）
grant all on public.line_pending_task to service_role;;
