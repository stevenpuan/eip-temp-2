-- 0105 修 H3、H4，並補 M10 的唯一約束
--
-- H3：leave_handover_created 的收件範圍是 {deputy, dept_manager}，但
--     全公司 0 人設職務代理人、18 個部門有 5 個沒有主管、而「自己就是本部門主管」
--     的人會被發起人排除規則濾掉 → 25 位在職員工裡有 17 位請假時「通知 0 人」，
--     而且完全靜默不報錯。加上層主管與管理者兜底。
--
-- H4：eip_sweep_handover 無條件寫入 escalated_level，
--     但 eip_notify_user 在收件人為 null 時會直接 return 0。
--     結果通知被丟棄、升級層級卻已推進 → 那一級升級永久消失。
--     改成只有真的發出通知才推進層級。
--
-- M10：notification_setting 沒有唯一約束，同 tenant+event_code+department_id
--     若出現第二筆，查找的 order by 沒有 tiebreaker，收件範圍會靜默漂移。

/* ---------- H3：請假代辦收件範圍加兜底 ---------- */
update public.notification_setting
   set recipient_scopes = array['deputy','dept_manager','parent_dept_manager','role:company_admin']::text[],
       updated_at = now()
 where event_code = 'leave_handover_created';

update public.notification_setting
   set recipient_scopes = array['owner','dept_manager','parent_dept_manager']::text[],
       updated_at = now()
 where event_code = 'leave_handover_completed';

/* ---------- M10：唯一約束 ---------- */
-- 先確認沒有既有重複（有的話約束會建不起來，這是我們想知道的）
create unique index if not exists uq_notification_setting_scope
  on public.notification_setting (tenant_id, event_code, coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid));

/* ---------- H4：升級層級只在通知真的發出後推進 ---------- */
create or replace function public.eip_sweep_handover()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare h record; v_done boolean; v_closed int := 0; v_mgr uuid; v_adm uuid; v_sent int;
begin
  for h in select * from public.eip_handover_item where status = 'pending' loop
    v_done := case h.entity_type
      when 'task' then not exists (
        select 1 from public.task t join public.task_status s on s.id=t.status_id
         where t.id=h.entity_id and t.owner_id=h.leaver_id and not s.is_done_state)
      when 'task_collaborator' then not exists (
        select 1 from public.task_collaborator tc
          join public.task t on t.id=tc.task_id
          join public.task_status s on s.id=t.status_id
         where tc.task_id=h.entity_id and tc.user_id=h.leaver_id and not s.is_done_state)
      when 'project' then not exists (
        select 1 from public.project p where p.id=h.entity_id and p.owner_id=h.leaver_id)
      when 'recurring_rule' then not exists (
        select 1 from public.recurring_rule r where r.id=h.entity_id and r.owner_id=h.leaver_id)
      when 'meeting_action_item' then not exists (
        select 1 from public.meeting_action_item a
         where a.id=h.entity_id and a.owner_id=h.leaver_id and a.status <> 'done')
      else true end;

    if v_done then
      update public.eip_handover_item
         set status='resolved', resolution='系統偵測已完成交接或原項目已結案', resolved_at=now()
       where id = h.id;
      v_closed := v_closed + 1;
      continue;
    end if;

    -- 逾期 7 天優先判斷，避免舊資料要多等一天才升到 level 2（L14）
    if h.escalated_level < 2 and h.created_at < now() - interval '7 days' then
      select id into v_adm from public.app_user
        where status='active' and role='company_admin'
          and tenant_id = coalesce((select tenant_id from public.app_user where id = h.leaver_id),
                                   '00000000-0000-0000-0000-000000000001')
        order by created_at limit 1;
      v_sent := public.eip_notify_user(v_adm, 'reassign_needed'::notification_type,
        'handover'::notification_entity, h.id,
        '【交接嚴重逾期】「' || coalesce(h.entity_title,'') || '」已超過 7 天未重新指派', 'urgent');
      -- H4：只有真的通知到人才推進層級，否則下一輪還會再試
      if coalesce(v_sent,0) > 0 then
        update public.eip_handover_item set escalated_level = 2 where id = h.id;
      end if;

    elsif h.escalated_level < 1 and h.created_at < now() - interval '3 days' then
      select manager_id into v_mgr from public.department where id = h.department_id;
      v_sent := public.eip_notify_user(v_mgr, 'reassign_needed'::notification_type,
        'handover'::notification_entity, h.id,
        '【交接逾期】「' || coalesce(h.entity_title,'') || '」已超過 3 天未重新指派，請協助處理', 'high');
      if coalesce(v_sent,0) > 0 then
        update public.eip_handover_item set escalated_level = 1 where id = h.id;
      end if;
    end if;
  end loop;
  return v_closed;
end;
$function$;
;
