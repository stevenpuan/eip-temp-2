-- ============================================================
-- 0145 第五輪稽核：請假代辦的四個真問題
-- ============================================================

/* ---------- ① rollup 退回的目標值選錯了 ----------
   我把「有一項被取消完成」退回 'acknowledged'，但正式庫裡 acknowledged 是
   舊制「主管已確認」留下的值（現有 24 筆），前端把它顯示成「已完成」。
   結果：代辦退回未完成，畫面卻還是綠色「已完成」，而且 done_at 已被清掉，
   連完成時間都不見了 —— 狀態直接說謊。
   退回 'open'（待處理）才是實話，也不會跟舊值撞語意。                        */

/* ---------- ② 0 項代辦的請假單永遠關不掉 ----------
   rollup 只在 eip_leave_handover_item 有動靜時才跑，且「0 項」不視為完成
   （否則等於自動結案）。但送出請假時不一定有東西要交接，
   於是那張單永久停在「待處理」，主管的待辦感知會被雜訊淹掉。
   給一支明確的結案 RPC，人按了才結案，而且只有「沒有未完成項目」時能按。   */

create or replace function public.eip_lhi_rollup()
 returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_rid uuid; v_total int; v_done int; v_status text;
begin
  v_rid := coalesce(new.quick_report_id, old.quick_report_id);
  select count(*), count(*) filter (where done_at is not null)
    into v_total, v_done
    from public.eip_leave_handover_item where quick_report_id = v_rid;

  select status into v_status from public.eip_quick_report where id = v_rid;

  if v_total > 0 and v_done = v_total and v_status <> 'done' then
    update public.eip_quick_report
       set status = 'done', done_at = now(),
           done_by = coalesce(new.done_by, auth.uid())
     where id = v_rid;
  elsif v_done < v_total and v_status = 'done' then
    -- 退回 'open'，不要用 'acknowledged'：那是舊制「主管已確認」的值，
    -- 前端把它當「已完成」顯示，退回到那裡會讓畫面說謊。
    update public.eip_quick_report
       set status = 'open', done_at = null, done_by = null
     where id = v_rid;
  end if;
  return null;
end $$;
revoke all on function public.eip_lhi_rollup() from public, anon, authenticated;

-- 沒有未完成項目時，讓人明確結案（含完全沒有代辦事項的請假）
create or replace function public.eip_close_leave_handover(p_report_id uuid)
 returns jsonb
 language plpgsql security definer set search_path to 'public'
as $function$
declare v_me uuid := auth.uid(); r public.eip_quick_report; v_total int; v_open int;
begin
  if v_me is null then raise exception '需要登入身分'; end if;

  select * into r from public.eip_quick_report
   where id = p_report_id and deleted_at is null;
  if r.id is null then raise exception '找不到這筆回報'; end if;
  if r.type <> 'leave' then raise exception '這支只處理請假代辦'; end if;
  if not public.eip_can_see_leave(p_report_id) then
    raise exception '權限不足：只有當事人、代理人、單位主管或管理者可以結案';
  end if;
  if r.status = 'done' then
    return jsonb_build_object('ok', true, 'already_done', true);
  end if;

  select count(*), count(*) filter (where done_at is null)
    into v_total, v_open
    from public.eip_leave_handover_item where quick_report_id = p_report_id;

  if v_open > 0 then
    raise exception '還有 % 項代辦未完成，不能結案', v_open;
  end if;

  update public.eip_quick_report
     set status = 'done', done_at = now(), done_by = v_me
   where id = p_report_id;

  return jsonb_build_object('ok', true, 'items', v_total, 'no_handover', v_total = 0);
end;
$function$;
revoke all on function public.eip_close_leave_handover(uuid) from public, anon;
grant execute on function public.eip_close_leave_handover(uuid) to authenticated, service_role;


/* ---------- ③ 被逐項指派的代理人看不到請假單本身 ----------
   qr_read 的條件是「本人／company_admin／dept_manager 管轄部門」，
   完全沒有涵蓋 eip_quick_report.deputy_id（這一次請假的代理人）
   與 eip_leave_handover_item.assignee_id（被逐項指派的人）。
   後果：工作區「待我處理」查得到代辦項目、卻查不到所屬請假單，
   畫面就顯示「— 請假 未填區間」，代理人不知道這是誰的假、哪幾天。      */
drop policy if exists qr_read on public.eip_quick_report;
create policy qr_read on public.eip_quick_report
  for select
  using (
    tenant_id = current_tenant_id()
    and deleted_at is null
    and (
      submitter_id = (select auth.uid())
      or current_role_name() = 'company_admin'
      or (current_role_name() = 'dept_manager' and department_id is not null
          and eip_user_can_scope_dept(department_id))
      -- 這一次請假指定的代理人
      or deputy_id = (select auth.uid())
      -- 被逐項指派代辦的人
      or exists (select 1 from public.eip_leave_handover_item i
                  where i.quick_report_id = eip_quick_report.id
                    and i.assignee_id = (select auth.uid()))
    )
  );

/* ---------- ④ qr_update_done 認的是「靜態代理人」，不是這次請假的代理人 ----------
   原條件用 app_user.deputy_id（通知副本用的靜態代理人）。
   新流程是每次請假指定代理人＋逐項指派，那些人反而不在名單裡。          */
drop policy if exists qr_update_done on public.eip_quick_report;
create policy qr_update_done on public.eip_quick_report
  for update to authenticated
  using (
    tenant_id = current_tenant_id()
    and deleted_at is null
    and type = 'leave'
    and status <> 'done'
    and (
      submitter_id = (select auth.uid())
      or deputy_id = (select auth.uid())
      or (select auth.uid()) in (select u.id from public.app_user u
                                  where u.deputy_id = eip_quick_report.submitter_id)
      or exists (select 1 from public.eip_leave_handover_item i
                  where i.quick_report_id = eip_quick_report.id
                    and i.assignee_id = (select auth.uid()))
      or eip_is_dept_supervisor(department_id)
      or current_role_name() = 'company_admin'
    )
  )
  with check (tenant_id = current_tenant_id());;
