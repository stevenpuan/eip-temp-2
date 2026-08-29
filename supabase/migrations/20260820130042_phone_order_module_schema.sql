
-- ============ 電話訂單紀錄模組：資料表 ============
-- 接單人員旗標（Q5：依實際接單人員名單）
alter table public.app_user add column if not exists is_phone_order_staff boolean not null default false;

-- 每日紀錄（一人一天一筆）
create table if not exists public.phone_order_daily (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000001',
  user_id uuid not null references public.app_user(id),
  log_date date not null,
  order_count int not null default 0 check (order_count >= 0),   -- 電話接單數量
  error_count int not null default 0 check (error_count >= 0),   -- 前日訂單失誤數量
  error_reason text,   -- 失誤原因（Q6 需求者加填）
  remark text,         -- 備註
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, log_date)
);
create index if not exists idx_phone_order_daily_month on public.phone_order_daily(tenant_id, log_date);
create index if not exists idx_phone_order_daily_user on public.phone_order_daily(user_id);

-- 每人每月：上班天數（Q2 改為員工自己填）
create table if not exists public.phone_order_month (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000001',
  user_id uuid not null references public.app_user(id),
  ym date not null,   -- 當月第一天代表年月
  work_days int check (work_days >= 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, ym)
);

-- 月鎖定（Q4：人資一鍵上鎖/解鎖當月，租戶層級、不限時間）
create table if not exists public.phone_order_lock (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000001',
  ym date not null,
  locked boolean not null default true,
  locked_by uuid,
  locked_at timestamptz not null default now(),
  unique (tenant_id, ym)
);

-- 共用觸發器：updated_at
drop trigger if exists trg_pod_updated on public.phone_order_daily;
create trigger trg_pod_updated before update on public.phone_order_daily
  for each row execute function public.set_updated_at();
drop trigger if exists trg_pom_updated on public.phone_order_month;
create trigger trg_pom_updated before update on public.phone_order_month
  for each row execute function public.set_updated_at();

-- 月是否已鎖定
create or replace function public.eip_phone_order_month_locked(p_day date)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.phone_order_lock l
     where l.tenant_id = current_tenant_id()
       and l.ym = date_trunc('month', p_day)::date
       and l.locked
  );
$$;
;
