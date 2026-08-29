-- 0084: eip_pending_reassign 在無登入身分（service_role / trigger / cron）時不應被權限檢查擋下
create or replace function public.eip_pending_reassign(p_user_id uuid)
returns table(entity_type text, entity_id uuid, entity_title text,
              assignee_id uuid, assignee_name text, assignee_reason text)
language plpgsql stable security definer set search_path to 'public' as $$
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
    union all
    select 'task_collaborator', t.id, t.title, t.created_by, t.department_id
      from public.task_collaborator tc
      join public.task t on t.id = tc.task_id
      join public.task_status s on s.id = t.status_id
     where tc.user_id = p_user_id and not s.is_done_state and t.owner_id <> p_user_id
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
$$;
revoke all on function public.eip_pending_reassign(uuid) from public, anon;
grant execute on function public.eip_pending_reassign(uuid) to authenticated;
;
