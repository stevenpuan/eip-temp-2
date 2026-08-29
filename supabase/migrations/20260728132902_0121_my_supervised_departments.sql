-- 0121 前端需要知道「我主管哪些部門」才能決定顯示哪些動作按鈕。
-- 沒有這支的話前端只能每列各發一次判定查詢，或是先顯示按鈕再讓 RLS 擋（UX 差）。
-- 注意：這只影響「按鈕要不要顯示」，真正的授權一律以 RLS 為準。
create or replace function public.eip_my_supervised_departments()
 returns table(department_id uuid)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select d.id
    from public.department d
   where auth.uid() is not null
     and public.eip_is_dept_supervisor(d.id);
$function$;

revoke execute on function public.eip_my_supervised_departments() from public, anon;
grant execute on function public.eip_my_supervised_departments() to authenticated;;
