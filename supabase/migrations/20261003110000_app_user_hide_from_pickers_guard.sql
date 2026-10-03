-- 只有系統設計師（is_admin）或後端（無登入身分，如 SQL／排程）能改 hide_from_pickers。
-- 實測漏洞（2026-10-03）：一般成員可經 API 把自己藏起來、管理者可把系統帳號「放出來」。
-- 註：此檔於正式庫以 execute_sql 套用（apply_migration 逾時），內容相同。
create or replace function public.eip_guard_hide_from_pickers()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    if new.hide_from_pickers and auth.uid() is not null and not public.is_admin(auth.uid()) then
      new.hide_from_pickers := false;
    end if;
  elsif new.hide_from_pickers is distinct from old.hide_from_pickers
     and auth.uid() is not null
     and not public.is_admin(auth.uid()) then
    new.hide_from_pickers := old.hide_from_pickers;
  end if;
  return new;
end; $$;
revoke all on function public.eip_guard_hide_from_pickers() from public, anon, authenticated;
drop trigger if exists trg_guard_hide_from_pickers on public.app_user;
create trigger trg_guard_hide_from_pickers before insert or update on public.app_user
  for each row execute function public.eip_guard_hide_from_pickers();
