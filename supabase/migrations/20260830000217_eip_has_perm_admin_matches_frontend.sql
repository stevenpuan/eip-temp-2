-- 前後端對同一句話有兩種答案，這是「假成功」那一類的根源之一。
--
-- 前端 lib/auth.tsx 的 can()：  `if (isAdmin) return true;`
-- 角色權限頁畫面上也寫死：      「管理員擁有全部權限，無法調整。」並鎖住勾選格
-- 但後端 eip_has_perm()：       只查 role_module_permissions，完全不特判 admin
--
-- 實查：系統設計師這個角色在 role_module_permissions 裡有 10 個模組不是全開，
-- 例如 org 的 create/edit/delete 全是 false、eip_calendar 只有 view。
-- 只要哪一天有 RLS 政策走到 eip_has_perm('org','edit')，系統設計師就會被自己的
-- 系統擋在門外，而且因為畫面把勾選格鎖住了，**在 UI 上永遠修不回來**。
--
-- 修法：讓後端跟畫面上宣告的規則一致。這不是放寬權限 —— 是把「已經對使用者
-- 宣告過的行為」在後端補實作。引用 eip_has_perm 的 28 條政策全是管理/設定類的表，
-- 且全部 `to authenticated`，admin 本來就該全通。
create or replace function public.eip_has_perm(p_module text, p_action text)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select
    -- 系統設計師恆為 true，對齊前端 can() 與角色權限頁的說明文字
    public.is_admin((select auth.uid()))
    or exists (
      select 1
      from public.user_roles ur
      join public.role_module_permissions p on p.role_id = ur.role_id
      where ur.user_id = (select auth.uid())
        and p.module_key = p_module
        and case p_action
              when 'view'   then p.can_view
              when 'create' then p.can_create
              when 'edit'   then p.can_edit
              when 'delete' then p.can_delete
              when 'export' then p.can_export
              else false end
    );
$function$;;
