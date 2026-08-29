-- 0085: 個人例行工作範本（A）
-- 設計原則：範本「不產生 task」，只在工作日誌 seed 時即時展開 —— 人員停用即自動停止展開，天然不留呆滯資料。

create table if not exists public.personal_routine (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000001',
  user_id uuid not null references public.app_user(id) on delete cascade,
  title text not null,
  time_slot text not null default 'morning' check (time_slot in ('morning','afternoon','allday')),
  freq text not null default 'daily' check (freq in ('daily','weekdays','weekly','monthly')),
  weekdays int[],
  days_of_month int[],
  use_month_end boolean not null default false,
  require_content boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.personal_routine is
  '個人例行工作範本：每人自訂每日固定工作，依時段與週期於工作日誌自動帶入；不產生任務紀錄。';

create index if not exists idx_personal_routine_user on public.personal_routine(user_id, is_active, sort_order);

-- 預設值：tenant_id / user_id 自動補（避免前端漏帶造成 42501）
create or replace function public.eip_fill_personal_routine_defaults()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.user_id is null then new.user_id := auth.uid(); end if;
  if new.tenant_id is null then
    select coalesce(tenant_id,'00000000-0000-0000-0000-000000000001')
      into new.tenant_id from public.app_user where id = new.user_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_personal_routine_defaults on public.personal_routine;
create trigger trg_personal_routine_defaults before insert or update on public.personal_routine
for each row execute function public.eip_fill_personal_routine_defaults();

-- 週期判斷
create or replace function public.eip_personal_routine_due_on(r public.personal_routine, d date)
returns boolean language sql immutable set search_path to 'public' as $$
  select case r.freq
    when 'daily'    then true
    when 'weekdays' then extract(isodow from d)::int between 1 and 5
    when 'weekly'   then (r.weekdays is not null and extract(isodow from d)::int = any(r.weekdays))
    when 'monthly'  then (
        (r.use_month_end and d = (date_trunc('month',d) + interval '1 month - 1 day')::date)
        or (r.days_of_month is not null and extract(day from d)::int = any(r.days_of_month)))
    else false
  end;
$$;

alter table public.personal_routine enable row level security;

drop policy if exists pr_read on public.personal_routine;
create policy pr_read on public.personal_routine for select to authenticated
using (
  user_id = (select auth.uid())                                   -- 建立者短路，避免 INSERT...RETURNING 42501
  or current_role_name() = 'company_admin'
  or public.eip_is_dept_supervisor((select department_id from public.app_user u where u.id = personal_routine.user_id))
);

drop policy if exists pr_write on public.personal_routine;
create policy pr_write on public.personal_routine for insert to authenticated
with check (user_id = (select auth.uid()) or current_role_name() = 'company_admin');

drop policy if exists pr_update on public.personal_routine;
create policy pr_update on public.personal_routine for update to authenticated
using (user_id = (select auth.uid()) or current_role_name() = 'company_admin')
with check (user_id = (select auth.uid()) or current_role_name() = 'company_admin');

drop policy if exists pr_delete on public.personal_routine;
create policy pr_delete on public.personal_routine for delete to authenticated
using (user_id = (select auth.uid()) or current_role_name() = 'company_admin');

grant select, insert, update, delete on public.personal_routine to authenticated;
revoke all on public.personal_routine from anon;
;
