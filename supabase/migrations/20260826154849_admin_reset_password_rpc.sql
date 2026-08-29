-- =====================================================================
-- 管理者重設密碼 RPC：eip_admin_reset_password(p_user_id)
--
-- 背景：系統原本完全沒有重設密碼的出路 —— 登入頁沒有「忘記密碼」，
-- 人員管理頁也沒有重設按鈕，只有登入成功的人能在「個人設定」自己改。
-- 一旦同仁忘記密碼就只能請人直接改資料庫。此 RPC 補上這個缺口。
--
-- 行為：
--   1) 產生一組隨機臨時密碼（與 eip_admin_create_user 相同產生方式），
--      寫回 auth.users.encrypted_password（bcrypt）。
--   2) 清掉該帳號所有 session / refresh token，強制所有裝置重新登入
--      （忘記密碼或帳號可能外流時，這一步才是真正把門關上）。
--   3) 寫一筆 audit_logs（誰、在什麼時候、重設了誰）。
--   4) 回傳臨時密碼給呼叫者，由前端顯示一次並複製轉交。
--
-- 權限：與新增/刪除帳號一致 —— eip_has_perm('users','edit') 或 is_admin。
--       額外防護：非系統管理者不得重設「系統管理者」帳號的密碼，
--       避免有帳號編輯權的人藉此登入成管理者。
-- =====================================================================

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

  -- 強制登出所有裝置（先刪 refresh token，再刪 session）
  delete from auth.refresh_tokens
  where user_id = p_user_id::text
     or session_id in (select s.id from auth.sessions s where s.user_id = p_user_id);
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_sessions = row_count;

  insert into public.audit_logs (user_id, action, target_table, target_id, after_data)
  values (
    auth.uid(), 'admin_reset_password', 'auth.users', p_user_id::text,
    jsonb_build_object(
      'email', v_email,
      'name', v_name,
      'revoked_sessions', v_sessions
    )
  );

  return json_build_object(
    'ok', true,
    'email', v_email,
    'name', v_name,
    'password', v_pw,
    'revoked_sessions', v_sessions
  );
end;
$function$;

revoke execute on function public.eip_admin_reset_password(uuid) from public, anon;
grant  execute on function public.eip_admin_reset_password(uuid) to authenticated;

comment on function public.eip_admin_reset_password(uuid) is
  '管理者重設指定帳號密碼：產生隨機臨時密碼、強制登出所有裝置、寫入 audit_logs，回傳臨時密碼供前端顯示一次。權限同新增/刪除帳號。';;
