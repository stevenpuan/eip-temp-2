-- ============================================================
-- 0137「今天有做」勾選的唯一寫入實作
--
-- 為什麼要這支：
--  1) 決定讓「我的工作區」也能直接勾今天的例行。若前端各寫一套改 jsonb 的邏輯，
--     就會變成同一個欄位兩份實作 —— 這正是之前通知重複那件事的成因。
--     所以「勾選」這個動作只有這一份實作，工作區與工作日誌都呼叫它。
--  2) 順手補掉一個真的洞：工作日誌原本勾選只改前端 state，要按「儲存草稿」才進 DB。
--     使用者勾完直接關掉，資料就沒了，部門例行彙總與績效也讀不到。
--     走這支 RPC 是「勾了就存」。
--
-- 特性：
--  ・當天還沒有日誌 → 用 eip_worklog_seed 先建一筆（草稿），再套用勾選
--  ・只動命中那一項的 done，不整批覆寫，所以不會蓋掉同時在編輯的說明文字
--  ・有 source+ref_id 的用它當鍵；手動新增的項目退回比對 text（與前端 itemKey 同規則）
--  ・work_log_item 正規化投影由 trg_work_log_materialize_items 自動跟上
-- ============================================================
create or replace function public.eip_toggle_routine_item(
  p_date date,
  p_section text,          -- 'morning' | 'afternoon' | 'special'
  p_done boolean,
  p_source text default null,
  p_ref_id text default null,
  p_text text default null)
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
  v_done int; v_total int;
begin
  if v_me is null then raise exception '需要登入身分'; end if;
  if p_section not in ('morning','afternoon','special') then
    raise exception '未知的區塊：%', p_section;
  end if;
  if p_ref_id is null and coalesce(p_text,'') = '' then
    raise exception '缺少可比對的項目識別（source+ref_id 或 text）';
  end if;
  if p_date > (now() at time zone 'Asia/Taipei')::date then
    raise exception '不能填未來日期的日誌';
  end if;

  select * into v_log from public.work_log
   where user_id = v_me and log_date = p_date and deleted_at is null;

  -- 當天還沒有日誌就先用 seed 建一筆草稿，讓使用者可以直接從工作區勾
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

  select coalesce(jsonb_agg(
           case when (p_ref_id is not null
                      and coalesce(e.value->>'source','') = coalesce(p_source,'')
                      and coalesce(e.value->>'ref_id','') = p_ref_id)
                  or (p_ref_id is null
                      and coalesce(e.value->>'text','') = p_text)
                then jsonb_set(e.value, '{done}', to_jsonb(p_done))
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

  select count(*) filter (where coalesce((e.value->>'done')::boolean,false)), count(*)
    into v_done, v_total
    from (select jsonb_array_elements(coalesce(v_log.routine_morning,'[]'::jsonb)) as value
          union all
          select jsonb_array_elements(coalesce(v_log.routine_afternoon,'[]'::jsonb))) e;

  return jsonb_build_object(
    'ok', true, 'log_id', v_log.id, 'status', v_log.status,
    'routine_done', v_done, 'routine_total', v_total);
end;
$function$;

revoke all on function public.eip_toggle_routine_item(date, text, boolean, text, text, text) from public, anon;
grant execute on function public.eip_toggle_routine_item(date, text, boolean, text, text, text) to authenticated, service_role;


-- ============================================================
-- 「我的工作區」今日例行的讀取端。
-- 前端不要再自己判斷「有日誌讀日誌、沒日誌讀 seed」——那是第二份實作。
-- 這支統一回今天該做的例行（上午＋下午）與勾選狀態。
-- ============================================================
create or replace function public.eip_my_routine_today(p_date date default null)
 returns table(section text, sort_order integer, text text, done boolean,
               note text, source text, ref_id text, require_content boolean)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_me uuid := auth.uid(); v_log public.work_log; v_seed jsonb;
begin
  if v_me is null then raise exception '需要登入身分'; end if;
  p_date := coalesce(p_date, (now() at time zone 'Asia/Taipei')::date);

  select * into v_log from public.work_log
   where user_id = v_me and log_date = p_date and deleted_at is null;

  if v_log.id is not null then
    return query
    select s.sec, (e.ord - 1)::int,
           coalesce(e.value->>'text',''), coalesce((e.value->>'done')::boolean, false),
           nullif(e.value->>'note',''), nullif(e.value->>'source',''),
           nullif(e.value->>'ref_id',''), coalesce((e.value->>'req')::boolean, false)
      from (values ('morning', coalesce(v_log.routine_morning,'[]'::jsonb)),
                   ('afternoon', coalesce(v_log.routine_afternoon,'[]'::jsonb))) s(sec, arr)
      cross join lateral jsonb_array_elements(s.arr) with ordinality as e(value, ord)
     where jsonb_typeof(s.arr) = 'array';
  else
    -- 還沒建日誌 → 給預覽（全部未勾）。使用者一勾，eip_toggle_routine_item 會建草稿。
    v_seed := public.eip_worklog_seed(v_me, p_date);
    return query
    select s.sec, (e.ord - 1)::int,
           coalesce(e.value->>'text',''), false,
           nullif(e.value->>'note',''), nullif(e.value->>'source',''),
           nullif(e.value->>'ref_id',''), coalesce((e.value->>'req')::boolean, false)
      from (values ('morning', coalesce(v_seed->'morning','[]'::jsonb)),
                   ('afternoon', coalesce(v_seed->'afternoon','[]'::jsonb))) s(sec, arr)
      cross join lateral jsonb_array_elements(s.arr) with ordinality as e(value, ord)
     where jsonb_typeof(s.arr) = 'array';
  end if;
end;
$function$;

revoke all on function public.eip_my_routine_today(date) from public, anon;
grant execute on function public.eip_my_routine_today(date) to authenticated, service_role;;
