-- 0111 軟刪除範圍、交接升級節流、權限收斂（第三輪稽核 H6 M7b M8 M9 M11 L4 L6）

------------------------------------------------------------------
-- H6：eip_soft_delete_guard 的 return null 會靜默取消 ON DELETE CASCADE，
--     刪除員工時留下違反外鍵的孤兒列且不報錯。
--     這三條 FK 改成 RESTRICT：員工有個人行程／例行範本／工作日誌時
--     不允許硬刪，必須明確處理（eip_admin_delete_user 本來就會先擋）。
------------------------------------------------------------------
alter table public.personal_event   drop constraint personal_event_user_id_fkey;
alter table public.personal_event   add  constraint personal_event_user_id_fkey
  foreign key (user_id) references public.app_user(id) on delete restrict;

alter table public.personal_routine drop constraint personal_routine_user_id_fkey;
alter table public.personal_routine add  constraint personal_routine_user_id_fkey
  foreign key (user_id) references public.app_user(id) on delete restrict;

alter table public.work_log         drop constraint work_log_user_id_fkey;
alter table public.work_log         add  constraint work_log_user_id_fkey
  foreign key (user_id) references public.app_user(id) on delete restrict;

------------------------------------------------------------------
-- M7b：0095 只改了 SELECT 政策。UPDATE / DELETE 政策沒排除已刪列，
--      知道 id 的人（舊快取、通知的 entity_id、eip_deleted_items 回傳值）
--      仍可修改回收區裡的資料。
--      只加在 USING，不能加在 WITH CHECK ——否則軟刪除自己那筆 UPDATE 會被擋。
------------------------------------------------------------------
alter policy announcement_admin_write on public.announcement
  using ((tenant_id = current_tenant_id()) and (current_role_name() = 'company_admin'::user_role)
         and deleted_at is null);

alter policy announcement_manager_update on public.announcement
  using ((tenant_id = current_tenant_id()) and (current_role_name() = 'dept_manager'::user_role)
         and (created_by = (select auth.uid())) and deleted_at is null);

alter policy announcement_manager_delete on public.announcement
  using ((tenant_id = current_tenant_id()) and (current_role_name() = 'dept_manager'::user_role)
         and (created_by = (select auth.uid())) and deleted_at is null);

alter policy document_update on public.eip_document
  using ((tenant_id = current_tenant_id())
         and ((current_role_name() = 'company_admin'::user_role)
              or (owner_id = (select auth.uid()))
              or (created_by = (select auth.uid()))
              or ((current_role_name() = 'dept_manager'::user_role)
                  and (department_id is not null) and eip_user_can_scope_dept(department_id)))
         and deleted_at is null);

alter policy document_delete on public.eip_document
  using ((tenant_id = current_tenant_id())
         and ((current_role_name() = 'company_admin'::user_role)
              or (owner_id = (select auth.uid()))
              or ((current_role_name() = 'dept_manager'::user_role)
                  and (department_id is not null) and eip_user_can_scope_dept(department_id)))
         and deleted_at is null);

alter policy fr_update_admin on public.eip_feature_request
  using ((tenant_id = current_tenant_id())
         and (current_role_name() = any (array['company_admin'::user_role,'dept_manager'::user_role]))
         and deleted_at is null);

alter policy fr_update_own on public.eip_feature_request
  using ((tenant_id = current_tenant_id()) and (submitter_id = (select auth.uid()))
         and deleted_at is null);

alter policy fr_delete on public.eip_feature_request
  using ((tenant_id = current_tenant_id())
         and ((current_role_name() = 'company_admin'::user_role)
              or (submitter_id = (select auth.uid())))
         and deleted_at is null);

alter policy qr_update on public.eip_quick_report
  using ((tenant_id = current_tenant_id())
         and ((current_role_name() = 'company_admin'::user_role)
              or ((current_role_name() = 'dept_manager'::user_role)
                  and (department_id is not null) and eip_user_can_scope_dept(department_id)))
         and deleted_at is null);

alter policy qr_update_own on public.eip_quick_report
  using ((tenant_id = current_tenant_id()) and (submitter_id = (select auth.uid()))
         and (status = 'open'::text) and deleted_at is null);

alter policy qr_delete on public.eip_quick_report
  using ((tenant_id = current_tenant_id())
         and ((current_role_name() = 'company_admin'::user_role)
              or ((submitter_id = (select auth.uid())) and (status = 'open'::text)))
         and deleted_at is null);

