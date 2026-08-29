-- ============================================================
-- 定案：「沒有主管，就往上上階的主管跑」
--
-- 正式庫部門樹有 6 個部門找不到直屬在職主管：
--   業務部（無主管）→ 總經理室／曾俊凱
--   學校課（無主管）→ 父部門業務部也沒有 → 跳兩階到 曾俊凱
--   財務部（無主管）→ 總經理室／曾俊凱
--   電宰會計課（主管孫倩筠已停用）→ 父部門財務部也沒有 → 跳兩階到 曾俊凱
--   分切課（無主管）→ 生產部／曾于庭
--   衛管課（無主管）→ 行政部／王儷瑾
--
-- 三個地方原本只往上「一階」就放棄：
--   1. eip_notification_recipients 安全網①只查 parent_id
--   2. eip_handover_assignee 步驟 3 只查 parent_id
--   3. eip_sweep_handover 3 天逾期升級直接 select manager_id
--      —— 既不往上找、也不檢查在職。無主管部門通知到 null；
--         電宰會計課會通知已停用的孫倩筠
--
-- 管轄／寫入權限不需要改：eip_user_can_scope_dept 是
-- 「我管的部門 ∪ 明確登記，各自往子樹展開」，曾俊凱管總經理室就自動涵蓋所有子部門。
-- 這次修的只是「誰收通知／誰接手」。
-- ============================================================

create or replace function public.eip_dept_effective_manager(
  p_dept uuid,
  p_exclude uuid default null   -- 排除某人（離職者本人不能接自己的交接）
) returns uuid
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_cur uuid := p_dept; v_mgr uuid; v_depth int := 0;
begin
  -- 從自己開始往上找第一個有在職主管的部門。
  -- 深度上限 20 是防呆：parent_id 被設成環狀時不能讓函式無限迴圈。
  while v_cur is not null and v_depth < 20 loop
    select d.manager_id into v_mgr
      from public.department d
      join public.app_user a on a.id = d.manager_id and a.status = 'active'
     where d.id = v_cur
       and (p_exclude is null or d.manager_id <> p_exclude);
    if v_mgr is not null then return v_mgr; end if;

    -- 0158 的明確登記督導（manager_id 只能一個，實務上會有第二位）
    select s.user_id into v_mgr
      from public.eip_dept_supervisor s
      join public.app_user a on a.id = s.user_id and a.status = 'active'
     where s.department_id = v_cur
       and (p_exclude is null or s.user_id <> p_exclude)
     order by s.created_at limit 1;
    if v_mgr is not null then return v_mgr; end if;

    select parent_id into v_cur from public.department where id = v_cur;
    v_depth := v_depth + 1;
  end loop;
  return null;
end;
$$;

revoke all on function public.eip_dept_effective_manager(uuid,uuid) from public, anon;
grant execute on function public.eip_dept_effective_manager(uuid,uuid) to authenticated;

comment on function public.eip_dept_effective_manager(uuid,uuid) is
  '該部門實際該負責的在職主管：自己 → 父 → 祖父…往上找第一個有在職 manager_id 或明確登記督導的部門（0159）。';

-- ---------- 1. 通知收件人 ----------
do $$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef('public.eip_notification_recipients(text,uuid,uuid,uuid,uuid[])'::regprocedure);
  v_old := 'if coalesce(array_length(v_mgr, 1), 0) = 0 then
          select parent_id into v_parent from public.department where id = p_department_id;
          v_mgr := array(
            select d.manager_id from public.department d
              join public.app_user a on a.id = d.manager_id and a.status = ''active''
             where d.id = v_parent);
        end if;';
  v_new := 'if coalesce(array_length(v_mgr, 1), 0) = 0 then
          -- 0159：不再只查父部門，一路往上找到第一個有在職主管的祖先。
          -- 學校課→業務部(無)→總經理室、電宰會計課→財務部(無)→總經理室 都要跳兩階。
          v_parent := public.eip_dept_effective_manager(p_department_id);
          v_mgr := case when v_parent is null then ''{}''::uuid[] else array[v_parent] end;
        end if;';
  if position(v_old in v_def) = 0 then
    raise exception 'eip_notification_recipients 的安全網①片段跟預期不同，請人工檢查';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;

revoke all on function public.eip_notification_recipients(text,uuid,uuid,uuid,uuid[]) from public, anon;
grant execute on function public.eip_notification_recipients(text,uuid,uuid,uuid,uuid[]) to authenticated;

-- ---------- 2. 交接接手人 ----------
create or replace function public.eip_handover_assignee(
  p_creator uuid, p_dept uuid, p_leaver uuid,
  out assignee uuid, out reason text
) returns record
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if p_creator is not null and p_creator <> p_leaver
     and exists (select 1 from public.app_user where id = p_creator and status = 'active') then
    assignee := p_creator; reason := 'creator'; return;
  end if;
  select d.manager_id into assignee from public.department d
   where d.id = p_dept and d.manager_id is not null and d.manager_id <> p_leaver
     and exists (select 1 from public.app_user u where u.id = d.manager_id and u.status='active');
  if assignee is not null then reason := 'dept_manager'; return; end if;
  -- 0159：一路往上找到第一個有在職主管的祖先（原本只查父部門一階）
  assignee := public.eip_dept_effective_manager(p_dept, p_leaver);
  if assignee is not null then reason := 'ancestor_dept_manager'; return; end if;
  select u.id into assignee from public.app_user u
   where u.status = 'active' and u.id <> p_leaver and u.role = 'company_admin'
   order by u.created_at limit 1;
  if assignee is not null then reason := 'company_admin'; return; end if;
  assignee := null; reason := 'unassigned';
end;
$$;

revoke all on function public.eip_handover_assignee(uuid,uuid,uuid) from public, anon, authenticated;

-- ---------- 3. 交接 3 天逾期升級 ----------
do $$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef('public.eip_sweep_handover()'::regprocedure);
  v_old := 'select manager_id into v_mgr from public.department where id = h.department_id;';
  v_new := '-- 0159：原本直接取 manager_id，既不往上找也不檢查在職 →
      -- 無主管的部門通知到 null，電宰會計課會通知已停用的孫倩筠。
      v_mgr := public.eip_dept_effective_manager(h.department_id, h.leaver_id);';
  if position(v_old in v_def) = 0 then
    raise exception 'eip_sweep_handover 的 3 天升級片段跟預期不同，請人工檢查';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;

revoke all on function public.eip_sweep_handover() from public, anon, authenticated;;
