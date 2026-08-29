-- 與既有 eip_reorder_task_checklist(p_task_id, p_ids) 對齊：參數名一律 p_ids、
-- sort_order 用 ord*10（留間隔，之後新增的項目取 max+1 仍會排在最後）。
drop function if exists public.eip_reorder_leave_handover_items(uuid[]);

-- 請假交接代辦「拖拉排序」用的 RPC。
-- 為什麼要 RPC：一次拖動要改多列 sort_order，逐列 PATCH 會打很多次 API，
-- 中途失敗還會留下半套順序。這裡一次 UPDATE 把傳入順序重新編號。
--
-- 刻意用 SECURITY INVOKER（不是 DEFINER）：RLS 政策 lhi_update 與
-- trigger trg_lhi_edit_guard 全部照常生效 —— 只有請假本人（或 company_admin）
-- 改得動 sort_order，代理人只能勾完成（實測會擋成 42501）。
-- 合併顯示的請假段（例：9/16 事假 ＋ 9/17~9/27 婚假）會跨多張假單，
-- 所以刻意不限制 p_ids 必須同一張 quick_report_id，由 RLS 決定改不改得動。
create or replace function public.eip_reorder_leave_handover_items(p_ids uuid[])
returns integer
language plpgsql
set search_path to 'public'
as $$
declare
  v_n int := 0;
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;
  -- 上限防呆：一段請假的代辦不會有上千筆，避免誤傳巨大陣列
  if array_length(p_ids, 1) > 500 then
    raise exception '一次最多只能排序 500 筆代辦事項' using errcode = '22023';
  end if;

  update public.eip_leave_handover_item i
     set sort_order = (idx.ord) * 10
    from unnest(p_ids) with ordinality as idx(id, ord)
   where i.id = idx.id
     and i.sort_order is distinct from (idx.ord) * 10;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.eip_reorder_leave_handover_items(uuid[]) is
  '把傳入的代辦 id 陣列重新編號為 sort_order = 順序*10（拖拉排序用）。SECURITY INVOKER，權限由 RLS 與 trg_lhi_edit_guard 決定。';

revoke all on function public.eip_reorder_leave_handover_items(uuid[]) from public;
revoke execute on function public.eip_reorder_leave_handover_items(uuid[]) from anon;
grant execute on function public.eip_reorder_leave_handover_items(uuid[]) to authenticated;
grant execute on function public.eip_reorder_leave_handover_items(uuid[]) to service_role;;
