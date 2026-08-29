-- 通用稽核觸發器：記錄敏感表的新增/修改/刪除到 audit_logs
create or replace function public.eip_audit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id text; v_before jsonb; v_after jsonb;
begin
  if tg_op = 'DELETE' then
    v_id := to_jsonb(old)->>'id'; v_before := to_jsonb(old); v_after := null;
  elsif tg_op = 'INSERT' then
    v_id := to_jsonb(new)->>'id'; v_before := null; v_after := to_jsonb(new);
  else
    v_id := to_jsonb(new)->>'id'; v_before := to_jsonb(old); v_after := to_jsonb(new);
  end if;
  insert into public.audit_logs(user_id, action, target_table, target_id, before_data, after_data)
  values (auth.uid(), lower(tg_op), tg_table_name, v_id, v_before, v_after);
  return coalesce(new, old);
end;
$function$;

do $$
declare t text;
begin
  foreach t in array array['app_user','user_roles','role_module_permissions','department','notification_setting'] loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$s', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.eip_audit()', t);
  end loop;
end$$;;
