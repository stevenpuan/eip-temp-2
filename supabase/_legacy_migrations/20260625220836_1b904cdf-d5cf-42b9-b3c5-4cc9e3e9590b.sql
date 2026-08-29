
-- =========================================================
-- eip_create_department: admin-only, tenant-scoped, validates parent & code
-- =========================================================
CREATE OR REPLACE FUNCTION public.eip_create_department(
  p_name text,
  p_parent_id uuid DEFAULT NULL,
  p_code text DEFAULT NULL,
  p_sort_order int DEFAULT 0
)
RETURNS public.department
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_tenant uuid;
  v_row public.department;
begin
  if current_role_name() is distinct from 'company_admin' then
    raise exception '僅系統管理員可新增部門';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception '部門名稱必填';
  end if;

  select tenant_id into v_tenant from public.app_user where id = auth.uid();
  v_tenant := coalesce(v_tenant, '00000000-0000-0000-0000-000000000001');

  if p_parent_id is not null then
    if not exists (select 1 from public.department where id = p_parent_id and tenant_id = v_tenant) then
      raise exception '上層部門不存在或不屬於同租戶';
    end if;
  end if;

  if p_code is not null and btrim(p_code) <> '' then
    if exists (select 1 from public.department where tenant_id = v_tenant and code = btrim(p_code)) then
      raise exception '部門代碼 % 已存在', btrim(p_code);
    end if;
  end if;

  insert into public.department (tenant_id, name, parent_id, code, sort_order)
  values (v_tenant, btrim(p_name),
          p_parent_id,
          nullif(btrim(coalesce(p_code,'')), ''),
          coalesce(p_sort_order, 0))
  returning * into v_row;

  return v_row;
end $$;

REVOKE ALL ON FUNCTION public.eip_create_department(text, uuid, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eip_create_department(text, uuid, text, int) TO authenticated;

-- =========================================================
-- eip_create_employee: admin-only; create app_user (+ optional auth login)
-- =========================================================
CREATE OR REPLACE FUNCTION public.eip_create_employee(
  p_name text,
  p_employee_no text,
  p_department_id uuid,
  p_role text DEFAULT 'member',
  p_job_title text DEFAULT NULL,
  p_extension text DEFAULT NULL,
  p_with_login boolean DEFAULT true,
  p_domain text DEFAULT 'shfc.com.tw'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
declare
  v_uid uuid := gen_random_uuid();
  v_tenant uuid;
  v_email text;
  v_pw text;
  v_eip_role public.user_role;
  v_role_id uuid;
  v_emp text;
begin
  if current_role_name() is distinct from 'company_admin' then
    raise exception '僅系統管理員可新增成員';
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

  return json_build_object(
    'ok', true,
    'user_id', v_uid,
    'email', v_email,
    'with_login', p_with_login,
    'employee_no', v_emp
  );
end $$;

REVOKE ALL ON FUNCTION public.eip_create_employee(text, text, uuid, text, text, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eip_create_employee(text, text, uuid, text, text, text, boolean, text) TO authenticated;
