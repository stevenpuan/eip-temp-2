-- 請假交接代辦「拖拉排序」用的 RPC。
-- 為什麼要 RPC：一次拖動可能要改多列 sort_order，逐列 PATCH 會打很多次 API，
-- 中途失敗還會留下半套順序。這裡一次 UPDATE 把傳入順序重新編號成 1..n。
--
-- 刻意用 SECURITY INVOKER（不是 DEFINER）：
--   ・RLS 政策 lhi_update 與 trigger trg_lhi_edit_guard 全部照常生效，
--     只有請假本人（或 company_admin）改得動 sort_order，代理人只能勾完成。
--   ・不需要額外授權判斷，權限來源與其他寫入完全一致。
-- 合併顯示的請假段（例如 9/16 事假 ＋ 9/17~9/27 婚假）會跨多張假單，
-- 所以刻意不限制 p_item_ids 必須同一張 quick_report_id，由 RLS 決定改不改得動。
create or replace function public.eip_reorder_leave_handover_items(p_item_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_updated int;
begin
  if p_item_ids is null or array_length(p_item_ids, 1) is null then
    return 0;
  end if;
  -- 上限防呆：一段請假的代辦不會有上千筆，避免誤傳巨大陣列
  if array_length(p_item_ids, 1) > 500 then
    raise exception '一次最多只能排序 500 筆代辦事項' using errcode = '22023';
  end if;

  with new_order as (
    select t.id, t.ord
      from unnest(p_item_ids) with ordinality as t(id, ord)
  )
  update public.eip_leave_handover_item i
     set sort_order = n.ord
    from new_order n
   where i.id = n.id
     and i.sort_order is distinct from n.ord;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

comment on function public.eip_reorder_leave_handover_items(uuid[]) is
  '把傳入的代辦 id 陣列重新編號為 sort_order 1..n（拖拉排序用）。SECURITY INVOKER，權限由 RLS 與 trg_lhi_edit_guard 決定。';

revoke all on function public.eip_reorder_leave_handover_items(uuid[]) from public;
grant execute on function public.eip_reorder_leave_handover_items(uuid[]) to authenticated;
grant execute on function public.eip_reorder_leave_handover_items(uuid[]) to service_role;;
