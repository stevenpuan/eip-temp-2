-- 電話訂單「人資月鎖」的部門識別方式改成可設定（2026-09-02）
--
-- 問題：eip_is_phone_order_hr() 用 d.name = '人事課' 比字串。部門一改名，
--       人資就【無聲】失去月鎖與代填權限 —— 不會報錯、畫面也沒有任何跡象。
--       這支函式被 10 條政策使用（phone_order_daily 4、phone_order_month 3、phone_order_lock 3）。
--
-- 修法：需求不變（仍然是「人事課才能鎖月」，也刻意不擴張給部門督導 ——
--       月鎖是人資的作業職能，不是管轄範圍，擴張等於改需求）。
--       只把識別方式從「名稱字串」換成 system_configs 裡的部門 id，
--       後台「環境參數」頁就能維護；設定值不存在時退回原本的名稱比對，
--       所以套用當下行為完全不變。

-- 1) 把目前的人事課部門 id 寫進設定（已存在就不動）
insert into public.system_configs (key, value, group_name, description)
select 'phone_order_hr_department_id', d.id::text, 'phone_order',
       '電話訂單月鎖／代填權限所屬部門（人資）。部門改名不影響；若部門重建請更新此值。留空則退回比對部門名稱「人事課」'
  from public.department d
 where d.name = '人事課'
 order by d.created_at
 limit 1
on conflict (key) do nothing;

-- 2) 函式改讀設定值，讀不到才退回名稱比對
create or replace function public.eip_is_phone_order_hr()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select auth.uid() is not null and (
    current_role_name() = 'company_admin'::user_role
    -- 主要路徑：本人所屬部門 = 設定的人資部門 id
    or exists (
      select 1
        from public.app_user a
        join public.system_configs sc on sc.key = 'phone_order_hr_department_id'
       where a.id = auth.uid()
         and a.department_id is not null
         and coalesce(sc.value, '') <> ''
         and a.department_id::text = sc.value
    )
    -- 相容路徑：設定不存在或為空時，維持原本的部門名稱比對，避免設定漏填就整批失去權限
    or (
      not exists (
        select 1 from public.system_configs sc
         where sc.key = 'phone_order_hr_department_id' and coalesce(sc.value, '') <> ''
      )
      and exists (
        select 1
          from public.app_user a
          join public.department d on d.id = a.department_id
         where a.id = auth.uid()
           and d.tenant_id = current_tenant_id()
           and d.name = '人事課'
      )
    )
  );
$function$;
