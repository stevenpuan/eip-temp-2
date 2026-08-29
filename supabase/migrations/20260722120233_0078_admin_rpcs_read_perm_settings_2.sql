create or replace function public.eip_admin_delete_user(p_user_id uuid)
 returns json language plpgsql security definer set search_path to 'public', 'auth', 'extensions'
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
  if not (public.eip_has_perm('users','edit') or public.is_admin(auth.uid())) then
    raise exception '沒有刪除帳號的權限（需帳號管理編輯權）';
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

  if coalesce(v_profile_status, '') <> 'disabled'
     and coalesce(v_target.status::text, '') <> 'inactive' then
    raise exception '只能永久刪除「已停用」的帳號，請先停用再刪除';
  end if;

  if v_target.role = 'company_admin' then
    select count(*) into v_admin_cnt from app_user
      where role = 'company_admin' and status = 'active'
        and tenant_id = v_target.tenant_id;
    if v_admin_cnt < 1 then
      raise exception '不可刪除最後一位系統管理員';
    end if;
  end if;

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

create or replace function public.eip_create_employee(p_name text, p_employee_no text, p_department_id uuid, p_role text DEFAULT 'member'::text, p_job_title text DEFAULT NULL::text, p_extension text DEFAULT NULL::text, p_with_login boolean DEFAULT true, p_domain text DEFAULT 'shfc.com.tw'::text)
 returns json language plpgsql security definer set search_path to 'public', 'auth', 'extensions'
as $function$
declare
  v_uid uuid := gen_random_uuid();
  v_tenant uuid;
  v_email text;
  v_pw text;
  v_eip_role public.user_role;
  v_role_id uuid;
  v_emp text;
begin
  if not (public.eip_has_perm('org','edit') or public.is_admin(auth.uid())) then
    raise exception '沒有新增成員的權限（需組織架構編輯權）';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception '姓名必填';
  end if;
  v_emp := btrim(coalesce(p_employee_no, ''));
  if v_emp = '' then
    raise exception '員工編號必填';
  end if;

  select tenant_id into v_tenant from public.app_user where id = auth.uid();
  v_tenant := coalesce(v_tenant, '00000000-0000-0000-0000-000000000001');

  if exists (select 1 from public.app_user where tenant_id = v_tenant and employee_no = v_emp) then
    raise exception '員工編號 % 已存在', v_emp;
  end if;

  if p_department_id is not null then
    if not exists (select 1 from public.department where id = p_department_id and tenant_id = v_tenant) then
      raise exception '所屬部門不存在或不屬於同租戶';
    end if;
  end if;

  v_eip_role := case p_role
    when 'company_admin' then 'company_admin'
    when 'dept_manager' then 'dept_manager'
    when 'viewer' then 'viewer'
    else 'member' end;

  if p_with_login then
    v_email := lower(v_emp || '@' || coalesce(nullif(btrim(p_domain),''), 'shfc.com.tw'));
    if exists (select 1 from auth.users where email = v_email) then
      raise exception 'email % 已被註冊', v_email;
    end if;
    v_pw := v_emp;

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      v_email, extensions.crypt(v_pw, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"],"force_password_change":true}'::jsonb,
      json_build_object('full_name', p_name, 'force_password_change', true)::jsonb,
      now(), now(), '', '', '', '', '', '', '', ''
    );
    insert into auth.identities (
      id, user_id, provider_id, provider, identity_data, created_at, updated_at
    ) values (
      gen_random_uuid(), v_uid, v_uid::text, 'email',
      json_build_object('sub', v_uid::text, 'email', v_email)::jsonb, now(), now()
    );
    update public.profiles set full_name = p_name, status = 'active' where id = v_uid;
  end if;

  insert into public.app_user (
    id, tenant_id, name, email, employee_no, job_title, extension,
    department_id, role, status
  ) values (
    coalesce(v_uid, gen_random_uuid()), v_tenant, btrim(p_name), v_email, v_emp,
    nullif(btrim(coalesce(p_job_title,'')), ''),
    nullif(btrim(coalesce(p_extension,'')), ''),
    p_department_id, v_eip_role, 'active'
  )
  on conflict (id) do update set
    name = excluded.name, email = coalesce(excluded.email, public.app_user.email),
    employee_no = excluded.employee_no, job_title = excluded.job_title,
    extension = excluded.extension, department_id = excluded.department_id,
    role = excluded.role, status = 'active';

  if p_with_login then
    select id into v_role_id from public.roles where code = case p_role
      when 'company_admin' then 'admin'
      when 'dept_manager' then 'dept_manager'
      when 'viewer' then 'viewer'
      else 'member' end;
    if v_role_id is not null then
      delete from public.user_roles where user_id = v_uid;
      insert into public.user_roles (user_id, role_id) values (v_uid, v_role_id);
    end if;
  end if;

  return json_build_object('ok', true, 'user_id', v_uid, 'email', v_email, 'with_login', p_with_login, 'employee_no', v_emp);
end $function$;;
