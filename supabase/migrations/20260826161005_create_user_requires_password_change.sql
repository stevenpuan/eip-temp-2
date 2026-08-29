-- 新建帳號的初始密碼也是「別人知道的密碼」→ 一樣要求首次登入改密
create or replace function public.eip_admin_create_user(
  p_email text,
  p_full_name text,
  p_role_code text DEFAULT 'member'::text,
  p_department_id uuid DEFAULT NULL::uuid
)
returns json
language plpgsql
security definer
set search_path to 'public', 'auth', 'extensions'
as $function$
declare
  v_uid uuid := gen_random_uuid();
  v_pw text;
  v_tenant uuid;
  v_role_id uuid;
  v_eip_role user_role;
begin
  if not (public.eip_has_perm('users','edit') or public.is_admin(auth.uid())) then
    raise exception '沒有新增帳號的權限（需帳號管理編輯權）';
  end if;

  p_email := lower(trim(p_email));
  if p_email = '' or coalesce(trim(p_full_name), '') = '' then
    raise exception 'email 與姓名為必填';
  end if;
  if exists (select 1 from auth.users where email = p_email) then
    raise exception '此 email 已被註冊';
  end if;

  v_pw := translate(encode(extensions.gen_random_bytes(9), 'base64'), '/+=', 'xyz');

  select tenant_id into v_tenant from app_user where id = auth.uid();
  v_tenant := coalesce(v_tenant, '00000000-0000-0000-0000-000000000001');

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    p_email, extensions.crypt(v_pw, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    json_build_object('full_name', p_full_name)::jsonb, now(), now(),
    '', '', '', '', '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data, created_at, updated_at
  ) values (
    gen_random_uuid(), v_uid, v_uid::text, 'email',
    json_build_object('sub', v_uid::text, 'email', p_email)::jsonb, now(), now()
  );

  v_eip_role := case p_role_code
    when 'admin' then 'company_admin'
    when 'manager' then 'company_admin'
    when 'dept_manager' then 'dept_manager'
    when 'viewer' then 'viewer'
    else 'member' end;

  update profiles set full_name = p_full_name, status = 'active' where id = v_uid;

  insert into app_user (id, tenant_id, name, email, role, department_id, status, must_change_password)
    values (v_uid, v_tenant, p_full_name, p_email, v_eip_role, p_department_id, 'active', true)
  on conflict (id) do update set
    name = excluded.name, role = excluded.role,
    department_id = excluded.department_id, status = 'active',
    must_change_password = true;

  select id into v_role_id from roles where code = p_role_code;
  if v_role_id is not null then
    delete from user_roles where user_id = v_uid;
    insert into user_roles (user_id, role_id) values (v_uid, v_role_id);
  end if;

  return json_build_object('ok', true, 'user_id', v_uid, 'email', p_email, 'password', v_pw);
end;
$function$;

revoke execute on function public.eip_admin_create_user(text,text,text,uuid) from public, anon;
grant  execute on function public.eip_admin_create_user(text,text,text,uuid) to authenticated;;
