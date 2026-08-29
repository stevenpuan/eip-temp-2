
-- 補 announcement 的 INSERT：company_admin 可發任何受眾；dept_manager 限部門。
-- 並加 defaults trigger 自動填 tenant_id / created_by。
do $$
declare r record;
begin
  for r in select polname from pg_policy where polrelid='public.announcement'::regclass and polcmd='a' loop
    execute format('drop policy %I on public.announcement', r.polname);
  end loop;
end $$;

create policy announcement_insert on public.announcement
  for insert
  with check (
    tenant_id = current_tenant_id()
    and created_by = auth.uid()
    and (
      current_role_name() = 'company_admin'
      or (current_role_name() = 'dept_manager' and audience_type = 'department')
    )
  );

create or replace function public.eip_fill_announcement_defaults() returns trigger
language plpgsql security definer set search_path to 'public' as $f$
begin
  new.tenant_id  := coalesce(current_tenant_id(), new.tenant_id);
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end$f$;
drop trigger if exists trg_announcement_defaults on public.announcement;
create trigger trg_announcement_defaults before insert on public.announcement
  for each row execute function public.eip_fill_announcement_defaults();
;
