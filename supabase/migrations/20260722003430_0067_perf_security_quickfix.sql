-- P1: 補外鍵覆蓋索引
create index if not exists ix_line_pending_task_owner on public.line_pending_task(owner_id);
create index if not exists ix_line_pending_task_dept  on public.line_pending_task(department_id);
create index if not exists ix_work_log_reviewed_by    on public.work_log(reviewed_by);

-- P2: leave_type_write RLS initplan（auth.uid() 包成 select，只求值一次）
drop policy if exists leave_type_write on public.leave_type;
create policy leave_type_write on public.leave_type for all to authenticated
  using ((select is_admin((select auth.uid()))))
  with check ((select is_admin((select auth.uid()))));

-- S1: 收回 eip_owns_personal_event 對 PUBLIC/anon 的 EXECUTE（RLS 需要，保留 authenticated）
revoke execute on function public.eip_owns_personal_event(uuid) from public;
revoke execute on function public.eip_owns_personal_event(uuid) from anon;

-- S4: line_pending_task 僅供 edge function(service_role) 使用
revoke all on public.line_pending_task from anon;
revoke all on public.line_pending_task from authenticated;;
