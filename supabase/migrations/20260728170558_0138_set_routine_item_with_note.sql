-- ============================================================
-- 0138 例行項目的單筆設定（done + note 執行內容）
--
-- 需求：需填執行內容的例行項目，要能直接在「我的工作區」填，不用跳工作日誌。
--
-- 做法上唯一要小心的是「不要變成第二份實作」：
--   ・eip_set_routine_item 是完整實作（可設 done、可設 note，null = 不改）
--   ・eip_toggle_routine_item 保留原簽章但改成呼叫上面那支，
--     所以線上已部署的前端不會壞，而邏輯只有一份。
--   ・不用「在舊函式加預設參數」的方式擴充 —— 那會產生 overload 歧義。
-- ============================================================
create or replace function public.eip_set_routine_item(
  p_date date,
  p_section text,                     -- 'morning' | 'afternoon' | 'special'
  p_source text default null,
  p_ref_id text default null,
  p_text text default null,
  p_done boolean default null,        -- null = 不改
  p_note text default null)           -- null = 不改；'' = 清空
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid();
  v_log public.work_log;
  v_seed jsonb;
  v_col text;
  v_arr jsonb;
  v_new jsonb;
  v_hit int := 0;
  v_done int; v_total int; v_missing int;
begin
  if v_me is null then raise exception '需要登入身分'; end if;
  if p_section not in ('morning','afternoon','special') then
    raise exception '未知的區塊：%', p_section;
  end if;
  if p_done is null and p_note is null then
    raise exception '沒有要變更的內容';
  end if;
  if p_ref_id is null and coalesce(p_text,'') = '' then
    raise exception '缺少可比對的項目識別（source+ref_id 或 text）';
  end if;
  if p_date > (now() at time zone 'Asia/Taipei')::date then
    raise exception '不能填未來日期的日誌';
  end if;
  if length(coalesce(p_note,'')) > 2000 then
    raise exception '執行內容最多 2000 字';
  end if;

  select * into v_log from public.work_log
   where user_id = v_me and log_date = p_date and deleted_at is null;

  -- 當天還沒有日誌就先用 seed 建一筆草稿，讓使用者可以直接從工作區操作
  if v_log.id is null then
    v_seed := public.eip_worklog_seed(v_me, p_date);
    insert into public.work_log (user_id, department_id, log_date,
                                 routine_morning, routine_afternoon, special_items, status)
    select v_me, a.department_id, p_date,
           coalesce(v_seed->'morning','[]'::jsonb),
           coalesce(v_seed->'afternoon','[]'::jsonb),
           coalesce(v_seed->'special','[]'::jsonb),
           'draft'
      from public.app_user a where a.id = v_me
    returning * into v_log;
  end if;

  v_col := case p_section when 'morning' then 'routine_morning'
                          when 'afternoon' then 'routine_afternoon'
                          else 'special_items' end;
  v_arr := case p_section when 'morning' then v_log.routine_morning
                          when 'afternoon' then v_log.routine_afternoon
                          else v_log.special_items end;
  if jsonb_typeof(coalesce(v_arr,'null'::jsonb)) <> 'array' then v_arr := '[]'::jsonb; end if;

  -- 只動命中那一項的指定欄位，其餘原封不動 ——
  -- 這樣工作日誌那邊同時在編輯的其他項目不會被蓋掉
  select coalesce(jsonb_agg(
           case when (p_ref_id is not null
                      and coalesce(e.value->>'source','') = coalesce(p_source,'')
                      and coalesce(e.value->>'ref_id','') = p_ref_id)
                  or (p_ref_id is null
                      and coalesce(e.value->>'text','') = p_text)
                then (case when p_done is not null
                           then jsonb_set(e.value, '{done}', to_jsonb(p_done))
                           else e.value end)
                     || (case when p_note is not null
                              then jsonb_build_object('note', p_note)
                              else '{}'::jsonb end)
                else e.value end
           order by e.ord), '[]'::jsonb),
         count(*) filter (where (p_ref_id is not null
                                 and coalesce(e.value->>'source','') = coalesce(p_source,'')
                                 and coalesce(e.value->>'ref_id','') = p_ref_id)
                             or (p_ref_id is null
                                 and coalesce(e.value->>'text','') = p_text))
    into v_new, v_hit
    from jsonb_array_elements(v_arr) with ordinality as e(value, ord);

  if v_hit = 0 then
    raise exception '在「%」找不到這個項目，可能已被移除或換了時段，請重新載入', p_section;
  end if;

  execute format('update public.work_log set %I = $1, updated_at = now() where id = $2', v_col)
    using v_new, v_log.id;

  select * into v_log from public.work_log where id = v_log.id;

  -- 例行區（上午＋下午）的完成度，以及「已勾但需填卻沒寫」的筆數，
  -- 讓前端可以直接顯示，不必自己再算一次
  select count(*) filter (where coalesce((e.value->>'done')::boolean,false)),
         count(*),
         count(*) filter (where coalesce((e.value->>'req')::boolean,false)
                            and coalesce((e.value->>'done')::boolean,false)
                            and coalesce(trim(e.value->>'note'),'') = '')
    into v_done, v_total, v_missing
    from (select jsonb_array_elements(coalesce(v_log.routine_morning,'[]'::jsonb)) as value
          union all
          select jsonb_array_elements(coalesce(v_log.routine_afternoon,'[]'::jsonb))) e;

  return jsonb_build_object(
    'ok', true, 'log_id', v_log.id, 'status', v_log.status,
    'routine_done', v_done, 'routine_total', v_total, 'missing_content', v_missing);
end;
$function$;

revoke all on function public.eip_set_routine_item(date, text, text, text, text, boolean, text) from public, anon;
grant execute on function public.eip_set_routine_item(date, text, text, text, text, boolean, text) to authenticated, service_role;


-- 保留原簽章（線上前端還在用），內容改成委派，避免同一件事兩份實作
create or replace function public.eip_toggle_routine_item(
  p_date date,
  p_section text,
  p_done boolean,
  p_source text default null,
  p_ref_id text default null,
  p_text text default null)
 returns jsonb
 language sql
 security definer
 set search_path to 'public'
as $function$
  select public.eip_set_routine_item(
           p_date, p_section, p_source, p_ref_id, p_text, p_done, null);
$function$;

revoke all on function public.eip_toggle_routine_item(date, text, boolean, text, text, text) from public, anon;
grant execute on function public.eip_toggle_routine_item(date, text, boolean, text, text, text) to authenticated, service_role;;
