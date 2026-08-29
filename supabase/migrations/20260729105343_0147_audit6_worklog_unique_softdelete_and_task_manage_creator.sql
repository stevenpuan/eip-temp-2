-- ============================================================
-- 稽核第六輪 BLOCKER 兩項
-- A. work_log 唯一鍵沒有排除軟刪除 → 回收區有同日日誌時，勾選一定 23505
-- B. eip_can_manage_task 只看 owner_id（負責人），漏了 created_by（建立者）
--    → 建立者把任務指派給別人後無法加協作者（42501）
-- ============================================================

-- ---------- A. 唯一鍵改成「只約束未刪除的列」 ----------
alter table public.work_log
  drop constraint if exists work_log_tenant_id_user_id_log_date_key;

create unique index if not exists work_log_live_tenant_user_date_uniq
  on public.work_log (tenant_id, user_id, log_date)
  where deleted_at is null;

comment on index public.work_log_live_tenant_user_date_uniq is
  '一人一天只能有一份「未刪除」的日誌。軟刪除的舊日誌不再阻擋新建（0147）。';

-- eip_set_routine_item：insert 補上唯一鍵競態的收斂（雙擊／兩個分頁同時勾）
create or replace function public.eip_set_routine_item(
  p_date date,
  p_section text,
  p_source text default null,
  p_ref_id text default null,
  p_text text default null,
  p_done boolean default null,
  p_note text default null,
  p_link text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid(); v_log public.work_log;
  v_seed jsonb; v_col text; v_arr jsonb; v_new jsonb; v_hit int := 0;
  v_done int; v_total int; v_missing int;
begin
  if v_me is null then raise exception '需要登入身分'; end if;
  if p_section not in ('morning','afternoon','special') then
    raise exception '未知的區塊：%', p_section; end if;
  if p_done is null and p_note is null and p_link is null then
    raise exception '沒有要變更的內容'; end if;
  if p_ref_id is null and coalesce(p_text,'') = '' then
    raise exception '缺少可比對的項目識別（source+ref_id 或 text）'; end if;
  if p_date > (now() at time zone 'Asia/Taipei')::date then
    raise exception '不能填未來日期的日誌'; end if;
  if length(coalesce(p_note,'')) > 2000 then raise exception '執行內容最多 2000 字'; end if;
  if coalesce(p_link,'') <> '' and p_link !~ '^(https?://|file://|\\\\)' then
    raise exception '連結格式不對：請用 http(s)://、file:// 或 \\伺服器\分享路徑'; end if;
  if length(coalesce(p_link,'')) > 2000 then raise exception '連結最多 2000 字'; end if;

  select * into v_log from public.work_log
   where user_id = v_me and log_date = p_date and deleted_at is null;

  if v_log.id is null then
    v_seed := public.eip_worklog_seed(v_me, p_date);
    begin
      insert into public.work_log (user_id, department_id, log_date,
                                   routine_morning, routine_afternoon, special_items, status)
      select v_me, a.department_id, p_date,
             coalesce(v_seed->'morning','[]'::jsonb),
             coalesce(v_seed->'afternoon','[]'::jsonb),
             coalesce(v_seed->'special','[]'::jsonb), 'draft'
        from public.app_user a where a.id = v_me
      returning * into v_log;
    exception when unique_violation then
      -- 同一秒有另一個請求（雙擊、兩個分頁）已經建好了，抓現成的那筆繼續
      select * into v_log from public.work_log
       where user_id = v_me and log_date = p_date and deleted_at is null;
      if v_log.id is null then raise; end if;
    end;
  end if;

  v_col := case p_section when 'morning' then 'routine_morning'
                          when 'afternoon' then 'routine_afternoon' else 'special_items' end;
  v_arr := case p_section when 'morning' then v_log.routine_morning
                          when 'afternoon' then v_log.routine_afternoon else v_log.special_items end;
  if jsonb_typeof(coalesce(v_arr,'null'::jsonb)) <> 'array' then v_arr := '[]'::jsonb; end if;

  select coalesce(jsonb_agg(
           case when (p_ref_id is not null
                      and coalesce(e.value->>'source','') = coalesce(p_source,'')
                      and coalesce(e.value->>'ref_id','') = p_ref_id)
                  or (p_ref_id is null and coalesce(e.value->>'text','') = p_text)
                then (case when p_done is not null
                           then jsonb_set(e.value, '{done}', to_jsonb(p_done)) else e.value end)
                     || (case when p_note is not null then jsonb_build_object('note', p_note) else '{}'::jsonb end)
                     || (case when p_link is not null then jsonb_build_object('link', p_link) else '{}'::jsonb end)
                else e.value end
           order by e.ord), '[]'::jsonb),
         count(*) filter (where (p_ref_id is not null
                                 and coalesce(e.value->>'source','') = coalesce(p_source,'')
                                 and coalesce(e.value->>'ref_id','') = p_ref_id)
                             or (p_ref_id is null and coalesce(e.value->>'text','') = p_text))
    into v_new, v_hit
    from jsonb_array_elements(v_arr) with ordinality as e(value, ord);

  if v_hit = 0 then
    raise exception '在「%」找不到這個項目，可能已被移除或換了時段，請重新載入', p_section; end if;

  execute format('update public.work_log set %I = $1, updated_at = now() where id = $2', v_col)
    using v_new, v_log.id;
  select * into v_log from public.work_log where id = v_log.id;

  select count(*) filter (where coalesce((e.value->>'done')::boolean,false)), count(*),
         count(*) filter (where coalesce((e.value->>'req')::boolean,false)
                            and coalesce((e.value->>'done')::boolean,false)
                            and coalesce(trim(e.value->>'note'),'') = '')
    into v_done, v_total, v_missing
    from (select jsonb_array_elements(coalesce(v_log.routine_morning,'[]'::jsonb)) as value
          union all select jsonb_array_elements(coalesce(v_log.routine_afternoon,'[]'::jsonb))) e;

  return jsonb_build_object('ok', true, 'log_id', v_log.id, 'status', v_log.status,
    'routine_done', v_done, 'routine_total', v_total, 'missing_content', v_missing);
end;
$function$;

revoke all on function public.eip_set_routine_item(date,text,text,text,text,boolean,text,text) from public, anon;
grant execute on function public.eip_set_routine_item(date,text,text,text,text,boolean,text,text) to authenticated;

-- ---------- B. 建立者也能管理自己建立的任務 ----------
create or replace function public.eip_can_manage_task(p_task_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from public.task t
    where t.id = p_task_id and t.tenant_id = current_tenant_id() and (
      current_role_name() = 'company_admin'
      or t.owner_id = auth.uid()
      or t.created_by = auth.uid()   -- 0147：建立者指派給別人之後，仍要能加／改協作者
      or (current_role_name() = 'dept_manager' and t.department_id is not null
          and public.eip_user_can_scope_dept(t.department_id))
    )
  );
$function$;

revoke all on function public.eip_can_manage_task(uuid) from public, anon;
grant execute on function public.eip_can_manage_task(uuid) to authenticated;;
