create or replace function public.eip_run_recurring()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.eip_run_recurring((now() at time zone 'Asia/Taipei')::date);
end;
$$;

revoke execute on function public.eip_run_recurring() from public, anon, authenticated;