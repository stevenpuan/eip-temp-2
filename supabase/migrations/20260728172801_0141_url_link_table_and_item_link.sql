-- ============================================================
-- 0141 通用外部連結（P1#7）
--   eip_link     = 系統內實體關聯（已上線，不動）
--   eip_url_link = 系統外的檔案／網址（NAS UNC 或 http），本次新增
-- 另外把「每項可掛連結」接到 jsonb 既有的 link key，仍由同一支單筆設定函式處理。
-- ============================================================
create table if not exists public.eip_url_link (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000001'::uuid,
  entity_type text not null check (entity_type in ('task','work_log','anomaly','project','meeting','document')),
  entity_id uuid not null,
  label text,
  url text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

comment on table public.eip_url_link is
  '外部連結（NAS UNC 路徑或 http/https）。與 eip_link 分開：eip_link 是系統內實體關聯，這張是系統外的檔案／網址。';

create index if not exists idx_eip_url_link_entity on public.eip_url_link(entity_type, entity_id);
create index if not exists idx_eip_url_link_created_by on public.eip_url_link(created_by);

alter table public.eip_url_link drop constraint if exists eip_url_link_url_shape;
alter table public.eip_url_link add constraint eip_url_link_url_shape
  check (url ~ '^(https?://|file://|\\\\)' and length(url) between 3 and 2000);

create or replace function public.eip_fill_url_link_defaults()
 returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.created_by is null then new.created_by := auth.uid(); end if;
  if new.tenant_id is null then new.tenant_id := coalesce(current_tenant_id(), '00000000-0000-0000-0000-000000000001'); end if;
  new.label := nullif(btrim(coalesce(new.label,'')), '');
  new.url := btrim(new.url);
  return new;
end $$;
revoke all on function public.eip_fill_url_link_defaults() from public, anon, authenticated;

drop trigger if exists trg_eip_url_link_defaults on public.eip_url_link;
create trigger trg_eip_url_link_defaults before insert on public.eip_url_link
  for each row execute function public.eip_fill_url_link_defaults();

alter table public.eip_url_link enable row level security;

drop policy if exists eip_url_link_read on public.eip_url_link;
create policy eip_url_link_read on public.eip_url_link
  for select to authenticated
  using (tenant_id = current_tenant_id()
         and (current_role_name() = 'company_admin'
              or created_by = (select auth.uid())
              or public.eip_url_link_visible(entity_type, entity_id)));

drop policy if exists eip_url_link_write on public.eip_url_link;
create policy eip_url_link_write on public.eip_url_link
  for insert to authenticated
  with check (tenant_id = current_tenant_id()
              and (current_role_name() = 'company_admin'
                   or public.eip_url_link_visible(entity_type, entity_id)));

drop policy if exists eip_url_link_delete on public.eip_url_link;
create policy eip_url_link_delete on public.eip_url_link
  for delete to authenticated
  using (tenant_id = current_tenant_id()
         and (created_by = (select auth.uid()) or current_role_name() = 'company_admin'));

grant select, insert, delete on public.eip_url_link to authenticated;
revoke all on public.eip_url_link from anon;


-- ---------- 單筆設定加上 p_link ----------
drop function if exists public.eip_my_routine_today(date);
drop function if exists public.eip_set_routine_item(date, text, text, text, text, boolean, text);

create function public.eip_set_routine_item(
  p_date date, p_section text,
  p_source text default null, p_ref_id text default null, p_text text default null,
  p_done boolean default null, p_note text default null, p_link text default null)
 returns jsonb
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
    insert into public.work_log (user_id, department_id, log_date,
                                 routine_morning, routine_afternoon, special_items, status)
    select v_me, a.department_id, p_date,
           coalesce(v_seed->'morning','[]'::jsonb),
           coalesce(v_seed->'afternoon','[]'::jsonb),
           coalesce(v_seed->'special','[]'::jsonb), 'draft'
      from public.app_user a where a.id = v_me
    returning * into v_log;
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
revoke all on function public.eip_set_routine_item(date, text, text, text, text, boolean, text, text) from public, anon;
grant execute on function public.eip_set_routine_item(date, text, text, text, text, boolean, text, text) to authenticated, service_role;

create or replace function public.eip_toggle_routine_item(
  p_date date, p_section text, p_done boolean,
  p_source text default null, p_ref_id text default null, p_text text default null)
 returns jsonb language sql security definer set search_path to 'public'
as $function$
  select public.eip_set_routine_item(p_date, p_section, p_source, p_ref_id, p_text, p_done, null, null);
$function$;
revoke all on function public.eip_toggle_routine_item(date, text, boolean, text, text, text) from public, anon;
grant execute on function public.eip_toggle_routine_item(date, text, boolean, text, text, text) to authenticated, service_role;

create function public.eip_my_routine_today(p_date date default null)
 returns table(section text, sort_order integer, text text, done boolean,
               note text, link text, source text, ref_id text, require_content boolean)
 language plpgsql stable security definer set search_path to 'public'
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
           nullif(e.value->>'note',''), nullif(e.value->>'link',''),
           nullif(e.value->>'source',''), nullif(e.value->>'ref_id',''),
           coalesce((e.value->>'req')::boolean, false)
      from (values ('morning', coalesce(v_log.routine_morning,'[]'::jsonb)),
                   ('afternoon', coalesce(v_log.routine_afternoon,'[]'::jsonb))) s(sec, arr)
      cross join lateral jsonb_array_elements(s.arr) with ordinality as e(value, ord)
     where jsonb_typeof(s.arr) = 'array';
  else
    v_seed := public.eip_worklog_seed(v_me, p_date);
    return query
    select s.sec, (e.ord - 1)::int,
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
$function$;
revoke all on function public.eip_my_routine_today(date) from public, anon;
grant execute on function public.eip_my_routine_today(date) to authenticated, service_role;;
