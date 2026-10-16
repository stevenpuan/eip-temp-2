-- 客戶測試前總檢查（2026-10-17）：安全性與資料正確性修正
-- 已套用到 Supabase 專案 tjkeycrbgkyvlxwywyvt

-- 1. eip_is_dept_supervisor：沒有 EIP 帳號的登入者（例如自行註冊、待審核）會得到 NULL，
--    使「not eip_is_dept_supervisor(...)」這類檢查被略過（eip_worklog_seed、eip_performance_summary）。一律回 true/false。
create or replace function public.eip_is_dept_supervisor(p_dept uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    current_role_name() = 'company_admin'
      or (p_dept is not null and (
            exists (select 1 from public.department d
                     where d.manager_id = (select auth.uid())
                       and public.eip_dept_in_subtree(p_dept, d.id))
         or exists (select 1 from public.eip_dept_supervisor s
                     where s.user_id = (select auth.uid())
                       and public.eip_dept_in_subtree(p_dept, s.department_id)))),
    false);
$$;

-- 2. 網頁「手動新增訂單後沒填就關閉」的自動作廢：原本前端直接 UPDATE deleted_at，會被 RLS 擋（且沒檢查錯誤）。
--    改由這支函式把關：只能作廢自己可編輯、真的空白的網頁單。
create or replace function public.eip_void_blank_sales_order(p_order uuid)
returns boolean language plpgsql security definer set search_path to 'public' as $$
declare o record;
begin
  select * into o from public.eip_sales_order where id = p_order and tenant_id = public.current_tenant_id() and deleted_at is null;
  if not found then return false; end if;
  if not (coalesce(o.created_by = auth.uid(), false) or coalesce(public.eip_has_perm('eip_sales_order', 'edit'), false)) then
    raise exception '沒有權限';
  end if;
  if o.status not in ('draft', 'pending_review') or o.source <> 'web' or o.customer_id is not null
     or nullif(btrim(coalesce(o.note, '')), '') is not null or nullif(btrim(coalesce(o.raw_text, '')), '') is not null
     or exists (select 1 from public.eip_sales_order_line l where l.order_id = p_order) then
    return false;
  end if;
  update public.eip_sales_order set deleted_at = now(), cancelled_reason = '手動新增後未填寫，自動作廢' where id = p_order;
  return true;
end $$;
revoke all on function public.eip_void_blank_sales_order(uuid) from public, anon;
grant execute on function public.eip_void_blank_sales_order(uuid) to authenticated;

-- 3. 未登入（anon）不需要執行任何 SECURITY DEFINER 函式（Supabase 安全建議 0028）
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
       and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format('revoke execute on function %s from anon, public', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

-- 4. 訂單附件 bucket 加上大小上限（與 LINE 端 10MB 一致，留一點餘裕）
update storage.buckets set file_size_limit = 20971520 where id = 'sales-order';

-- 5. 選單：電話訂單是陞煇專用功能（艾士說明書已移除）→ 停用；修正錯字
update public.menus set is_active = false where route = '/dashboard/eip/phone-order';
update public.menus set title = '待辦事項' where route = '/dashboard/dev-todos' and title = '代辦事項';

-- 6. 帳號停用（離職）時自動解除 LINE 綁定，避免離職者繼續用 LINE 助理查資料、下單
create or replace function public.eip_clear_line_on_disable()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from 'active' and old.status = 'active' then
    new.line_user_id := null;
  end if;
  return new;
end $$;
create or replace trigger trg_app_user_clear_line_on_disable
  before update of status on public.app_user
  for each row execute function public.eip_clear_line_on_disable();

-- 7. LINE 綁定碼：6 碼 → 8 碼；只有在職的 EIP 帳號可以產生
create or replace function public.eip_generate_line_bind_code()
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_code text; v_tenant uuid;
begin
  select tenant_id into v_tenant from public.app_user where id = auth.uid() and status = 'active';
  if v_tenant is null then raise exception '帳號未啟用，無法綁定 LINE'; end if;
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  update public.line_bind_code set used_at = now() where user_id = auth.uid() and used_at is null;
  insert into public.line_bind_code (tenant_id, user_id, code) values (v_tenant, auth.uid(), v_code);
  return v_code;
end $$;
