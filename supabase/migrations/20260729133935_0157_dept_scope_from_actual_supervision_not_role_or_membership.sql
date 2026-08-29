-- ============================================================
-- 稽核第八輪 最嚴重的權限漏洞：管轄範圍是從「角色代碼 + 所屬部門」推出來的
--
-- 實際發生在正式庫的案例：曾義仁
--   ・有 dept_manager 角色代碼
--   ・department.manager_id 沒有任何一筆指向他（他不管任何部門）
--   ・但他坐在「總經理室」，而總經理室底下有 17 個部門（等於全公司）
--
-- 兩個函式各出一半的力，合起來把他變成事實上的全公司管理者：
--
-- 1) eip_is_any_dept_supervisor()（部門級報表的閘門）
--      current_role_name() in ('company_admin','dept_manager')  ← 只看角色代碼
--    → 他能讀部門例行彙總、依部門績效，還能用催填（實測全部可用）
--
-- 2) eip_user_can_scope_dept()（管轄範圍）
--      with roots as (select current_department_id() ... union select 他管的部門)
--                            ^^^^^^^^^^^^^^^^^^^^^^ 所屬部門也算管轄
--    → 配合 11 條政策裡的 `dept_manager AND eip_user_can_scope_dept(dept)`，
--      他取得總經理室子樹 17 個部門的 task／meeting／project／eip_document／
--      recurring_rule／eip_quick_report 的 UPDATE 與 DELETE 權。
--
-- 這跟第四輪就定下的原則直接矛盾：「異常缺失的開立權綁『實際部門主管』
-- （eip_is_dept_supervisor）而不是 role 代碼」。當時只把 eip_is_dept_supervisor
-- 改對了，這兩支漏掉。
--
-- 逐人做集合差確認過改動範圍：
--   ・曾義仁：失去 17 個部門（正確，他不管任何部門）
--   ・其餘 8 位 dept_manager 與 4 位 company_admin：0 變動
--     （每一位的「實際管轄」都 ⊇「所屬部門」）
--   ・12 位 member：帳面上失去自己的部門，但 11 條政策全部有
--     `dept_manager` 角色守門，他們本來就到不了這條路 → 實際 0 變動
--   ・成員看部門範圍資料走的是 eip_can_view_dept_record 的第二條分支
--     eip_dept_in_subtree(自己的部門, 目標部門)，不受這次改動影響
-- ============================================================

-- 1) 報表閘門改成看事實，不看角色代碼
create or replace function public.eip_is_any_dept_supervisor()
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  select auth.uid() is not null
     and (coalesce(current_role_name()::text,'') = 'company_admin'
          -- 只認「真的有部門把他設為 manager_id」，不認 dept_manager 角色代碼。
          -- 有角色但不管任何部門的帳號（例：待釐清的掛名主管）不該看到部門級報表。
          or exists (select 1 from public.department d
                      where d.manager_id = (select auth.uid())));
$function$;

revoke all on function public.eip_is_any_dept_supervisor() from public, anon;
grant execute on function public.eip_is_any_dept_supervisor() to authenticated;

-- 2) 管轄範圍只從「實際管轄的部門」往下展開，不含「所屬部門」
create or replace function public.eip_user_can_scope_dept(p_dept uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  -- 刻意不再 union current_department_id()：坐在某個部門不等於管那個部門。
  -- 「成員看得到自己部門的資料」是可見範圍的事，由 eip_can_view_dept_record
  -- 的 eip_dept_in_subtree(自己的部門, 目標部門) 那條分支負責，不走這裡。
  select p_dept is not null and exists (
    select 1 from public.department m
     where m.manager_id = auth.uid()
       and m.tenant_id = current_tenant_id()
       and public.eip_dept_in_subtree(p_dept, m.id)
  );
$function$;

revoke all on function public.eip_user_can_scope_dept(uuid) from public;
grant execute on function public.eip_user_can_scope_dept(uuid) to authenticated, anon;
-- anon 需要 execute 是因為政策 TO public 會呼叫它（0155 的理由），未登入回 false

comment on function public.eip_user_can_scope_dept(uuid) is
  '管轄範圍：只認 department.manager_id 指向自己的部門及其子樹。所屬部門不算管轄（0157）。';
comment on function public.eip_is_any_dept_supervisor() is
  '是否為任何部門的實際主管（或管理者）。刻意不認 dept_manager 角色代碼（0157）。';;
