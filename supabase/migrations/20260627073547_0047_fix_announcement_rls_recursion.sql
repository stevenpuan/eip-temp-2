-- 修 announcement ↔ announcement_target 跨表 RLS 無限遞迴（造成公告頁 500 + 載入慢）。
-- 用 SECURITY DEFINER 函式集中可見判斷；函式 owner=postgres，內部查詢繞過 RLS，
-- 兩個讀取政策都改呼叫它，不再互相觸發對方的政策。
create or replace function public.eip_can_see_announcement(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.announcement a
    where a.id = p_id and a.tenant_id = current_tenant_id() and (
      current_role_name() = 'company_admin'
      or a.created_by = auth.uid()
      or (a.published_at is not null and (
            a.audience_type = 'all'
            or exists (
              select 1 from public.announcement_target t
              where t.announcement_id = a.id and (
                t.user_id = auth.uid()
                or public.eip_can_view_dept_record(t.department_id)
              )
            )
      ))
    )
  );
$$;
revoke execute on function public.eip_can_see_announcement(uuid) from public, anon;
grant  execute on function public.eip_can_see_announcement(uuid) to authenticated;

-- 公告讀取：改用 helper（不再直接子查 announcement_target）
drop policy if exists announcement_read on public.announcement;
create policy announcement_read on public.announcement for select
  using (tenant_id = current_tenant_id() and public.eip_can_see_announcement(id));

-- 對象表讀取：改用同一 helper（不再直接子查 announcement）
drop policy if exists ann_target_read on public.announcement_target;
create policy ann_target_read on public.announcement_target for select
  using (public.eip_can_see_announcement(announcement_id));;