------------------------------------------------------------------
-- M8：qr_update_done 缺 tenant_id、缺 deleted_at、缺 WITH CHECK，
--     PERMISSIVE 之間是 OR，導致 qr_update_own 的「只有 open 才能改自己的」
--     被整條放寬（本人任何狀態都能改，含已 done），且新值不受 tenant 約束。
--     這條政策的用途是「請假代辦完成」，收斂到只允許 leave 類型、
--     且尚未結案的那一段。
------------------------------------------------------------------
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
      or (select auth.uid()) in (select u.id from public.app_user u
                                  where u.deputy_id = eip_quick_report.submitter_id)
      or eip_is_dept_supervisor(department_id)
      or current_role_name() = 'company_admin'::user_role
    )
  )
  with check (tenant_id = current_tenant_id());

alter policy personal_event_update on public.personal_event
  using ((user_id = (select auth.uid())) and deleted_at is null);
alter policy personal_event_delete on public.personal_event
  using ((user_id = (select auth.uid())) and deleted_at is null);

alter policy pr_update on public.personal_routine
  using (((user_id = (select auth.uid())) or (current_role_name() = 'company_admin'::user_role))
         and deleted_at is null);
alter policy pr_delete on public.personal_routine
  using (((user_id = (select auth.uid())) or (current_role_name() = 'company_admin'::user_role))
         and deleted_at is null);

alter policy task_update_policy on public.task
  using ((tenant_id = current_tenant_id())
         and ((current_role_name() = 'company_admin'::user_role)
              or ((current_role_name() = 'dept_manager'::user_role)
                  and (department_id is not null) and eip_user_can_scope_dept(department_id))
              or (owner_id = (select auth.uid()))
              or (created_by = (select auth.uid()))
              or eip_is_task_collaborator(id))
         and deleted_at is null);

alter policy task_delete on public.task
  using ((tenant_id = current_tenant_id())
         and ((current_role_name() = 'company_admin'::user_role)
              or ((current_role_name() = 'dept_manager'::user_role)
                  and (department_id is not null) and eip_user_can_scope_dept(department_id))
              or (owner_id = (select auth.uid()))
              or (created_by = (select auth.uid()))
              or eip_is_task_collaborator(id))
         and deleted_at is null);

alter policy work_log_update on public.work_log
  using ((tenant_id = current_tenant_id())
         and ((user_id = (select auth.uid())) or eip_is_dept_supervisor(department_id))
         and deleted_at is null);

alter policy work_log_delete on public.work_log
  using (((user_id = (select auth.uid())) or (current_role_name() = 'company_admin'::user_role))
         and deleted_at is null);

------------------------------------------------------------------
-- M9：guard 的 return null 讓 PostgREST 回「0 列受影響」，
--     前端若用 .delete().select() 或檢查筆數會誤判為「刪除失敗」。
--     提供一支明確回傳結果的 RPC 給前端用（SECURITY INVOKER，RLS 照常生效）。
------------------------------------------------------------------
create or replace function public.eip_soft_delete(p_module text, p_id uuid)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare r record; v_before timestamptz; v_after timestamptz; v_exists boolean;
begin
  select * into r from public.eip_deletion_policy where module_key = p_module and is_active;
  if r is null then raise exception '未納管的模組：%', p_module; end if;

  execute format('select deleted_at, true from public.%I where id = $1', r.table_name)
    into v_before, v_exists using p_id;
  if not coalesce(v_exists, false) then
    return jsonb_build_object('ok', false, 'reason', '找不到資料或無權限');
  end if;
  if v_before is not null then
    return jsonb_build_object('ok', true, 'already', true, 'deleted_at', v_before);
  end if;

  execute format('delete from public.%I where id = $1', r.table_name) using p_id;

  execute format('select deleted_at from public.%I where id = $1', r.table_name)
    into v_after using p_id;
  if v_after is null then
    return jsonb_build_object('ok', false, 'reason', '無刪除權限');
  end if;
  return jsonb_build_object('ok', true, 'deleted_at', v_after);
end;
$function$;

grant execute on function public.eip_soft_delete(text, uuid) to authenticated;
revoke execute on function public.eip_soft_delete(text, uuid) from anon;

------------------------------------------------------------------
-- M11：eip_sweep_handover 在通知失敗（部門沒主管）時不推進層級，
--      導致每天重試、每天寫一筆 eip_notification_miss，永久累積且沒人被通知。
--      改成：每個層級每 20 小時最多試一次，連續 3 次失敗就強制推進並留一筆紀錄。
------------------------------------------------------------------
alter table public.eip_handover_item
  add column if not exists last_notify_at   timestamptz,
  add column if not exists notify_attempts  int not null default 0;

comment on column public.eip_handover_item.last_notify_at is
  '最後一次嘗試發逾期通知的時間，用來節流（M11）';
comment on column public.eip_handover_item.notify_attempts is
  '目前層級已嘗試通知幾次；達 3 次仍失敗就強制推進層級並記一筆 miss（M11）';

