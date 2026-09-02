-- 常態工作「立即產生/檢查」的範圍收斂（2026-09-02）
--
-- 問題：eip_run_recurring 只檢查角色（company_admin / dept_manager），不檢查部門，
--       迴圈跑的是全租戶 recurring_rule。任一部門主管在常態工作頁按一次「立即產生/檢查」，
--       就會替【所有部門】提前產生任務並發通知。
--
-- 修法：角色閘門不動（權限＝角色 × 部門範圍是既有設計，指派部門督導時也會一併給角色）；
--       非管理者只跑「自己管轄部門的規則」∪「自己是負責人的規則」。
--       管轄範圍用 eip_user_can_scope_dept —— 它 = department.manager_id ∪ eip_dept_supervisor
--       各自往子樹展開，所以【部門督導視同主管】這個設計方向不受影響。
--       實查當時 38 條啟用規則中有 9 條 department_id 為 null，靠 owner_id 那條路涵蓋，
--       規則負責人自己仍能手動觸發，不必等隔天 08:00 的排程。
--
-- ⚠️ pg_cron 呼叫時 auth.uid() 為 null → v_all 為 true，每日全公司產生的行為完全不變。

create or replace function public.eip_run_recurring(p_date date DEFAULT CURRENT_DATE)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r recurring_rule; d date; horizon int; due date; ndays int; t record; sid uuid; v_task_id uuid;
  v_uid uuid := auth.uid();
  v_all boolean;
begin
  -- 角色閘門不變（權限＝角色 × 部門範圍，兩層都要，見組織架構的「部門督導」設計）
  if v_uid is not null
     and coalesce(current_role_name()::text, '') not in ('company_admin','dept_manager') then
    raise exception '權限不足：僅管理者或部門主管可手動產生常態任務';
  end if;

  -- v_all＝這次要不要跑全公司的規則
  --   排程（pg_cron）呼叫時 auth.uid() 是 null → 全公司照跑，「系統自動依排程生成」的需求不變
  --   管理者／系統設計師（current_role_name()='company_admin'）→ 全公司
  --   部門主管／部門督導 → 只跑自己管轄的部門（eip_user_can_scope_dept 已含督導子樹）＋ 自己負責的規則
  v_all := v_uid is null or coalesce(current_role_name()::text, '') = 'company_admin';

  for r in
    select rr.* from recurring_rule rr
    join app_user au on au.id = rr.owner_id
    where rr.is_active and au.status = 'active'      -- 防呆：負責人已停用者不再產生任務
      and (
        v_all
        or rr.owner_id = v_uid                       -- 自己負責的規則（含沒有設部門的那些）
        or (rr.department_id is not null and public.eip_user_can_scope_dept(rr.department_id))
      )
  loop
    horizon := coalesce((select max(x) from unnest(r.advance_days) x), 0);
    select id into sid from task_status
      where tenant_id = r.tenant_id and is_default and not is_done_state
      order by sort_order limit 1;

    d := p_date;
    while d <= p_date + horizon loop
      if eip_rule_due_on(r, d) then
        if not exists (select 1 from task where recurring_rule_id = r.id and occurrence_date = d) then
          insert into task (tenant_id, title, description, owner_id, department_id, priority,
                            status_id, progress, due_date, created_by, recurring_rule_id, occurrence_date)
          values (r.tenant_id, r.title, r.description, r.owner_id, r.department_id, r.priority,
                  sid, 0, d, r.owner_id, r.id, d)
          returning id into v_task_id;

          -- 對接人員（可複選）：每一位都加為協作者。排除等於負責人的情況。
          insert into task_collaborator (task_id, user_id)
          select v_task_id, cu
            from unnest(coalesce(r.counterpart_user_ids, '{}'::uuid[])) cu
           where cu is not null and cu <> r.owner_id
          on conflict (task_id, user_id) do nothing;
        end if;
      end if;
      d := d + 1;
    end loop;

    for t in
      select tk.* from task tk
      where tk.recurring_rule_id = r.id and tk.occurrence_date is not null
        and tk.status_id not in (select id from task_status where is_done_state)
    loop
      due := t.occurrence_date; ndays := due - p_date;
      if (ndays >= 0 and ndays = any(r.advance_days))
         or (p_date = due)
         or (p_date > due and r.remind_until_done
             and coalesce(r.repeat_every_days, 0) > 0
             and ((p_date - due) % r.repeat_every_days) = 0)
      then
        perform public.eip_emit_notification(
          case when p_date > due then 'recurring_overdue' else 'recurring_due_soon' end,
          t.department_id, t.owner_id, null,
          'task'::notification_entity, t.id,
          (case when p_date > due then 'overdue' else 'due_soon' end)::notification_type,
          (case when p_date > due then '【逾期】' else '【提醒】' end)
            || r.title || '(期限 ' || to_char(due,'MM/DD') || ')');
      end if;
    end loop;

    update recurring_rule set last_run_on = p_date where id = r.id;
  end loop;
end;
$function$;


-- 前端「立即產生/檢查」按鈕的顯示判準，與上面函式的實際允許範圍一致。
-- 原本那顆按鈕沒有任何權限判斷：一般成員看得到但按了會拿到「權限不足」（假按鈕），
-- 而部門主管其實按得動。不能改用 can('eip_recurring','create') 當閘門 ——
-- role_module_permissions 裡 dept_manager 的 create/edit 是 false、member 反而是 true，
-- 用它會把部門主管現有的能力縮掉，又留著給成員的假按鈕。
create or replace function public.eip_can_run_recurring()
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select auth.uid() is not null
     and coalesce(current_role_name()::text, '') in ('company_admin','dept_manager')
     and (
       coalesce(current_role_name()::text, '') = 'company_admin'
       or exists (
         select 1 from public.recurring_rule rr
          where rr.is_active
            and ( rr.owner_id = auth.uid()
               or (rr.department_id is not null and public.eip_user_can_scope_dept(rr.department_id)) )
       )
     );
$function$;

-- 前端 RPC：收掉匿名執行權（政策述詞函式才需要留 anon）
revoke all on function public.eip_can_run_recurring() from public;
revoke all on function public.eip_can_run_recurring() from anon;
grant execute on function public.eip_can_run_recurring() to authenticated;
grant execute on function public.eip_can_run_recurring() to service_role;
