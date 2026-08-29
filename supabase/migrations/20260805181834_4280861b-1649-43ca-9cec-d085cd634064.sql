do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname in (
        'current_role_name','current_tenant_id','eip_can_edit_project','eip_can_manage_task',
        'eip_can_see_announcement','eip_can_see_meeting','eip_can_see_project','eip_can_see_task',
        'eip_can_view_dept_record','eip_can_view_dept_shared','eip_is_dept_supervisor',
        'eip_is_task_collaborator','eip_owns_personal_event','eip_user_can_scope_dept'
      )
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;

revoke all on table public.line_pending_task from anon, authenticated;
grant all on table public.line_pending_task to service_role;
comment on table public.line_pending_task is '內部 LINE 推播佇列：僅由 SECURITY DEFINER 函式與 service_role 存取；RLS 無政策＝拒絕所有一般使用者存取（刻意設計）。';
;
