-- 常態工作／個人例行：指定日期超過當月天數時，落在當月最後一天
-- 起因（2026-09-30）：「加工部庫存金額報表」等 3 條規則設「每月 15、31 日」，
-- 9 月沒有 31 號 → eip_rule_due_on 永遠不成立 → 9/30 沒有產生任務。
-- 使用者填 29/30/31 的意思就是「當月最後那天」，這裡把超出的日期夾到月底：
--   31 在 9 月 → 9/30；30、31 在 2 月 → 2/28（或 2/29）。
-- 同一天被多個日期命中時仍只產生一張（eip_run_recurring 以 recurring_rule_id+occurrence_date 去重）。
-- 月底勾選（use_month_end）行為不變；兩個條件是 OR，可同時使用。

create or replace function public.eip_rule_due_on(r recurring_rule, d date)
 returns boolean
 language sql
 stable
as $function$
  select case r.freq
    when 'daily'  then (
      r.active_weekdays is null
      or extract(isodow from d)::int = any(r.active_weekdays)
    )
    when 'weekly' then (r.weekday is not null and extract(isodow from d)::int = r.weekday)
    when 'monthly' then (
        (r.months is null or extract(month from d)::int = any(r.months)) and (
          (r.use_month_end and d = (date_trunc('month',d) + interval '1 month - 1 day')::date)
          or (r.days_of_month is not null and exists (
                select 1 from unnest(r.days_of_month) x
                 where least(x, extract(day from (date_trunc('month',d) + interval '1 month - 1 day'))::int)
                       = extract(day from d)::int))
        ))
    when 'yearly' then (
        (r.months is not null and extract(month from d)::int = any(r.months)) and (
          (r.use_month_end and d = (date_trunc('month',d) + interval '1 month - 1 day')::date)
          or (r.days_of_month is not null and exists (
                select 1 from unnest(r.days_of_month) x
                 where least(x, extract(day from (date_trunc('month',d) + interval '1 month - 1 day'))::int)
                       = extract(day from d)::int))
        ))
    else false
  end;
$function$;

create or replace function public.eip_personal_routine_due_on(r personal_routine, d date)
 returns boolean
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case r.freq
    when 'daily'    then true
    when 'weekdays' then extract(isodow from d)::int between 1 and 5
    when 'weekly'   then (r.weekdays is not null and extract(isodow from d)::int = any(r.weekdays))
    when 'monthly'  then (
        (r.use_month_end and d = (date_trunc('month',d) + interval '1 month - 1 day')::date)
        or (r.days_of_month is not null and exists (
              select 1 from unnest(r.days_of_month) x
               where least(x, extract(day from (date_trunc('month',d) + interval '1 month - 1 day'))::int)
                     = extract(day from d)::int)))
    else false
  end;
$function$;
