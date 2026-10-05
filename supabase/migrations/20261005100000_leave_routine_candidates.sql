-- 交接代辦「帶入例行工作」：列出「我」在請假期間會到期的例行工作（2026-10-05 客戶需求）
-- 來源（使用者拍板）：個人例行範本（personal_routine）＋自己是負責人的常態工作（recurring_rule）
-- 只列期間內會到的；一個例行一筆，回傳期間內的到期日讓前端標示。
-- 判斷到期沿用工作日誌的同一套函式（eip_personal_routine_due_on / eip_rule_due_on），規則一致。
-- 只看 auth.uid() 自己的資料（只有請假本人能新增代辦），期間上限 62 天。
create or replace function public.eip_leave_routine_candidates(p_from date, p_to date)
returns table(source text, ref_id uuid, title text, freq_label text, slot text, dates date[], ord integer)
language sql stable security definer set search_path to 'public'
as $$
  with me as (select auth.uid() as uid),
  days as (
    select generate_series(p_from, least(p_to, p_from + 61), interval '1 day')::date as d
    where p_from is not null and p_to is not null and p_to >= p_from
  ),
  wd as (select '{一,二,三,四,五,六,日}'::text[] as n)
  select 'personal_routine'::text, pr.id, pr.title,
         case pr.freq
           when 'daily' then '每日'
           when 'weekdays' then '平日'
           when 'weekly' then '每週' || coalesce((select string_agg(wd.n[w], '、' order by w) from unnest(pr.weekdays) w where w between 1 and 7), '')
           when 'monthly' then '每月 ' || concat_ws('、',
                 nullif((select string_agg(x::text, '/' order by x) from unnest(pr.days_of_month) x), '') || ' 日',
                 case when pr.use_month_end then '月底' end)
           else pr.freq end,
         pr.time_slot,
         array_agg(days.d order by days.d),
         min(coalesce(pr.sort_order, 0))
    from public.personal_routine pr
    join me on pr.user_id = me.uid
    cross join days cross join wd
   where pr.is_active and pr.deleted_at is null
     and public.eip_personal_routine_due_on(pr, days.d)
   group by pr.id, pr.title, pr.freq, pr.weekdays, pr.days_of_month, pr.use_month_end, pr.time_slot, wd.n
  union all
  select 'recurring'::text, rr.id, rr.title,
         case rr.freq
           when 'daily' then case when rr.active_weekdays is null then '每日'
                 else '每週' || (select string_agg(wd.n[w], '、' order by w) from unnest(rr.active_weekdays) w where w between 1 and 7) end
           when 'weekly' then '每週' || coalesce(wd.n[rr.weekday], '')
           when 'monthly' then '每月 ' || concat_ws('、',
                 nullif((select string_agg(x::text, '/' order by x) from unnest(rr.days_of_month) x), '') || ' 日',
                 case when rr.use_month_end then '月底' end)
           when 'yearly' then '每年'
           else rr.freq end,
         null::text,
         array_agg(days.d order by days.d),
         100000
    from public.recurring_rule rr
    join me on rr.owner_id = me.uid
    cross join days cross join wd
   where rr.is_active
     and public.eip_rule_due_on(rr, days.d)
   group by rr.id, rr.title, rr.freq, rr.active_weekdays, rr.weekday, rr.days_of_month, rr.use_month_end, wd.n
$$;
revoke all on function public.eip_leave_routine_candidates(date, date) from public, anon;
grant execute on function public.eip_leave_routine_candidates(date, date) to authenticated;
