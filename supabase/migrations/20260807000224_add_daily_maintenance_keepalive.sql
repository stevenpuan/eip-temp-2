-- Keep-alive RPC：讓 GitHub Actions 每天打一次，登記一次 DB 活動，
-- 防止免費版「7 天無活動」被暫停。不讀取任何資料表、無副作用。
create or replace function public.daily_maintenance()
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select jsonb_build_object('ok', true, 'ts', now());
$$;

comment on function public.daily_maintenance() is
  'Keep-alive ping target for GitHub Actions (keepalive.yml). Returns a heartbeat; no table access.';

-- anon 可執行（keepalive 用 anon key 呼叫）
grant execute on function public.daily_maintenance() to anon;;
