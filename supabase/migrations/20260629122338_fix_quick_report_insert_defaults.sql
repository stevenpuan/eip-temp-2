
create or replace function public.eip_set_quick_report_defaults()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  new.submitter_id := auth.uid();
  new.tenant_id := current_tenant_id();
  return new;
end;
$function$;

-- 命名 trg_qr_defaults 使其在 trg_qr_set_dept / trg_qr_notify 之前執行
drop trigger if exists trg_qr_defaults on public.eip_quick_report;
create trigger trg_qr_defaults
  before insert on public.eip_quick_report
  for each row execute function public.eip_set_quick_report_defaults();
;
