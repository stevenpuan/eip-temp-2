-- ============================================================
-- BLOCKER：eip_soft_delete 對「成功的刪除」一律回報失敗
--
-- 這支是 SECURITY INVOKER（刻意的，要讓 RLS 決定能不能刪）。
-- 但它刪完之後用同一個身分再讀回 deleted_at 來確認結果：
--
--   delete from task where id = $1;            -- guard 改成軟刪除，RETURN NULL
--   select deleted_at from task where id = $1; -- ← 這裡一定讀不到
--
-- 因為 task_read 政策結尾是 `and deleted_at is null`（0095／0111 加的，
-- 連 company_admin 也套用），列一旦被軟刪除就對所有人隱形。
-- 於是 v_after 永遠是 null → 回 {ok:false, reason:'無刪除權限'}。
--
-- 影響：所有角色、所有納管模組。使用者按刪除 → 資料其實已進回收區，
-- 畫面卻說「刪除失敗：僅本人／本部門主管／管理者可刪除」。
-- 之前的驗證沒抓到，是因為我用 postgres 身分測（RLS 直接繞過）。
--
-- 修法：刪除本身維持 INVOKER（RLS 照樣把關），只有「刪完之後的狀態回讀」
-- 改用 SECURITY DEFINER 的小函式繞過 RLS。刪除前的存在性檢查仍然用
-- 呼叫者身分（看不到就等於沒權限），所以不會多洩漏任何資料。
-- ============================================================

create or replace function public.eip_row_delete_state(p_table text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_deleted timestamptz; v_exists boolean;
begin
  -- 只允許 eip_deletion_policy 註冊過的表，避免變成任意表讀取工具
  if not exists (select 1 from public.eip_deletion_policy
                  where table_name = p_table and is_active) then
    raise exception '未納管的資料表：%', p_table;
  end if;
  execute format('select deleted_at, true from public.%I where id = $1', p_table)
    into v_deleted, v_exists using p_id;
  return jsonb_build_object('exists', coalesce(v_exists,false), 'deleted_at', v_deleted);
end;
$$;

revoke all on function public.eip_row_delete_state(text,uuid) from public, anon, authenticated;
-- 只給 eip_soft_delete 內部用；不開給前端呼叫

create or replace function public.eip_soft_delete(p_module text, p_id uuid)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare r record; v_before timestamptz; v_exists boolean; v_state jsonb;
begin
  select * into r from public.eip_deletion_policy where module_key = p_module and is_active;
  if r is null then raise exception '未納管的模組：%', p_module; end if;

  -- 刪除前：用呼叫者身分看。看不到就是沒權限或不存在（維持原語意，不多洩漏）
  execute format('select deleted_at, true from public.%I where id = $1', r.table_name)
    into v_before, v_exists using p_id;
  if not coalesce(v_exists, false) then
    return jsonb_build_object('ok', false, 'reason', '找不到資料或無權限');
  end if;
  if v_before is not null then
    return jsonb_build_object('ok', true, 'already', true, 'deleted_at', v_before);
  end if;

  -- 真正的刪除：仍然是呼叫者身分，RLS 的 DELETE 政策照常把關
  execute format('delete from public.%I where id = $1', r.table_name) using p_id;

  -- 刪除後：改用 definer 回讀。軟刪除的列已經被 SELECT 政策隱形，
  -- 用呼叫者身分讀一定是 null，會把成功誤判成失敗。
  v_state := public.eip_row_delete_state(r.table_name, p_id);

  if (v_state->>'deleted_at') is null then
    -- 列還在而且 deleted_at 仍是 null → DELETE 被 RLS 擋掉了
    if coalesce((v_state->>'exists')::boolean, false) then
      return jsonb_build_object('ok', false, 'reason', '無刪除權限');
    end if;
    -- 列整個不見了 → 這張表是硬刪除（沒有軟刪除 guard），也算成功
    return jsonb_build_object('ok', true, 'hard_deleted', true);
  end if;

  return jsonb_build_object('ok', true, 'deleted_at', (v_state->>'deleted_at')::timestamptz);
end;
$function$;

revoke all on function public.eip_soft_delete(text,uuid) from public, anon;
grant execute on function public.eip_soft_delete(text,uuid) to authenticated;;
