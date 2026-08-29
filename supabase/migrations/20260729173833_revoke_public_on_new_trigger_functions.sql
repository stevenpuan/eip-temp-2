-- 三支新 trigger 函式建立時被 Supabase 的 default privileges 授予了 PUBLIC/anon/authenticated EXECUTE。
-- 觸發函式不該能被 RPC 直接呼叫，依既有規則一律收回，只留 postgres / service_role。
revoke all on function public.eip_notify_worklog_reviewed()          from public, anon, authenticated;
revoke all on function public.eip_notify_task_collaborator_added()   from public, anon, authenticated;
revoke all on function public.eip_fill_work_log_department()         from public, anon, authenticated;

grant execute on function public.eip_notify_worklog_reviewed()        to postgres, service_role;
grant execute on function public.eip_notify_task_collaborator_added() to postgres, service_role;
grant execute on function public.eip_fill_work_log_department()       to postgres, service_role;
;
