-- 0081: 離職/停用交接佇列 —— 確保不會有「沒人處理、結不了案」的呆滯資料
-- 原則：停用帳號 => 掃出所有仍指向該人的未結案物件 => 每一筆建立可追蹤的交接項 => 指派給明確的人
--       => 每日自動偵測已處理者並自動結案 => 逾期自動升級 => 誤停用可整批撤銷

create table if not exists public.eip_handover_item (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000001',
  leaver_id uuid not null references public.app_user(id) on delete cascade,
  entity_type text not null check (entity_type in
    ('task','task_collaborator','project','recurring_rule','meeting_action_item','deputy')),
  entity_id uuid not null,
  entity_title text,
  assignee_id uuid references public.app_user(id) on delete set null,
  assignee_reason text,
  department_id uuid references public.department(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','resolved','void')),
  resolution text,
  resolved_by uuid references public.app_user(id) on delete set null,
  resolved_at timestamptz,
  escalated_level int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (leaver_id, entity_type, entity_id)
);

comment on table public.eip_handover_item is
  '離職/停用交接佇列：每一筆代表一個仍指向已停用人員的未結案物件，必須被重新指派或自動結案，避免呆滯資料。';

create index if not exists idx_handover_assignee_status on public.eip_handover_item(assignee_id, status);
create index if not exists idx_handover_leaver on public.eip_handover_item(leaver_id, status);
create index if not exists idx_handover_dept on public.eip_handover_item(department_id, status);

-- updated_at 自動維護
create or replace function public.eip_handover_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists trg_handover_touch on public.eip_handover_item;
create trigger trg_handover_touch before update on public.eip_handover_item
for each row execute function public.eip_handover_touch();

-- ── 直接對特定人發通知（有別於依 notification_setting 廣播的 eip_emit_notification）
create or replace function public.eip_notify_user(
  p_user_id uuid, p_type notification_type, p_entity_type notification_entity,
  p_entity_id uuid, p_message text)
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_tenant uuid; v_n int := 0;
begin
  if p_user_id is null then return 0; end if;
  select tenant_id into v_tenant from public.app_user where id = p_user_id;
  v_tenant := coalesce(v_tenant, '00000000-0000-0000-0000-000000000001');
  insert into public.notification(tenant_id, user_id, type, entity_type, entity_id, message, line_pending)
  select v_tenant, p_user_id, p_type, p_entity_type, p_entity_id, p_message, false
  where not exists (
    select 1 from public.notification n
    where n.user_id = p_user_id and n.entity_id = p_entity_id
      and n.type = p_type and n.created_at::date = current_date);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ── 決定交接項該指派給誰：建立者 → 部門主管 → 上層部門主管 → 管理者
create or replace function public.eip_handover_assignee(
  p_creator uuid, p_dept uuid, p_leaver uuid,
  out assignee uuid, out reason text)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_parent uuid;
begin
  -- 1) 建立者（且本人不是離職者、且仍在職）
  if p_creator is not null and p_creator <> p_leaver
     and exists (select 1 from public.app_user where id = p_creator and status = 'active') then
    assignee := p_creator; reason := 'creator'; return;
  end if;
  -- 2) 該物件所屬部門的主管
  select d.manager_id into assignee from public.department d
   where d.id = p_dept and d.manager_id is not null and d.manager_id <> p_leaver
     and exists (select 1 from public.app_user u where u.id = d.manager_id and u.status='active');
  if assignee is not null then reason := 'dept_manager'; return; end if;
  -- 3) 上層部門主管
  select parent_id into v_parent from public.department where id = p_dept;
  select d.manager_id into assignee from public.department d
   where d.id = v_parent and d.manager_id is not null and d.manager_id <> p_leaver
     and exists (select 1 from public.app_user u where u.id = d.manager_id and u.status='active');
  if assignee is not null then reason := 'parent_dept_manager'; return; end if;
  -- 4) 任一在職管理者（最後防線，保證永遠有人收）
  select u.id into assignee from public.app_user u
   where u.status = 'active' and u.id <> p_leaver and u.role = 'company_admin'
   order by u.created_at limit 1;
  if assignee is not null then reason := 'company_admin'; return; end if;
  assignee := null; reason := 'unassigned';
end;
$$;

-- ── 停用前預覽：管理者可先看這個人身上有多少未結案的東西
create or replace function public.eip_pending_reassign(p_user_id uuid)
returns table(entity_type text, entity_id uuid, entity_title text,
              assignee_id uuid, assignee_name text, assignee_reason text)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if coalesce(current_role_name()::text,'') not in ('company_admin','dept_manager') then
    raise exception '權限不足：僅管理者或部門主管可查詢交接預覽';
  end if;

  return query
  with src as (
    -- 未完成的任務（負責人）
    select 'task'::text et, t.id eid, t.title ttl, t.created_by cre, t.department_id dep
      from public.task t join public.task_status s on s.id = t.status_id
     where t.owner_id = p_user_id and not s.is_done_state
    union all
    -- 未完成任務的協作者身分
    select 'task_collaborator', t.id, t.title, t.created_by, t.department_id
      from public.task_collaborator tc
      join public.task t on t.id = tc.task_id
      join public.task_status s on s.id = t.status_id
     where tc.user_id = p_user_id and not s.is_done_state and t.owner_id <> p_user_id
    union all
    -- 專案負責人
    select 'project', p.id, p.name, null::uuid, p.department_id
      from public.project p where p.owner_id = p_user_id
    union all
    -- 啟用中的常態工作規則負責人（不處理會每天繼續產生無人任務）
    select 'recurring_rule', r.id, r.title, r.created_by, r.department_id
      from public.recurring_rule r where r.owner_id = p_user_id and r.is_active
    union all
    -- 未結案的會議決議行動項
    select 'meeting_action_item', a.id, a.content, m.created_by, m.department_id
      from public.meeting_action_item a join public.meeting m on m.id = a.meeting_id
     where a.owner_id = p_user_id and a.status <> 'done'
    union all
    -- 被別人設為職務代理人
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
revoke all on function public.eip_notify_user(uuid, notification_type, notification_entity, uuid, text) from public, anon;
revoke all on function public.eip_handover_assignee(uuid, uuid, uuid) from public, anon;
;
