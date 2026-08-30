-- 資安加固 2026-08-29（第三輪檢查第 8/9/10 項）
-- 客戶決策：只有系統設計師能授予/移除系統設計師；其餘兩項是把後端對齊前端既有把關，
-- 不改變任何人現在看得到／做得到的事。

-- ────────────────────────────────────────────────────────────
-- 第 8 項：eip_set_user_roles 提權
--   原本只驗「有沒有 users:edit」，不看被授予的是什麼角色。
--   管理者(manager) 有 users:edit → 可以把自己或別人設成系統設計師(admin)。
-- ────────────────────────────────────────────────────────────
create or replace function public.eip_set_user_roles(p_user_id uuid, p_role_ids uuid[])
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_admin_role      uuid;
  v_caller_is_admin boolean := public.is_admin(auth.uid());
  v_had_admin       boolean;
  v_will_admin      boolean;
  v_admin_count     int;
begin
  if not (public.eip_has_perm('users','edit') or v_caller_is_admin) then
    raise exception 'not authorized';
  end if;
  if p_role_ids is null or array_length(p_role_ids,1) is null then
    raise exception 'at least one role is required';
  end if;

  select id into v_admin_role from public.roles where code = 'admin';

  if v_admin_role is not null then
    select exists (
      select 1 from public.user_roles
       where user_id = p_user_id and role_id = v_admin_role
    ) into v_had_admin;

    v_will_admin := v_admin_role = any (p_role_ids);

    -- 只有系統設計師本人能改動「系統設計師」這一階。
    -- 沒有這道檢查的話，有 users:edit 的管理者可以自己升自己。
    if v_had_admin is distinct from v_will_admin and not v_caller_is_admin then
      raise exception '權限不足：只有系統設計師可以授予或移除「系統設計師」角色';
    end if;

    -- 不能把最後一位系統設計師拔掉，否則沒有人能再改回來。
    if v_had_admin and not v_will_admin then
      select count(*) into v_admin_count
        from public.user_roles where role_id = v_admin_role;
      if v_admin_count <= 1 then
        raise exception '系統至少要保留一位系統設計師，不能移除最後一位';
      end if;
    end if;
  end if;

  delete from public.user_roles where user_id = p_user_id;
  insert into public.user_roles(user_id, role_id)
    select p_user_id, rid from unnest(p_role_ids) as rid
    where exists (select 1 from public.roles r where r.id = rid);
end;
$function$;

-- ────────────────────────────────────────────────────────────
-- 第 9 項：doc_pages 的 SELECT qual 原本是 true
--   → 系統文件與 4 份 *_bak_* 對全體員工可讀（前端擋、後端不擋）。
--   改成沿用前端同一把尺 eip_has_perm(key,'view')：
--     user_manual  → 五個角色 can_view 都是 true，全員照樣看得到（無感）
--     system_docs  → admin + manager，與前端 RequirePerm 完全一致（無感）
--     *_bak_*      → 沒有權限列，只有系統設計師本人讀得到
-- ────────────────────────────────────────────────────────────
drop policy if exists "doc read all" on public.doc_pages;
create policy doc_read on public.doc_pages
  for select to authenticated
  using (
    public.eip_has_perm(key, 'view')
    or public.is_admin((select auth.uid()))
  );

-- ────────────────────────────────────────────────────────────
-- 第 10 項：三張 log 表的 INSERT 允許 user_id IS NULL
--   → 任何登入者可以寫出「查不到是誰做的」稽核紀錄，等於稽核軌跡可偽造。
--   收成必須等於自己。四支會寫 log 的函式（eip_audit / eip_cron_guarded /
--   eip_admin_reset_password / eip_admin_delete_user）都是 postgres 所有的
--   SECURITY DEFINER，有 BYPASSRLS，不受這條影響。
-- ────────────────────────────────────────────────────────────
drop policy if exists "el insert self" on public.error_logs;
create policy el_insert_self on public.error_logs
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "al insert self" on public.activity_logs;
create policy al_insert_self on public.activity_logs
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "au insert self" on public.audit_logs;
create policy au_insert_self on public.audit_logs
  for insert to authenticated
  with check (user_id = (select auth.uid()));;
