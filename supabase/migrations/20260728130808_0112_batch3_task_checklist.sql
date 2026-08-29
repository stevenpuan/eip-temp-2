-- 0112 批3：任務子項清單 task_checklist
-- 設計決策（見整合差異報告）：
--  1. 用新表，不沿用 task.parent_task_id —— 子任務當成 task 會污染看板（現況已被迫 filter 掉）
--  2. 勾選語意＝「今天有做、納入回報」，不是百分比 → 不自動改 task.progress
--  3. 不做「任務範本自動展開子項」（task_type.default_steps 維持現況，確定不做）

create table if not exists public.task_checklist (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  task_id     uuid not null references public.task(id) on delete cascade,
  title       text not null,
  is_done     boolean not null default false,
  done_at     timestamptz,
  done_by     uuid references public.app_user(id) on delete set null,
  sort_order  int not null default 0,
  created_by  uuid references public.app_user(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.task_checklist is
  '任務子項清單。勾選＝今天有做、納入回報，不代表百分比，不影響 task.progress';

create index if not exists idx_task_checklist_task
  on public.task_checklist(task_id, sort_order);
create index if not exists idx_task_checklist_open
  on public.task_checklist(task_id) where not is_done;

-- task_id 是 CASCADE：任務軟刪除時子項保留（還原後子項跟著回來），
-- 建立者按「永久刪除」走 eip_purge_deleted 時 guard 放行真 DELETE，子項一併清除。
-- done_by / created_by 一律 SET NULL，不重蹈 H6（CASCADE 被 guard 靜默取消）的錯。

------------------------------------------------------------------
-- 預設值 trigger：tenant_id / created_by / sort_order 由 DB 補，前端不用塞
------------------------------------------------------------------
create or replace function public.eip_fill_task_checklist_defaults()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    if new.created_by is null then new.created_by := auth.uid(); end if;
    if new.tenant_id is null then
      select tenant_id into new.tenant_id from public.task where id = new.task_id;
      new.tenant_id := coalesce(new.tenant_id, '00000000-0000-0000-0000-000000000001');
    end if;
    if coalesce(new.sort_order, 0) = 0 then
      select coalesce(max(sort_order), 0) + 10 into new.sort_order
        from public.task_checklist where task_id = new.task_id;
    end if;
  end if;

  -- 勾選／取消勾選時自動維護完成資訊
  if tg_op = 'UPDATE' and new.is_done is distinct from old.is_done then
    if new.is_done then
      new.done_at := now();
      new.done_by := coalesce(new.done_by, auth.uid());
    else
      new.done_at := null;
      new.done_by := null;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

revoke execute on function public.eip_fill_task_checklist_defaults() from anon, authenticated;

drop trigger if exists trg_task_checklist_defaults on public.task_checklist;
create trigger trg_task_checklist_defaults
  before insert or update on public.task_checklist
  for each row execute function public.eip_fill_task_checklist_defaults();

------------------------------------------------------------------
-- 可編輯判定：與 task_update_policy 同一組人（owner / 建立者 / 協作者 / admin / 部門主管），
-- 並排除已軟刪除的任務。eip_can_manage_task 少了「建立者」與「協作者」且不看 deleted_at，
-- 所以這裡另立一支，不共用。
------------------------------------------------------------------
create or replace function public.eip_can_edit_task_checklist(p_task_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.task t
     where t.id = p_task_id
       and t.deleted_at is null
       and t.tenant_id = current_tenant_id()
       and (
         current_role_name() = 'company_admin'
         or t.owner_id = auth.uid()
         or t.created_by = auth.uid()
         or (current_role_name() = 'dept_manager' and t.department_id is not null
             and public.eip_user_can_scope_dept(t.department_id))
         or public.eip_is_task_collaborator(t.id)
       )
  );
$function$;

grant execute on function public.eip_can_edit_task_checklist(uuid) to authenticated;
revoke execute on function public.eip_can_edit_task_checklist(uuid) from anon;

------------------------------------------------------------------
-- RLS：可見範圍完全跟隨母任務。
-- 政策內的 task 子查詢會套用 task 自己的 RLS（含 deleted_at is null），
-- 所以「看得到任務就看得到子項」是自動成立的，不需要複製一份 task_read 的邏輯。
------------------------------------------------------------------
alter table public.task_checklist enable row level security;

drop policy if exists task_checklist_read   on public.task_checklist;
drop policy if exists task_checklist_insert on public.task_checklist;
drop policy if exists task_checklist_update on public.task_checklist;
drop policy if exists task_checklist_delete on public.task_checklist;

create policy task_checklist_read on public.task_checklist
  for select to authenticated
  using (exists (select 1 from public.task t where t.id = task_checklist.task_id));

create policy task_checklist_insert on public.task_checklist
  for insert to authenticated
  with check (public.eip_can_edit_task_checklist(task_id));

create policy task_checklist_update on public.task_checklist
  for update to authenticated
  using (public.eip_can_edit_task_checklist(task_id))
  with check (public.eip_can_edit_task_checklist(task_id));

create policy task_checklist_delete on public.task_checklist
  for delete to authenticated
  using (public.eip_can_edit_task_checklist(task_id));

revoke all on public.task_checklist from anon;
grant select, insert, update, delete on public.task_checklist to authenticated;

------------------------------------------------------------------
-- 批次重排序 RPC：拖曳排序時一次寫回，避免 N 次 PATCH
------------------------------------------------------------------
create or replace function public.eip_reorder_task_checklist(p_task_id uuid, p_ids uuid[])
 returns int
 language plpgsql
 set search_path to 'public'
as $function$
declare v_n int := 0;
begin
  if not public.eip_can_edit_task_checklist(p_task_id) then
    raise exception '權限不足：無法調整此任務的子項順序';
  end if;
  update public.task_checklist c
     set sort_order = (idx.ord) * 10
    from unnest(p_ids) with ordinality as idx(id, ord)
   where c.id = idx.id and c.task_id = p_task_id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

grant execute on function public.eip_reorder_task_checklist(uuid, uuid[]) to authenticated;
revoke execute on function public.eip_reorder_task_checklist(uuid, uuid[]) from anon;

------------------------------------------------------------------
-- 子項進度摘要 view：看板卡片顯示「3/5」用，避免前端每張卡各發一次查詢
------------------------------------------------------------------
create or replace view public.task_checklist_summary as
  select task_id,
         count(*)::int                                as total,
         count(*) filter (where is_done)::int         as done,
         count(*) filter (where not is_done)::int     as open
    from public.task_checklist
   group by task_id;

grant select on public.task_checklist_summary to authenticated;
revoke all on public.task_checklist_summary from anon;;
