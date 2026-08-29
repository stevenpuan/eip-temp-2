-- ============================================================
-- 稽核第七輪 BLOCKER：日誌建立之後才新增的例行範本，當天永遠不會出現
--
-- 實證（王柔蓁，2026-07-29，時間戳精確對得上）：
--   04:57:43 / 04:58:23 / 04:58:43 建了 3 個範本
--   04:59:19 日誌被建立 → jsonb 只快照了那 3 項
--   05:00:01 / 05:01:06 又建了 2 個範本 → 這兩項今天永遠不出現
-- 而 eip_dept_routine_summary 的 expected 是即時從範本算的（5），
-- done 只能從日誌來（最多 3）→ 她的達成率永遠卡在 60%，
-- 而且她會回報「我新增的例行沒出現」。
--
-- 上線前這一定會大量發生：所有人都在今天建範本，多數人的日誌已經先存在了。
--
-- 不能單純「補齊缺的項目」，因為 eip_remove_routine_item 是把元素從 jsonb
-- 真的刪掉（使用者要的「今天不做這項」）。補齊會把刻意移除的項目救回來。
-- 所以兩件一起改：移除改成墓碑標記，補齊時跳過墓碑。
-- ============================================================

-- ---------- 1. 移除改成墓碑（只對範本／常態衍生的項目） ----------
create or replace function public.eip_remove_routine_item(
  p_date date, p_section text, p_source text default null,
  p_ref_id text default null, p_text text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_me uuid := auth.uid(); v_log public.work_log;
  v_col text; v_arr jsonb; v_new jsonb; v_hit int;
  v_done int; v_total int; v_missing int;
  v_tombstone boolean;
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
  if v_log.id is null then
    return jsonb_build_object('ok', true, 'log_id', null,
                              'routine_done', 0, 'routine_total', 0, 'missing_content', 0);
  end if;

  -- 有 source+ref_id 的項目是範本／常態工作衍生的，會被補齊機制重新長回來，
  -- 所以要留墓碑。使用者自己打的一次性項目沒有來源，直接刪掉就好。
  v_tombstone := (p_ref_id is not null and coalesce(p_source,'') <> '' and p_section <> 'special');

  v_col := case p_section when 'morning' then 'routine_morning'
                          when 'afternoon' then 'routine_afternoon'
                          else 'special_items' end;
  v_arr := case p_section when 'morning' then v_log.routine_morning
                          when 'afternoon' then v_log.routine_afternoon
                          else v_log.special_items end;
  if jsonb_typeof(coalesce(v_arr,'null'::jsonb)) <> 'array' then v_arr := '[]'::jsonb; end if;

  select count(*) into v_hit
    from jsonb_array_elements(v_arr) as x(value)
   where not coalesce((x.value->>'removed')::boolean, false)
     and ((p_ref_id is not null
           and coalesce(x.value->>'source','') = coalesce(p_source,'')
           and coalesce(x.value->>'ref_id','') = p_ref_id)
       or (p_ref_id is null and coalesce(x.value->>'text','') = p_text));

  if coalesce(v_hit,0) = 0 then
    raise exception '在「%」找不到這個項目，可能已被移除，請重新載入', p_section;
  end if;

  if v_tombstone then
    -- 標記為已移除，並清掉勾選與內容（今天不做這項）
    select coalesce(jsonb_agg(
             case when coalesce(e.value->>'source','') = coalesce(p_source,'')
                   and coalesce(e.value->>'ref_id','') = p_ref_id
                  then e.value || jsonb_build_object('removed', true, 'done', false)
                  else e.value end
             order by e.ord), '[]'::jsonb)
      into v_new
      from jsonb_array_elements(v_arr) with ordinality as e(value, ord);
  else
    select coalesce(jsonb_agg(e.value order by e.ord), '[]'::jsonb)
      into v_new
      from jsonb_array_elements(v_arr) with ordinality as e(value, ord)
     where not ((p_ref_id is not null
                 and coalesce(e.value->>'source','') = coalesce(p_source,'')
                 and coalesce(e.value->>'ref_id','') = p_ref_id)
             or (p_ref_id is null and coalesce(e.value->>'text','') = p_text));
  end if;

  execute format('update public.work_log set %I = $1, updated_at = now() where id = $2', v_col)
    using v_new, v_log.id;
  select * into v_log from public.work_log where id = v_log.id;

  -- 統計一律排除墓碑
  select count(*) filter (where coalesce((e.value->>'done')::boolean,false)),
         count(*),
         count(*) filter (where coalesce((e.value->>'req')::boolean,false)
                            and coalesce((e.value->>'done')::boolean,false)
                            and coalesce(trim(e.value->>'note'),'') = '')
    into v_done, v_total, v_missing
    from (select jsonb_array_elements(coalesce(v_log.routine_morning,'[]'::jsonb)) as value
          union all
          select jsonb_array_elements(coalesce(v_log.routine_afternoon,'[]'::jsonb))) e
   where not coalesce((e.value->>'removed')::boolean, false);

  return jsonb_build_object('ok', true, 'log_id', v_log.id,
                            'routine_done', v_done, 'routine_total', v_total,
                            'missing_content', v_missing);
end;
$$;

revoke all on function public.eip_remove_routine_item(date,text,text,text,text) from public, anon;
grant execute on function public.eip_remove_routine_item(date,text,text,text,text) to authenticated;

-- ---------- 2. 補齊：把日誌建立後才新增的到期範本補進草稿 ----------
create or replace function public.eip_topup_routine_log(p_user_id uuid, p_date date)
returns int
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_log public.work_log; v_seed jsonb; v_added int := 0;
  v_sec text; v_col text; v_cur jsonb; v_add jsonb;
begin
  select * into v_log from public.work_log
   where user_id = p_user_id and log_date = p_date and deleted_at is null;
  -- 沒有日誌就不用補（seed 當下就是最新的）；已送出的不改，那會改寫歷史
  if v_log.id is null or v_log.status <> 'draft' then return 0; end if;

  v_seed := public.eip_worklog_seed(p_user_id, p_date);

  foreach v_sec in array array['morning','afternoon'] loop
    v_col := case v_sec when 'morning' then 'routine_morning' else 'routine_afternoon' end;
    v_cur := case v_sec when 'morning' then coalesce(v_log.routine_morning,'[]'::jsonb)
                        else coalesce(v_log.routine_afternoon,'[]'::jsonb) end;
    if jsonb_typeof(v_cur) <> 'array' then v_cur := '[]'::jsonb; end if;

    -- seed 裡有、但日誌裡（含墓碑）找不到同一個 source+ref_id 的，就是新加的
    select coalesce(jsonb_agg(s.value order by s.ord), '[]'::jsonb) into v_add
      from jsonb_array_elements(coalesce(v_seed->v_sec,'[]'::jsonb)) with ordinality as s(value, ord)
     where coalesce(s.value->>'ref_id','') <> ''
       and not exists (
         select 1 from jsonb_array_elements(v_cur) as c(value)
          where coalesce(c.value->>'source','') = coalesce(s.value->>'source','')
            and coalesce(c.value->>'ref_id','')  = coalesce(s.value->>'ref_id',''));

    if jsonb_array_length(v_add) > 0 then
      v_added := v_added + jsonb_array_length(v_add);
      execute format('update public.work_log set %I = $1, updated_at = now() where id = $2', v_col)
        using v_cur || v_add, v_log.id;
      select * into v_log from public.work_log where id = v_log.id;
    end if;
  end loop;

  return v_added;
end;
$$;

revoke all on function public.eip_topup_routine_log(uuid,date) from public, anon, authenticated;

-- ---------- 3. eip_my_routine_today：先補齊、再回傳，並濾掉墓碑 ----------
-- 原本是 STABLE，補齊要寫入所以改成 VOLATILE（預設）
drop function if exists public.eip_my_routine_today(date);

create function public.eip_my_routine_today(p_date date default null)
returns table (
  section text, idx int, text text, done boolean,
  note text, link text, source text, ref_id text, req boolean
)
language plpgsql security definer set search_path to 'public'
as $$
declare v_me uuid := auth.uid(); v_log public.work_log; v_seed jsonb;
begin
  if v_me is null then raise exception '需要登入身分'; end if;
  p_date := coalesce(p_date, (now() at time zone 'Asia/Taipei')::date);

  -- 0153：日誌建立之後才新增的到期範本要補進來，否則當天永遠看不到
  perform public.eip_topup_routine_log(v_me, p_date);

  select * into v_log from public.work_log
   where user_id = v_me and log_date = p_date and deleted_at is null;

  if v_log.id is not null then
    return query
    select s.sec, (row_number() over (partition by s.sec order by e.ord) - 1)::int,
           coalesce(e.value->>'text',''), coalesce((e.value->>'done')::boolean, false),
           nullif(e.value->>'note',''), nullif(e.value->>'link',''),
           nullif(e.value->>'source',''), nullif(e.value->>'ref_id',''),
           coalesce((e.value->>'req')::boolean, false)
      from (values ('morning', coalesce(v_log.routine_morning,'[]'::jsonb)),
                   ('afternoon', coalesce(v_log.routine_afternoon,'[]'::jsonb))) s(sec, arr)
      cross join lateral jsonb_array_elements(s.arr) with ordinality as e(value, ord)
     where jsonb_typeof(s.arr) = 'array'
       and not coalesce((e.value->>'removed')::boolean, false);
  else
    v_seed := public.eip_worklog_seed(v_me, p_date);
    return query
    select s.sec, (row_number() over (partition by s.sec order by e.ord) - 1)::int,
           coalesce(e.value->>'text',''), false,
           nullif(e.value->>'note',''), nullif(e.value->>'link',''),
           nullif(e.value->>'source',''), nullif(e.value->>'ref_id',''),
           coalesce((e.value->>'req')::boolean, false)
      from (values ('morning', coalesce(v_seed->'morning','[]'::jsonb)),
                   ('afternoon', coalesce(v_seed->'afternoon','[]'::jsonb))) s(sec, arr)
      cross join lateral jsonb_array_elements(s.arr) with ordinality as e(value, ord)
     where jsonb_typeof(s.arr) = 'array';
  end if;
end;
$$;

revoke all on function public.eip_my_routine_today(date) from public, anon;
grant execute on function public.eip_my_routine_today(date) to authenticated;

-- ---------- 4. 部門例行彙總的 done 也要排除墓碑 ----------
do $$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef('public.eip_dept_routine_summary(date,date,uuid)'::regprocedure);
  v_old := 'where (it->>''source'') = ''personal_routine''
               and coalesce((it->>''done'')::boolean, false)), 0)::int as n';
  v_new := 'where (it->>''source'') = ''personal_routine''
               and not coalesce((it->>''removed'')::boolean, false)
               and coalesce((it->>''done'')::boolean, false)), 0)::int as n';
  if position(v_old in v_def) = 0 then
    raise exception '找不到 eip_dept_routine_summary 要替換的片段，請人工檢查';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;

revoke all on function public.eip_dept_routine_summary(date,date,uuid) from public, anon;
grant execute on function public.eip_dept_routine_summary(date,date,uuid) to authenticated;;
