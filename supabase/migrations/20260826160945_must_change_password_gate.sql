-- =====================================================================
-- 首次登入強制改密（補上 0033 從未套用到正式庫的那一塊）
--
-- 為什麼需要：管理者重設密碼會給一組臨時密碼，若使用者不改，這組密碼就
-- 一直有效、而且經手的人都知道。原本只能口頭提醒，這裡改成系統把關。
--
--   1) app_user.must_change_password 旗標
--   2) eip_must_change_password()   前端查「我現在是不是被要求改密碼」
--   3) eip_complete_password_change() 改完密碼後清旗標
--   4) eip_admin_reset_password / eip_admin_create_user 產生臨時密碼時 → 旗標設 true
--
-- 注意：不主動把現有 24 位同仁全部標記（那會讓所有人下次登入都被擋著改密碼）。
-- 若日後決定要全面汰換初始密碼，再執行：
--   update public.app_user set must_change_password = true
--    where tenant_id = '00000000-0000-0000-0000-000000000001' and status = 'active';
-- =====================================================================

alter table public.app_user
  add column if not exists must_change_password boolean not null default false;

comment on column public.app_user.must_change_password is
  'true = 目前使用的是管理者給的臨時／初始密碼，登入後會被擋著要求先改密碼';

-- ── 查旗標：走 RPC 而不是讓前端 select app_user，省得受 RLS 與型別檔影響 ──
create or replace function public.eip_must_change_password()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((select must_change_password from public.app_user where id = auth.uid()), false);
$function$;

revoke execute on function public.eip_must_change_password() from public, anon;
grant  execute on function public.eip_must_change_password() to authenticated;

-- ── 清旗標：使用者自己改完密碼後呼叫（只動自己這列）──
create or replace function public.eip_complete_password_change()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.app_user set must_change_password = false where id = auth.uid();
$function$;

revoke execute on function public.eip_complete_password_change() from public, anon;
grant  execute on function public.eip_complete_password_change() to authenticated;

-- ── 重設密碼時一併要求改密 ──
create or replace function public.eip_admin_reset_password(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public', 'auth', 'extensions'
as $function$
declare
  v_pw       text;
  v_email    text;
  v_name     text;
  v_sessions int := 0;
begin
  -- 權限：與新增/刪除帳號同一把尺
  if not (public.eip_has_perm('users','edit') or public.is_admin(auth.uid())) then
    raise exception '沒有重設密碼的權限（需帳號管理編輯權）';
  end if;

  if p_user_id is null then
    raise exception '請指定要重設的帳號';
  end if;

  select u.email into v_email from auth.users u where u.id = p_user_id;
  if v_email is null then
    raise exception '找不到這個登入帳號';
  end if;

  -- 防止權限橫向擴張：只有系統管理者能重設系統管理者的密碼
  if public.is_admin(p_user_id) and not public.is_admin(auth.uid()) then
    raise exception '只有系統管理者可以重設系統管理者的密碼';
  end if;

  select coalesce(a.name, p.full_name) into v_name
  from public.profiles p
  left join public.app_user a on a.id = p.id
  where p.id = p_user_id;

  -- 臨時密碼：12 碼隨機（base64 去掉易混淆的 / + =）
  v_pw := translate(encode(extensions.gen_random_bytes(9), 'base64'), '/+=', 'xyz');

  update auth.users
  set encrypted_password = extensions.crypt(v_pw, extensions.gen_salt('bf')),
      updated_at = now()
  where id = p_user_id;

  -- 這組是臨時密碼 → 登入後擋著要求改密碼
  update public.app_user set must_change_password = true where id = p_user_id;

  -- 強制登出所有裝置（先刪 refresh token，再刪 session）
  delete from auth.refresh_tokens
  where user_id = p_user_id::text
     or session_id in (select s.id from auth.sessions s where s.user_id = p_user_id);
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_sessions = row_count;

  insert into public.audit_logs (user_id, action, target_table, target_id, after_data)
  values (
    auth.uid(), 'admin_reset_password', 'auth.users', p_user_id::text,
    jsonb_build_object('email', v_email, 'name', v_name, 'revoked_sessions', v_sessions)
  );

  return json_build_object(
    'ok', true, 'email', v_email, 'name', v_name,
    'password', v_pw, 'revoked_sessions', v_sessions
  );
end;
$function$;

revoke execute on function public.eip_admin_reset_password(uuid) from public, anon;
grant  execute on function public.eip_admin_reset_password(uuid) to authenticated;;
