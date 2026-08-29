
create or replace function public.eip_admin_delete_user(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public','auth','extensions'
as $function$
declare
  v_caller uuid := auth.uid();
  v_caller_tenant uuid;
  v_target app_user;
  v_profile_status text;
  v_refs text := '';
  r record;
  v_cnt bigint;
  v_admin_cnt int;
begin
  -- 授權：只有 company_admin（系統設計師 / 管理者）
  if current_role_name() is distinct from 'company_admin' then
    raise exception '只有系統設計師 / 管理者可刪除帳號';
  end if;

  if p_user_id is null then raise exception '缺少 user_id'; end if;
  if p_user_id = v_caller then raise exception '不可刪除自己的帳號'; end if;

  select tenant_id into v_caller_tenant from app_user where id = v_caller;

  select * into v_target from app_user where id = p_user_id;
  select status into v_profile_status from profiles where id = p_user_id;

  if v_target.id is null and v_profile_status is null then
    raise exception '帳號不存在';
  end if;

  if v_target.tenant_id is not null and v_caller_tenant is not null
     and v_target.tenant_id <> v_caller_tenant then
    raise exception '不可刪除其他租戶的帳號';
  end if;

  -- 僅允許刪除「已停用 / inactive」帳號
  if coalesce(v_profile_status, '') <> 'disabled'
     and coalesce(v_target.status::text, '') <> 'inactive' then
    raise exception '只能永久刪除「已停用」的帳號，請先停用再刪除';
  end if;

  -- 不可刪掉最後一位 company_admin
  if v_target.role = 'company_admin' then
    select count(*) into v_admin_cnt from app_user
      where role = 'company_admin' and status = 'active'
        and tenant_id = v_target.tenant_id;
    if v_admin_cnt < 1 then
      raise exception '不可刪除最後一位系統管理員';
    end if;
  end if;

  -- 引用掃描：除了會一併清除的 incidental 表(notification/line_bind_code)，
  -- 其餘任何 FK 引用都擋下，避免孤兒資料
  for r in
    select tc.table_name as tbl, kcu.column_name as col
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and ccu.table_name = 'app_user' and ccu.table_schema = 'public'
      and not (tc.table_name = 'notification'   and kcu.column_name = 'user_id')
      and not (tc.table_name = 'line_bind_code'  and kcu.column_name = 'user_id')
  loop
    execute format('select count(*) from public.%I where %I = $1', r.tbl, r.col)
      into v_cnt using p_user_id;
    if v_cnt > 0 then
      v_refs := v_refs || r.tbl || '.' || r.col || '=' || v_cnt || '; ';
    end if;
  end loop;

  if v_refs <> '' then
    raise exception '此帳號仍被資料引用，無法永久刪除（請改用停用，或先轉移負責人）：%', v_refs;
  end if;

  -- 清除 incidental + 本體 + auth
  delete from notification    where user_id = p_user_id;
  delete from line_bind_code  where user_id = p_user_id;
  delete from user_roles      where user_id = p_user_id;
  delete from app_user        where id      = p_user_id;
  delete from profiles        where id      = p_user_id;
  delete from auth.identities  where user_id = p_user_id;
  delete from auth.users       where id      = p_user_id;

  insert into audit_logs(user_id, action, target_table, target_id, before_data)
  values (v_caller, 'permanent_delete', 'app_user', p_user_id::text,
          json_build_object('name', v_target.name, 'email', v_target.email)::jsonb);

  return json_build_object('ok', true, 'user_id', p_user_id);
end;
$function$;

revoke all on function public.eip_admin_delete_user(uuid) from public;
grant execute on function public.eip_admin_delete_user(uuid) to authenticated;
;
