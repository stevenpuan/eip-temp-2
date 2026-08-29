
-- 放寬 announcement_target 寫入：主管在自己建立的公告上可指定任一部門/人員
-- （原本限制 dept_manager 只能指定管轄子樹；既然主管已可發全公司，指定部門不應更嚴）
drop policy if exists ann_target_write on public.announcement_target;
create policy ann_target_write on public.announcement_target
  for all
  using (
    exists (
      select 1 from public.announcement a
      where a.id = announcement_target.announcement_id
        and ( current_role_name() = 'company_admin'::user_role
              or ( current_role_name() = 'dept_manager'::user_role
                   and a.created_by = (select auth.uid()) ) )
    )
  )
  with check (
    exists (
      select 1 from public.announcement a
      where a.id = announcement_target.announcement_id
        and ( current_role_name() = 'company_admin'::user_role
              or ( current_role_name() = 'dept_manager'::user_role
                   and a.created_by = (select auth.uid()) ) )
    )
  );
;
