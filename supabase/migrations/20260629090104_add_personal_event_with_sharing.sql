
-- 個人行程：嚴格私人，可分享給指定的人（被分享者唯讀）

create table if not exists public.personal_event (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  user_id     uuid not null references public.app_user(id) on delete cascade,
  title       text not null,
  start_date  date not null,
  end_date    date,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_personal_event_user on public.personal_event(user_id);
create index if not exists idx_personal_event_dates on public.personal_event(start_date, end_date);

create table if not exists public.personal_event_share (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references public.personal_event(id) on delete cascade,
  shared_with_user_id uuid not null references public.app_user(id) on delete cascade,
  created_at          timestamptz not null default now(),
  unique (event_id, shared_with_user_id)
);
create index if not exists idx_pes_shared_with on public.personal_event_share(shared_with_user_id);

-- 擁有權檢查（SECURITY DEFINER：避免分享表政策回查父表造成遞迴）
create or replace function public.eip_owns_personal_event(p_event_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  select exists (select 1 from public.personal_event e
                 where e.id = p_event_id and e.user_id = auth.uid());
$function$;

-- 建立時自動填 owner / tenant
create or replace function public.eip_set_personal_event_defaults()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  new.user_id := auth.uid();
  new.tenant_id := current_tenant_id();
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists trg_personal_event_defaults on public.personal_event;
create trigger trg_personal_event_defaults
  before insert on public.personal_event
  for each row execute function public.eip_set_personal_event_defaults();

drop trigger if exists trg_personal_event_updated on public.personal_event;
create trigger trg_personal_event_updated
  before update on public.personal_event
  for each row execute function public.set_updated_at();

-- RLS
alter table public.personal_event enable row level security;
alter table public.personal_event_share enable row level security;

-- 行程本體：本人(擁有者) 或 被分享者 可讀；只有本人可改/刪
drop policy if exists personal_event_select on public.personal_event;
create policy personal_event_select on public.personal_event
  for select using (
    tenant_id = current_tenant_id() and (
      user_id = auth.uid()
      or exists (select 1 from public.personal_event_share s
                 where s.event_id = personal_event.id and s.shared_with_user_id = auth.uid())
    )
  );

drop policy if exists personal_event_insert on public.personal_event;
create policy personal_event_insert on public.personal_event
  for insert with check (user_id = auth.uid() and tenant_id = current_tenant_id());

drop policy if exists personal_event_update on public.personal_event;
create policy personal_event_update on public.personal_event
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists personal_event_delete on public.personal_event;
create policy personal_event_delete on public.personal_event
  for delete using (user_id = auth.uid());

-- 分享表：被分享者可看自己那筆；事件擁有者可管理（增刪）分享
drop policy if exists pes_select on public.personal_event_share;
create policy pes_select on public.personal_event_share
  for select using (
    shared_with_user_id = auth.uid() or public.eip_owns_personal_event(event_id)
  );

drop policy if exists pes_write on public.personal_event_share;
create policy pes_write on public.personal_event_share
  for all using (public.eip_owns_personal_event(event_id))
  with check (public.eip_owns_personal_event(event_id));

grant select, insert, update, delete on public.personal_event to authenticated;
grant select, insert, delete on public.personal_event_share to authenticated;
;