create or replace function public.eip_sweep_handover()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare h record; v_done boolean; v_closed int := 0; v_mgr uuid; v_adm uuid; v_sent int;
        v_level int; v_label text;
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

    -- M11：同一層級每 20 小時最多試一次，避免每天重打同一通失敗的通知
    if h.last_notify_at is not null and h.last_notify_at > now() - interval '20 hours' then
      continue;
    end if;

    v_level := null; v_sent := null;

    if h.escalated_level < 2 and h.created_at < now() - interval '7 days' then
      v_level := 2; v_label := '【交接嚴重逾期】';
      select id into v_adm from public.app_user
        where status='active' and role='company_admin'
          and tenant_id = coalesce((select tenant_id from public.app_user where id = h.leaver_id),
                                   '00000000-0000-0000-0000-000000000001')
        order by created_at limit 1;
      v_sent := public.eip_notify_user(v_adm, 'reassign_needed'::notification_type,
        'handover'::notification_entity, h.id,
        '【交接嚴重逾期】「' || coalesce(h.entity_title,'') || '」已超過 7 天未重新指派', 'urgent');

    elsif h.escalated_level < 1 and h.created_at < now() - interval '3 days' then
      v_level := 1; v_label := '【交接逾期】';
      select manager_id into v_mgr from public.department where id = h.department_id;
      v_sent := public.eip_notify_user(v_mgr, 'reassign_needed'::notification_type,
        'handover'::notification_entity, h.id,
        '【交接逾期】「' || coalesce(h.entity_title,'') || '」已超過 3 天未重新指派，請協助處理', 'high');
    end if;

    if v_level is null then continue; end if;

    if coalesce(v_sent,0) > 0 then
      update public.eip_handover_item
         set escalated_level = v_level, last_notify_at = now(), notify_attempts = 0
       where id = h.id;
    elsif h.notify_attempts + 1 >= 3 then
      -- 連 3 天都通知不到（多半是該部門沒設主管）：強制推進，只留一筆紀錄
      update public.eip_handover_item
         set escalated_level = v_level, last_notify_at = now(), notify_attempts = 0
       where id = h.id;
      begin
        insert into public.eip_notification_miss(event_code, entity_type, entity_id, reason)
        values ('handover_escalate', 'handover', h.id,
                v_label || '連續 3 次找不到收件人（請確認該部門是否已指派主管），已停止重試');
      exception when others then null;
      end;
    else
      update public.eip_handover_item
         set last_notify_at = now(), notify_attempts = h.notify_attempts + 1
       where id = h.id;
    end if;
  end loop;
  return v_closed;
end;
$function$;

revoke execute on function public.eip_sweep_handover() from anon, authenticated;

------------------------------------------------------------------
-- L4：觸發函式不該對外開放 RPC（plpgsql 會擋，但授權面要乾淨）
------------------------------------------------------------------
revoke execute on function public.eip_notify_announcement_published() from anon, authenticated;
revoke execute on function public.eip_notify_meeting_invited()       from anon, authenticated;
revoke execute on function public.eip_log_task_change()              from anon, authenticated;
revoke execute on function public.eip_log_task_collab_change()       from anon, authenticated;
revoke execute on function public.eip_sync_app_user_role()           from anon, authenticated;
revoke execute on function public.eip_on_user_status_change()        from anon, authenticated;
revoke execute on function public.eip_fill_personal_routine_defaults() from anon, authenticated;
revoke execute on function public.eip_soft_delete_guard()            from anon, authenticated;

------------------------------------------------------------------
-- L6：補上 search_path（advisor: function_search_path_mutable）
------------------------------------------------------------------
alter function public.eip_priority_label(text) set search_path to 'public';
alter function public.eip_handover_touch()     set search_path to 'public';

------------------------------------------------------------------
-- L2：eip_restore_deleted 對未刪除的列呼叫會把 deleted_by 清成 null
------------------------------------------------------------------
create or replace function public.eip_restore_deleted(p_module text, p_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r record; v_owner uuid; v_me uuid := auth.uid(); v_deleted timestamptz;
begin
  select * into r from public.eip_deletion_policy where module_key = p_module and is_active;
  if r is null then raise exception '未納管的模組：%', p_module; end if;

  execute format('select %I, deleted_at from public.%I where id = $1', r.creator_col, r.table_name)
    into v_owner, v_deleted using p_id;
  if v_owner is null then raise exception '找不到資料'; end if;
  if v_deleted is null then raise exception '此資料不在回收區，無需還原'; end if;

  if v_owner <> v_me and coalesce(current_role_name()::text,'') <> 'company_admin' then
    raise exception '權限不足：只有建立者可以還原';
  end if;

  execute format('update public.%I set deleted_at = null, deleted_by = null where id = $1',
                 r.table_name) using p_id;
end;
$function$;;
