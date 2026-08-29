-- 常態工作「對接人員」改為可複選（2026-08-25 客戶要求）。
--
-- 為什麼是陣列而不是關聯表：對接人員只是「要被通知、要看得到、要掛成協作者」的名單，
-- 沒有自己的屬性，也要在 RLS 裡直接判斷（關聯表在政策裡查會踩到自己的 RLS 遞迴），
-- 用 uuid[] 判斷 `= any()` 最單純。資料量是幾十筆規則，不需要 GIN 索引。
--
-- 舊的單一欄位 counterpart_user_id 刻意保留：
-- DB 先上、Lovable 前端晚幾十秒才同步，中間仍有舊前端在寫單一欄位；
-- 也還有 types.ts 沒重新產生的地方在讀它。用 trigger 讓兩邊永遠一致，
-- **陣列是主資料**，單一欄位＝陣列的第一個。
alter table public.recurring_rule
  add column if not exists counterpart_user_ids uuid[] not null default '{}'::uuid[];

comment on column public.recurring_rule.counterpart_user_ids is
  '對接人員（可複選）。主資料；counterpart_user_id 由 trigger 同步為第一個，僅為相容舊讀取端。';

-- 回填舊資料
update public.recurring_rule
   set counterpart_user_ids = array[counterpart_user_id]
 where counterpart_user_id is not null
   and cardinality(counterpart_user_ids) = 0;

create or replace function public.eip_sync_recurring_counterparts()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' then
    -- 舊前端只送單一欄位時，把它當成一人名單
    if cardinality(coalesce(new.counterpart_user_ids, '{}'::uuid[])) = 0
       and new.counterpart_user_id is not null then
      new.counterpart_user_ids := array[new.counterpart_user_id];
    end if;
  else
    -- 陣列有動就以陣列為準；只動單一欄位（舊前端）才反推陣列
    if new.counterpart_user_ids is not distinct from old.counterpart_user_ids
       and new.counterpart_user_id is distinct from old.counterpart_user_id then
      new.counterpart_user_ids := case
        when new.counterpart_user_id is null then '{}'::uuid[]
        else array[new.counterpart_user_id]
      end;
    end if;
  end if;

  -- 去掉 null 與重複
  new.counterpart_user_ids := coalesce(
    (select array_agg(distinct x) from unnest(coalesce(new.counterpart_user_ids, '{}'::uuid[])) x
      where x is not null),
    '{}'::uuid[]);
  new.counterpart_user_id := new.counterpart_user_ids[1];
  return new;
end;
$$;

drop trigger if exists trg_recurring_sync_counterparts on public.recurring_rule;
create trigger trg_recurring_sync_counterparts
  before insert or update on public.recurring_rule
  for each row execute function public.eip_sync_recurring_counterparts();

-- 對接人員本來讀不到自己被指派的規則（read 政策只有 admin/負責人/建立者/無部門/部門可視）。
-- 客戶要的「相關的人看得到、不相關的看不到」就是這一條。
drop policy if exists recurring_read on public.recurring_rule;
create policy recurring_read on public.recurring_rule
  for select using (
    tenant_id = current_tenant_id()
    and (
      current_role_name() = 'company_admin'::user_role
      or owner_id = (select auth.uid())
      or created_by = (select auth.uid())
      or (select auth.uid()) = any (counterpart_user_ids)
      or department_id is null
      or eip_can_view_dept_record(department_id)
    )
  );;
