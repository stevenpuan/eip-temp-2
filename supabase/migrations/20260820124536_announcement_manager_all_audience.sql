
-- 放寬公告 INSERT：部門主管可發任何對象（全公司 all / 指定人員 users / 指定部門 department）
-- 原本只允許 dept_manager 發 department，導致主管選「指定人員」「全公司」會被 RLS 擋。
drop policy if exists announcement_insert on public.announcement;
create policy announcement_insert on public.announcement
  for insert
  with check (
    tenant_id = current_tenant_id()
    and created_by = (select auth.uid())
    and (
      current_role_name() = 'company_admin'::user_role
      or current_role_name() = 'dept_manager'::user_role
    )
  );
;
