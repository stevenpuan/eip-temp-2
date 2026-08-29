
-- 修正「新增需求」失敗：前端未帶 tenant_id/submitter_id 導致 RLS 擋下。
-- BEFORE INSERT 自動補上（submitter 強制為當前使用者，tenant 為其租戶）。
create or replace function public.eip_set_feature_request_defaults()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
begin
  new.submitter_id := auth.uid();
  new.tenant_id := current_tenant_id();
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists trg_fr_defaults on public.eip_feature_request;
create trigger trg_fr_defaults
  before insert on public.eip_feature_request
  for each row execute function public.eip_set_feature_request_defaults();
;
