-- 0086: 工作日誌自動帶入來源（B）—— 把 seed 邏輯集中在 DB，前後端只有一份定義
-- 例行區：個人例行範本（依時段）＋ 常態工作當日任務
-- 特殊區：所有未完成的任務（負責或協作，非常態產生）＋ 今日完成的任務 ＋ 尚未轉任務的會議決議
-- 每一項都帶 source + ref_id，作為重複同步時的去重鍵（不再用文字比對）

create or replace function public.eip_worklog_seed(p_user_id uuid, p_date date default current_date)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_morning jsonb := '[]'::jsonb;
  v_afternoon jsonb := '[]'::jsonb;
  v_special jsonb := '[]'::jsonb;
  v_status text;
begin
  if p_user_id is null then p_user_id := auth.uid(); end if;
  if auth.uid() is not null and p_user_id <> auth.uid()
     and coalesce(current_role_name()::text,'') not in ('company_admin','dept_manager') then
    raise exception '權限不足：只能帶入自己的工作日誌';
  end if;

  select status into v_status from public.app_user where id = p_user_id;
  if v_status is distinct from 'active' then
    return jsonb_build_object('morning','[]'::jsonb,'afternoon','[]'::jsonb,'special','[]'::jsonb);
  end if;

  -- ① 個人例行範本（上午 / 全天 → 上午區；下午 → 下午區）
  select coalesce(jsonb_agg(x order by x->>'ord'), '[]'::jsonb) into v_morning
  from (
    select jsonb_build_object(
             'text', pr.title, 'done', false, 'note', '',
             'source','personal_routine', 'ref_id', pr.id::text, 'link','',
             'req', pr.require_content, 'ord', lpad(pr.sort_order::text, 6, '0')) as x
    from public.personal_routine pr
    where pr.user_id = p_user_id and pr.is_active
      and pr.time_slot in ('morning','allday')
      and public.eip_personal_routine_due_on(pr, p_date)
  ) s;

  select coalesce(jsonb_agg(x order by x->>'ord'), '[]'::jsonb) into v_afternoon
  from (
    select jsonb_build_object(
             'text', pr.title, 'done', false, 'note', '',
             'source','personal_routine', 'ref_id', pr.id::text, 'link','',
             'req', pr.require_content, 'ord', lpad(pr.sort_order::text, 6, '0')) as x
    from public.personal_routine pr
    where pr.user_id = p_user_id and pr.is_active
      and pr.time_slot = 'afternoon'
      and public.eip_personal_routine_due_on(pr, p_date)
  ) s;

  -- ② 常態工作（部門／全公司週期規則）當日產生的任務 → 併入上午例行區
  v_morning := v_morning || (
    select coalesce(jsonb_agg(jsonb_build_object(
             'text', t.title, 'done', coalesce(t.progress,0) >= 100,
             'note', coalesce(t.description,''),
             'source','recurring', 'ref_id', t.id::text, 'link','', 'req', false)), '[]'::jsonb)
    from public.task t
    where t.owner_id = p_user_id and t.recurring_rule_id is not null and t.occurrence_date = p_date);

  -- ③ 特殊工作：未完成（負責或協作）＋ 當日完成；隔天起，昨日完成者自動不再出現
  v_special := (
    select coalesce(jsonb_agg(jsonb_build_object(
             'text', d.title, 'done', d.is_done, 'note','',
             'source', d.src, 'ref_id', d.id::text, 'link','', 'req', false)
           order by d.is_done, d.due_date nulls last), '[]'::jsonb)
    from (
      -- 我負責、未完成
      select t.id, t.title, false as is_done, t.due_date, 'task'::text as src
        from public.task t join public.task_status s on s.id = t.status_id
       where t.owner_id = p_user_id and t.recurring_rule_id is null and not s.is_done_state
      union
      -- 我協作、未完成
      select t.id, t.title, false, t.due_date, 'task'
        from public.task_collaborator tc
        join public.task t on t.id = tc.task_id
        join public.task_status s on s.id = t.status_id
       where tc.user_id = p_user_id and t.recurring_rule_id is null and not s.is_done_state
         and t.owner_id <> p_user_id
      union
      -- 今日完成
      select t.id, t.title, true, t.due_date, 'task'
        from public.task t
       where t.owner_id = p_user_id and t.recurring_rule_id is null
         and t.completed_at >= p_date::timestamptz at time zone 'Asia/Taipei'
         and t.completed_at <  (p_date + 1)::timestamptz at time zone 'Asia/Taipei'
      union
      -- 會議決議：指派給我、尚未結案、且尚未轉成任務（已轉任務者由上方 task 帶入，避免重複）
      select a.id, a.content, false, a.due_date, 'meeting_action'
        from public.meeting_action_item a
       where a.owner_id = p_user_id and a.status <> 'done' and a.linked_task_id is null
    ) d);

  return jsonb_build_object('morning', v_morning, 'afternoon', v_afternoon, 'special', v_special);
end;
$$;

revoke all on function public.eip_worklog_seed(uuid, date) from public, anon;
grant execute on function public.eip_worklog_seed(uuid, date) to authenticated;
;
