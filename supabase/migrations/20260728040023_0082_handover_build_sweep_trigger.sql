-- 0082: 建立交接清單、每日自動結案與升級、停用/復用觸發

create or replace function public.eip_build_handover(p_leaver uuid)
returns int language plpgsql security definer set search_path to 'public' as $$
declare
  r record; v_n int := 0; v_name text; v_tenant uuid; v_ent notification_entity; v_msg text;
begin
  select name, tenant_id into v_name, v_tenant from public.app_user where id = p_leaver;
  if v_name is null then return 0; end if;

  for r in select * from public.eip_pending_reassign(p_leaver) loop
    insert into public.eip_handover_item(
      tenant_id, leaver_id, entity_type, entity_id, entity_title,
      assignee_id, assignee_reason, department_id)
    select coalesce(v_tenant,'00000000-0000-0000-0000-000000000001'),
           p_leaver, r.entity_type, r.entity_id, r.entity_title,
           r.assignee_id, r.assignee_reason,
           case r.entity_type
             when 'task' then (select department_id from public.task where id = r.entity_id)
             when 'task_collaborator' then (select department_id from public.task where id = r.entity_id)
             when 'project' then (select department_id from public.project where id = r.entity_id)
             when 'recurring_rule' then (select department_id from public.recurring_rule where id = r.entity_id)
             when 'meeting_action_item' then (select m.department_id from public.meeting_action_item a
                                              join public.meeting m on m.id=a.meeting_id where a.id = r.entity_id)
             else (select department_id from public.app_user where id = r.entity_id) end
    on conflict (leaver_id, entity_type, entity_id) do nothing;

    if not found then continue; end if;
    v_n := v_n + 1;

    -- 通知導向：任務類直接指到任務、專案指到專案、會議決議指到會議，其餘指到交接清單
    v_ent := case r.entity_type
               when 'task' then 'task'::notification_entity
               when 'task_collaborator' then 'task'::notification_entity
               when 'project' then 'project'::notification_entity
               when 'meeting_action_item' then 'meeting'::notification_entity
               else 'handover'::notification_entity end;

    v_msg := '【人員異動】' || v_name || ' 已停用，'
      || case r.entity_type
           when 'task' then '任務「' || coalesce(r.entity_title,'') || '」需重新指派負責人'
           when 'task_collaborator' then '任務「' || coalesce(r.entity_title,'') || '」的協作者需調整'
           when 'project' then '專案「' || coalesce(r.entity_title,'') || '」需重新指派負責人'
           when 'recurring_rule' then '常態工作「' || coalesce(r.entity_title,'') || '」已自動停用，需重新指派負責人後再啟用'
           when 'meeting_action_item' then '會議決議「' || coalesce(r.entity_title,'') || '」需重新指派負責人'
           when 'deputy' then coalesce(r.entity_title,'') || ' 的職務代理人設定已自動清除，請重新指定'
         end
      || case r.assignee_reason
           when 'creator' then '（您是建立者）'
           when 'dept_manager' then '（原建立者已離職或不存在，轉由部門主管處理）'
           when 'parent_dept_manager' then '（原建立者與部門主管皆無法處理，轉由上層主管處理）'
           when 'company_admin' then '（查無適合的處理人，轉由系統管理者處理）'
           else '' end;

    perform public.eip_notify_user(
      r.assignee_id, 'reassign_needed'::notification_type, v_ent,
      case when v_ent = 'handover'
           then (select id from public.eip_handover_item
                  where leaver_id=p_leaver and entity_type=r.entity_type and entity_id=r.entity_id)
           when r.entity_type = 'meeting_action_item'
           then (select meeting_id from public.meeting_action_item where id = r.entity_id)
           else r.entity_id end,
      v_msg);
  end loop;

  -- 立即安全處置（避免持續產生新的呆滯資料）
  -- ① 常態工作規則停用：否則 cron 每天照樣生任務給已離職者
  update public.recurring_rule set is_active = false, updated_at = now()
   where owner_id = p_leaver and is_active;
  -- ② 清除別人指向他的職務代理人設定，並把該交接項直接結案（已自動處理完畢）
  update public.app_user set deputy_id = null, updated_at = now() where deputy_id = p_leaver;
  update public.eip_handover_item
     set status='resolved', resolution='系統自動清除職務代理人設定', resolved_at=now()
   where leaver_id = p_leaver and entity_type='deputy' and status='pending';

  return v_n;
end;
$$;

-- ── 每日掃描：已處理者自動結案；逾期未處理自動升級
create or replace function public.eip_sweep_handover()
returns int language plpgsql security definer set search_path to 'public' as $$
declare h record; v_done boolean; v_closed int := 0; v_mgr uuid; v_adm uuid;
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

    -- 逾期升級：3 天通知部門主管、7 天通知管理者（各只做一次）
    if h.escalated_level < 1 and h.created_at < now() - interval '3 days' then
      select manager_id into v_mgr from public.department where id = h.department_id;
      perform public.eip_notify_user(v_mgr, 'reassign_needed'::notification_type, 'handover'::notification_entity,
        h.id, '【交接逾期】「' || coalesce(h.entity_title,'') || '」已超過 3 天未重新指派，請協助處理');
      update public.eip_handover_item set escalated_level = 1 where id = h.id;
    elsif h.escalated_level < 2 and h.created_at < now() - interval '7 days' then
      select id into v_adm from public.app_user
        where status='active' and role='company_admin' order by created_at limit 1;
      perform public.eip_notify_user(v_adm, 'reassign_needed'::notification_type, 'handover'::notification_entity,
        h.id, '【交接嚴重逾期】「' || coalesce(h.entity_title,'') || '」已超過 7 天未重新指派');
      update public.eip_handover_item set escalated_level = 2 where id = h.id;
    end if;
  end loop;
  return v_closed;
end;
$$;

-- ── 停用 / 復用 觸發
create or replace function public.eip_on_user_status_change()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status = 'inactive' and old.status is distinct from 'inactive' then
    perform public.eip_build_handover(new.id);
  elsif new.status = 'active' and old.status = 'inactive' then
    -- 誤停用復原：整批撤銷未處理的交接項，不留垃圾
    update public.eip_handover_item
       set status='void', resolution='該人員已恢復啟用，交接自動取消', resolved_at=now()
     where leaver_id = new.id and status='pending';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_user_status_handover on public.app_user;
create trigger trg_user_status_handover
after update of status on public.app_user
for each row execute function public.eip_on_user_status_change();

revoke all on function public.eip_build_handover(uuid) from public, anon;
revoke all on function public.eip_sweep_handover() from public, anon;
revoke all on function public.eip_on_user_status_change() from public, anon;
;
