-- ============================================================
-- 0139 從今天的日誌移除單一項目
--
-- 工作日誌每一項都有 X 可以移除，但「我的工作區」的今日例行沒有 ——
-- 使用者反映例行工作在工作區沒有刪除功能。補上，並且同樣只有一份實作。
--
-- 語意：移除的是「今天這一筆日誌裡的項目」，不是刪掉個人例行範本。
-- 範本要停用或刪除請到「個人例行」頁。明天照樣會帶進來；
-- 按工作日誌的「同步今日任務」也會把它帶回來（與現有行為一致）。
-- ============================================================
create or replace function public.eip_remove_routine_item(
  p_date date,
  p_section text,
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
  v_col text; v_arr jsonb; v_new jsonb; v_hit int;
  v_done int; v_total int; v_missing int;
begin
  if v_me is null then raise exception '需要登入身分'; end if;
  if p_section not in ('morning','afternoon','special') then
    raise exception '未知的區塊：%', p_section;
  end if;
  if p_ref_id is null and coalesce(p_text,'') = '' then
    raise exception '缺少可比對的項目識別（source+ref_id 或 text）';
  end if;

  select * into v_log from public.work_log
   where user_id = v_me and log_date = p_date and deleted_at is null;
  -- 還沒有日誌就沒有東西可移除；不要為了刪一項而建出一筆空日誌
  if v_log.id is null then
    return jsonb_build_object('ok', true, 'log_id', null,
                              'routine_done', 0, 'routine_total', 0, 'missing_content', 0);
  end if;

  v_col := case p_section when 'morning' then 'routine_morning'
                          when 'afternoon' then 'routine_afternoon'
                          else 'special_items' end;
  v_arr := case p_section when 'morning' then v_log.routine_morning
                          when 'afternoon' then v_log.routine_afternoon
                          else v_log.special_items end;
  if jsonb_typeof(coalesce(v_arr,'null'::jsonb)) <> 'array' then v_arr := '[]'::jsonb; end if;

  select coalesce(jsonb_agg(e.value order by e.ord), '[]'::jsonb),
         (select count(*) from jsonb_array_elements(v_arr) as x(value)
           where (p_ref_id is not null
                  and coalesce(x.value->>'source','') = coalesce(p_source,'')
                  and coalesce(x.value->>'ref_id','') = p_ref_id)
              or (p_ref_id is null and coalesce(x.value->>'text','') = p_text))
    into v_new, v_hit
    from jsonb_array_elements(v_arr) with ordinality as e(value, ord)
   where not ((p_ref_id is not null
               and coalesce(e.value->>'source','') = coalesce(p_source,'')
               and coalesce(e.value->>'ref_id','') = p_ref_id)
           or (p_ref_id is null and coalesce(e.value->>'text','') = p_text));

  if coalesce(v_hit,0) = 0 then
    raise exception '在「%」找不到這個項目，可能已被移除，請重新載入', p_section;
  end if;

  execute format('update public.work_log set %I = $1, updated_at = now() where id = $2', v_col)
    using v_new, v_log.id;

  select * into v_log from public.work_log where id = v_log.id;

  select count(*) filter (where coalesce((e.value->>'done')::boolean,false)),
         count(*),
         count(*) filter (where coalesce((e.value->>'req')::boolean,false)
                            and coalesce((e.value->>'done')::boolean,false)
                            and coalesce(trim(e.value->>'note'),'') = '')
    into v_done, v_total, v_missing
    from (select jsonb_array_elements(coalesce(v_log.routine_morning,'[]'::jsonb)) as value
          union all
          select jsonb_array_elements(coalesce(v_log.routine_afternoon,'[]'::jsonb))) e;

  return jsonb_build_object('ok', true, 'log_id', v_log.id,
                            'routine_done', v_done, 'routine_total', v_total,
                            'missing_content', v_missing);
end;
$function$;

revoke all on function public.eip_remove_routine_item(date, text, text, text, text) from public, anon;
grant execute on function public.eip_remove_routine_item(date, text, text, text, text) to authenticated, service_role;;
