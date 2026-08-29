-- C11 假別：假別表（可增刪）＋請假加假別欄位＋通知訊息帶假別
create table if not exists public.leave_type (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000001',
  code text not null,
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
comment on table public.leave_type is '請假假別（可由管理者增刪）';

alter table public.leave_type enable row level security;
drop policy if exists leave_type_read on public.leave_type;
create policy leave_type_read on public.leave_type for select to authenticated
  using (tenant_id = current_tenant_id());
drop policy if exists leave_type_write on public.leave_type;
create policy leave_type_write on public.leave_type for all to authenticated
  using ((select public.is_admin(auth.uid()))) with check ((select public.is_admin(auth.uid())));
grant select, insert, update, delete on public.leave_type to authenticated;
grant all on public.leave_type to service_role;

insert into public.leave_type (code, name, sort_order)
select v.code, v.name, v.ord from (values
  ('personal','事假',1),('sick','病假',2),('annual','特休',3),('menstrual','生理假',4),
  ('marriage','婚假',5),('bereavement','喪假',6),('official','公假',7),
  ('maternity','產假',8),('paternity','陪產假',9),('other','其他',10)
) as v(code,name,ord)
where not exists (select 1 from public.leave_type lt where lt.tenant_id='00000000-0000-0000-0000-000000000001' and lt.code=v.code);

alter table public.eip_quick_report add column if not exists leave_type text;

-- 通知訊息：請假時帶上假別名稱
create or replace function public.eip_notify_quick_report()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare sname text; ltname text;
begin
  select name into sname from public.app_user where id = new.submitter_id;
  if new.type = 'leave' and new.leave_type is not null then
    select name into ltname from public.leave_type where code = new.leave_type and tenant_id = new.tenant_id;
  end if;
  perform public.eip_emit_notification(
    'quick_report_submitted', new.department_id, new.submitter_id, new.submitter_id,
    'quick_report'::notification_entity, new.id, 'quick_report'::notification_type,
    (case new.type when 'late' then '【遲到回報】' when 'leave' then '【請假回報】' else '【事件回報】' end)
      || coalesce(sname,'')
      || case when ltname is not null then '（'||ltname||'）' else '' end
      || ' ' || coalesce(new.detail,''));
  return new;
end;
$function$;;
