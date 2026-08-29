-- ============================================================
-- 定案調整：請假可以先送出，代理人與代辦事後在「交接代辦」補登
-- 這帶出兩個後端缺口：
--  A. 事後才指定代理人時，既有「未指派」的代辦不會自動掛給他
--     （eip_fill_lhi_defaults 掛在項目表，改請假單不會觸發）
--  B. lhi_update 的 USING/WITH_CHECK 都是 eip_can_see_leave()，
--     代理人／被指派者可以改掉請假本人寫的事項標題與指派對象。
--     這在「事後補登」的流程下更容易發生（同一份清單多人同時碰）。
-- ============================================================

-- ---------- A. 指定代理人時回填未指派的代辦 ----------
create or replace function public.eip_backfill_lhi_on_deputy_set()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.type = 'leave'
     and new.deputy_id is not null
     and new.deputy_id is distinct from old.deputy_id then
    update public.eip_leave_handover_item
       set assignee_id = new.deputy_id, updated_at = now()
     where quick_report_id = new.id
       and assignee_id is null
       and done_at is null;   -- 已完成的不動，完成者是誰要留著
  end if;
  return new;
end;
$$;

revoke all on function public.eip_backfill_lhi_on_deputy_set() from public, anon, authenticated;

drop trigger if exists trg_lhi_backfill_on_deputy_set on public.eip_quick_report;
create trigger trg_lhi_backfill_on_deputy_set
  after update of deputy_id on public.eip_quick_report
  for each row execute function public.eip_backfill_lhi_on_deputy_set();

-- ---------- B. 只有請假本人／管理者可以改代辦的「內容」 ----------
-- 其他人（代理人、被指派者、主管）只能改完成狀態。
-- 用 trigger 而不是 RLS，因為 RLS 沒有欄位粒度。
create or replace function public.eip_lhi_edit_guard()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare v_me uuid := auth.uid(); v_owner uuid;
begin
  -- service_role / 排程（無 JWT）不受限
  if v_me is null then return new; end if;
  if current_role_name() = 'company_admin' then return new; end if;

  select q.submitter_id into v_owner
    from public.eip_quick_report q where q.id = new.quick_report_id;
  if v_owner = v_me then return new; end if;

  if new.title is distinct from old.title
     or new.assignee_id is distinct from old.assignee_id
     or new.url is distinct from old.url
     or new.sort_order is distinct from old.sort_order
     or new.quick_report_id is distinct from old.quick_report_id then
    raise exception '只有請假本人可以修改代辦事項的內容，你可以勾選完成'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.eip_lhi_edit_guard() from public, anon, authenticated;

drop trigger if exists trg_lhi_edit_guard on public.eip_leave_handover_item;
create trigger trg_lhi_edit_guard
  before update on public.eip_leave_handover_item
  for each row execute function public.eip_lhi_edit_guard();

comment on trigger trg_lhi_edit_guard on public.eip_leave_handover_item is
  '代理人／被指派者只能改 done_at/done_by；事項內容只有請假本人與管理者能改（0149）。';;
