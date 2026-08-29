-- ============================================================
-- 請假名單全公司可見
-- 原本行事曆讀 eip_calendar_events（security_invoker），一般成員受 qr_read 限制
-- → 只看得到自己的假，別人的請假在行事曆上完全不出現。
--
-- 定案：「誰在哪一天請假」是全公司都該知道的事，但「事由」不是。
-- 因此另開一支 SECURITY DEFINER 函式，只回姓名／部門／區間／代辦是否完成，
-- 不回 detail、不回 leave_type，避免為了顯示名單而放寬 eip_quick_report 的 RLS。
-- ============================================================

create or replace function public.eip_leave_roster(p_from date, p_to date)
returns table (
  id uuid,
  user_id uuid,
  user_name text,
  department_name text,
  start_date date,
  end_date date,
  start_time time,
  end_time time,
  is_full_day boolean,
  handover_done boolean
)
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception '需要登入身分'; end if;
  if p_to < p_from then raise exception '日期範圍顛倒'; end if;
  if p_to - p_from > 400 then raise exception '一次最多查 400 天'; end if;

  return query
  select qr.id,
         qr.submitter_id,
         u.name,
         d.name,
         (qr.leave_from at time zone 'Asia/Taipei')::date,
         (coalesce(qr.leave_to, qr.leave_from) at time zone 'Asia/Taipei')::date,
         (qr.leave_from at time zone 'Asia/Taipei')::time,
         (coalesce(qr.leave_to, qr.leave_from) at time zone 'Asia/Taipei')::time,
         -- 08:00 之前開始且 17:00 之後結束，視為整天
         ((qr.leave_from at time zone 'Asia/Taipei')::time <= '08:30'::time
          and (coalesce(qr.leave_to, qr.leave_from) at time zone 'Asia/Taipei')::time >= '17:00'::time),
         (qr.status = 'done')
    from public.eip_quick_report qr
    join public.app_user u on u.id = qr.submitter_id
    left join public.department d on d.id = qr.department_id
   where qr.tenant_id = current_tenant_id()
     and qr.type = 'leave'
     and qr.deleted_at is null
     and qr.leave_from is not null
     and (qr.leave_from at time zone 'Asia/Taipei')::date <= p_to
     and (coalesce(qr.leave_to, qr.leave_from) at time zone 'Asia/Taipei')::date >= p_from
   order by 5, 3;
end;
$$;

revoke all on function public.eip_leave_roster(date,date) from public, anon;
grant execute on function public.eip_leave_roster(date,date) to authenticated;

comment on function public.eip_leave_roster(date,date) is
  '全公司可見的請假名單（姓名／部門／區間／代辦是否完成）。刻意不回事由與假別，事由仍受 qr_read 保護。';;
