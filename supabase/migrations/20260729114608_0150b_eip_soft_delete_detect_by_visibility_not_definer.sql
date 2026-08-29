-- 0150 的第一版用了一支 SECURITY DEFINER 小函式回讀 deleted_at，
-- 但 eip_soft_delete 本身是 INVOKER，於是 authenticated 反而被 42501 擋在
-- 那支 helper 前面；要修就得把 helper 開給前端，等於多開一個可以探測
-- 任意 id 是否存在的介面。不划算。
--
-- 改用不需要繞過 RLS 的判斷：軟刪除成功之後，那一列對呼叫者就「看不見」了
-- （task_read 等政策結尾都是 and deleted_at is null）。所以刪除之後：
--   ・列已看不見          → 成功（軟刪除生效，或這張表是硬刪除）
--   ・列還看得見且未刪除  → DELETE 被 RLS 擋掉
--   ・列還看得見且已刪除  → 該模組的 SELECT 政策沒有隱藏軟刪除，也算成功
-- 三種情況都不需要 definer，也不會多洩漏任何資料。

drop function if exists public.eip_row_delete_state(text, uuid);

create or replace function public.eip_soft_delete(p_module text, p_id uuid)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare r record; v_before timestamptz; v_exists boolean;
        v_after timestamptz; v_after_exists boolean;
begin
  select * into r from public.eip_deletion_policy where module_key = p_module and is_active;
  if r is null then raise exception '未納管的模組：%', p_module; end if;

  execute format('select deleted_at, true from public.%I where id = $1', r.table_name)
    into v_before, v_exists using p_id;
  if not coalesce(v_exists, false) then
    return jsonb_build_object('ok', false, 'reason', '找不到資料或無權限');
  end if;
  if v_before is not null then
    return jsonb_build_object('ok', true, 'already', true, 'deleted_at', v_before);
  end if;

  -- RLS 的 DELETE 政策在這裡把關
  execute format('delete from public.%I where id = $1', r.table_name) using p_id;

  execute format('select deleted_at, true from public.%I where id = $1', r.table_name)
    into v_after, v_after_exists using p_id;

  if coalesce(v_after_exists, false) and v_after is null then
    -- 列原封不動還在 → 沒刪掉
    return jsonb_build_object('ok', false, 'reason', '無刪除權限');
  end if;

  return jsonb_build_object(
    'ok', true,
    'deleted_at', coalesce(v_after, now()),
    -- 呼叫者已經看不到這一列（被 SELECT 政策隱藏，或硬刪除）
    'hidden', not coalesce(v_after_exists, false)
  );
end;
$function$;

revoke all on function public.eip_soft_delete(text,uuid) from public, anon;
grant execute on function public.eip_soft_delete(text,uuid) to authenticated;;
