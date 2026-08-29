-- 0109 上線前必修：H1 交接建立權限、H5 交接函式軟刪除過濾、M6 user_roles 重複 trigger
-- 稽核第三輪（2026-07-28）

------------------------------------------------------------------
-- M6：user_roles 上兩支 trigger 都在改 app_user.role，
--     字母序讓 legacy 的 trg_sync_app_user_role 最後執行並覆蓋現行設計。
--     兩者映射不一致（member+viewer：新版 viewer、舊版 member）。
------------------------------------------------------------------
drop trigger if exists trg_sync_app_user_role on public.user_roles;
drop function if exists public.sync_app_user_role();

-- 角色映射收攏成單一來源：current_role_name() 改委派 eip_derive_app_role()。
-- 只有「有掛框架角色」時才用推導值，否則沿用 app_user.role（維持既有 fallback 語意）。
-- 套用前已比對 26 位員工，推導結果與原邏輯 0 筆差異。
create or replace function public.current_role_name()
 returns user_role
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(
    (select public.eip_derive_app_role(auth.uid())
      where exists (select 1 from user_roles where user_id = auth.uid())),
    (select role from app_user where id = auth.uid())
  );
$function$;

------------------------------------------------------------------
-- H1：eip_build_handover(uuid) 是 SECURITY DEFINER 且對 authenticated 開放，
--     函式尾端的兩個 UPDATE（停用常態工作、清除代理人）不受 RLS 約束也無範圍限制。
--     它只該由 trg_user_status_handover 觸發，不需要對外開放。
------------------------------------------------------------------
revoke execute on function public.eip_build_handover(uuid) from anon, authenticated;

------------------------------------------------------------------
-- H5：eip_pending_reassign 缺 deleted_at is null。
--     回收區裡的任務會被撈出來產生交接項，UI 上點不開也關不掉，
--     且每天由 sweep 升級成【緊急】重發。
--     這批表中只有 task 有軟刪除，其餘（project / recurring_rule /
--     meeting_action_item / app_user）仍是硬刪，不需條件。
------------------------------------------------------------------
create or replace function public.eip_pending_reassign(p_user_id uuid)
 returns TABLE(entity_type text, entity_id uuid, entity_title text, assignee_id uuid, assignee_name text, assignee_reason text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is not null
     and coalesce(current_role_name()::text,'') not in ('company_admin','dept_manager') then
    raise exception '權限不足：僅管理者或部門主管可查詢交接預覽';
  end if;

  return query
  with src as (
    select 'task'::text et, t.id eid, t.title ttl, t.created_by cre, t.department_id dep
      from public.task t join public.task_status s on s.id = t.status_id
     where t.owner_id = p_user_id and not s.is_done_state
       and t.deleted_at is null
    union all
    select 'task_collaborator', t.id, t.title, t.created_by, t.department_id
      from public.task_collaborator tc
      join public.task t on t.id = tc.task_id
      join public.task_status s on s.id = t.status_id
     where tc.user_id = p_user_id and not s.is_done_state and t.owner_id <> p_user_id
       and t.deleted_at is null
    union all
    select 'project', p.id, p.name, null::uuid, p.department_id
      from public.project p where p.owner_id = p_user_id
    union all
    select 'recurring_rule', r.id, r.title, r.created_by, r.department_id
      from public.recurring_rule r where r.owner_id = p_user_id and r.is_active
    union all
    select 'meeting_action_item', a.id, a.content, m.created_by, m.department_id
      from public.meeting_action_item a join public.meeting m on m.id = a.meeting_id
     where a.owner_id = p_user_id and a.status <> 'done'
    union all
    select 'deputy', u.id, u.name, null::uuid, u.department_id
      from public.app_user u where u.deputy_id = p_user_id
  )
  select src.et, src.eid, src.ttl, a.assignee, au.name, a.reason
    from src
    cross join lateral public.eip_handover_assignee(src.cre, src.dep, p_user_id) a
    left join public.app_user au on au.id = a.assignee;
end;
$function$;

------------------------------------------------------------------
-- H5（續）：eip_sweep_handover 的完成判定也要把軟刪除視為「已結案」，
--          否則既有的交接項會永遠 pending 並每天升級。
------------------------------------------------------------------
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
         where t.id=h.entity_id and t.owner_id=h.leaver_id and not s.is_done_state
           and t.deleted_at is null)
      when 'task_collaborator' then not exists (
        select 1 from public.task_collaborator tc
          join public.task t on t.id=tc.task_id
          join public.task_status s on s.id=t.status_id
         where tc.task_id=h.entity_id and tc.user_id=h.leaver_id and not s.is_done_state
           and t.deleted_at is null)
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

    -- 逾期 7 天優先判斷，避免舊資料要多等一天才升到 level 2
    if h.escalated_level < 2 and h.created_at < now() - interval '7 days' then
      select id into v_adm from public.app_user
        where status='active' and role='company_admin'
          and tenant_id = coalesce((select tenant_id from public.app_user where id = h.leaver_id),
                                   '00000000-0000-0000-0000-000000000001')
        order by created_at limit 1;
      v_sent := public.eip_notify_user(v_adm, 'reassign_needed'::notification_type,
        'handover'::notification_entity, h.id,
        '【交接嚴重逾期】「' || coalesce(h.entity_title,'') || '」已超過 7 天未重新指派', 'urgent');
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

revoke execute on function public.eip_sweep_handover() from anon, authenticated;
revoke execute on function public.current_role_name() from anon;;
