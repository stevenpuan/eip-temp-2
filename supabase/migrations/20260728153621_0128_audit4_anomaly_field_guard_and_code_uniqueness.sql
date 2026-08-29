-- 0128 第四輪稽核修正：H1 當事人越權、H3 單號重複、M4 bucket 無限制、M9 TRUNCATE 授權
--
-- 實測結果（以真實 member 張雅婷身分跑，非讀程式碼推論）：
--   ① 自己軟刪除異常單        → 被擋（稽核報告說可滅證，實測是錯的）
--   ② 自己把 status 改 improving → **成功，confirmed_by 被蓋成自己** ← 跳過主管確認這一關
--   ③ 自己把 fill_due_date 改到 999 天後 → **成功** ← 逾期掃描永遠掃不到
--
-- ②③ 是真的。WITH CHECK 只驗「新列的樣子」，無法比對新舊值，
-- 所以光改政策擋不住「改期限」。採用本專案既有的做法
-- （`trg_prevent_app_user_self_escalation` 就是這樣做的）：
-- BEFORE UPDATE 時把非權責欄位強制回填成舊值。

------------------------------------------------------------------
-- H1-a：政策收斂 —— 當事人只能推進到 filled，不能自己改 improving/closed，
--        WITH CHECK 也補上 deleted_at is null（讓「不能滅證」是設計而非巧合）
------------------------------------------------------------------
drop policy if exists anomaly_fill on public.eip_anomaly;
create policy anomaly_fill on public.eip_anomaly
  for update to authenticated
  using (tenant_id = current_tenant_id() and deleted_at is null
         and subject_id = (select auth.uid())
         and status in ('pending_fill','filled','improving'))
  with check (tenant_id = current_tenant_id()
              and deleted_at is null
              and subject_id = (select auth.uid())
              -- 只能停在 pending_fill 或 filled；improving/closed/void 是主管的動作
              and status in ('pending_fill','filled'));

------------------------------------------------------------------
-- H1-b：欄位級保護 —— 不是主管/管理者就把非權責欄位回填成舊值。
--        擋掉「改填報期限躲逾期」、「改嚴重程度/金額」、「改當事人」、
--        以及偽造 confirmed_*/closed_* 稽核欄位。
------------------------------------------------------------------
create or replace function public.eip_fill_anomaly_defaults()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_seq int; v_is_mgr boolean;
begin
  if tg_op = 'INSERT' then
    if new.tenant_id is null then
      select tenant_id into new.tenant_id from public.app_user where id = new.subject_id;
      new.tenant_id := coalesce(new.tenant_id, '00000000-0000-0000-0000-000000000001');
    end if;
    if new.raised_by is null then new.raised_by := auth.uid(); end if;
    if new.department_id is null then
      select department_id into new.department_id from public.app_user where id = new.subject_id;
    end if;
    if new.occurred_on is null then
      new.occurred_on := (new.raised_at at time zone 'Asia/Taipei')::date;
    end if;

    -- H3：單號的月份標籤用台北時間，但原本的流水號分桶用 UTC → 跨月當天兩者不一致，
    -- 而且 count(*)+1 遇到永久刪除的空洞會重用舊號。
    -- 改成：分桶也用台北月份，流水號取「同月現有最大後三碼 + 1」。
    if new.code is null then
      select coalesce(max((regexp_replace(code, '^.*-', ''))::int), 0) + 1
        into v_seq
        from public.eip_anomaly
       where tenant_id = new.tenant_id
         and code ~ '^AN-\d{6}-\d+$'
         and to_char(raised_at at time zone 'Asia/Taipei', 'YYYYMM')
             = to_char(new.raised_at at time zone 'Asia/Taipei', 'YYYYMM');
      new.code := 'AN-' || to_char(new.raised_at at time zone 'Asia/Taipei', 'YYYYMM')
                        || '-' || lpad(v_seq::text, 3, '0');
    end if;

    if new.source = 'supervisor' then
      new.status := coalesce(nullif(new.status,''), 'pending_fill');
      if new.fill_due_date is null then
        new.fill_due_date := (new.raised_at at time zone 'Asia/Taipei')::date + 3;
      end if;
    else
      new.status    := 'filled';
      new.filled_at := coalesce(new.filled_at, now());
      new.filled_by := coalesce(new.filled_by, new.subject_id);
    end if;
  end if;

  if tg_op = 'UPDATE' then
    -- 誰是這張單的權責主管？（cron／service_role 沒有 auth.uid()，一律視為系統，不受限）
    v_is_mgr := auth.uid() is null
             or coalesce(current_role_name()::text,'') = 'company_admin'
             or public.eip_is_dept_supervisor(old.department_id);

    if not v_is_mgr then
      -- H1-b：非權責主管一律回填。當事人只能動 CAPA 三欄與 status(→filled)。
      new.subject_id       := old.subject_id;
      new.source           := old.source;
      new.raised_by        := old.raised_by;
      new.raised_at        := old.raised_at;
      new.code             := old.code;
      new.department_id    := old.department_id;
      new.severity         := old.severity;
      new.amount           := old.amount;
      new.occurred_on      := old.occurred_on;
      new.fill_due_date    := old.fill_due_date;
      new.confirmed_by     := old.confirmed_by;
      new.confirmed_at     := old.confirmed_at;
      new.confirm_note     := old.confirm_note;
      new.improve_due_date := old.improve_due_date;
      new.closed_by        := old.closed_by;
      new.closed_at        := old.closed_at;
      new.close_note       := old.close_note;
      new.void_reason      := old.void_reason;
      new.deleted_at       := old.deleted_at;
      new.deleted_by       := old.deleted_by;
      -- 狀態只允許 pending_fill → filled，其餘一律維持原狀
      if not (old.status = 'pending_fill' and new.status = 'filled') then
        new.status := old.status;
      end if;
    end if;

    if old.status = 'pending_fill' and new.status = 'filled' then
      new.filled_at := coalesce(new.filled_at, now());
      new.filled_by := coalesce(new.filled_by, auth.uid());
    end if;
    if old.status <> 'improving' and new.status = 'improving' then
      new.confirmed_at := coalesce(new.confirmed_at, now());
      new.confirmed_by := coalesce(new.confirmed_by, auth.uid());
    end if;
    if old.status <> 'closed' and new.status = 'closed' then
      new.closed_at := coalesce(new.closed_at, now());
      new.closed_by := coalesce(new.closed_by, auth.uid());
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

revoke execute on function public.eip_fill_anomaly_defaults() from public, anon, authenticated;

------------------------------------------------------------------
-- H3：單號唯一索引。上面已修時區分桶與流水號算法，這裡是兜底 ——
--     並發或未來改動再怎麼樣都不該出現重複單號。
------------------------------------------------------------------
create unique index if not exists uq_eip_anomaly_code
  on public.eip_anomaly(tenant_id, code) where code is not null;

------------------------------------------------------------------
-- M4：anomaly bucket 原本沒有大小上限也沒有 MIME 白名單（documents 50MB／worklog 10MB 都有）。
--     比照 worklog：10MB，只收圖片與 PDF（截圖用途）。
--     不收 html/svg，避免日後用簽章 URL 開啟時的 XSS 面。
------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array[
         'image/png','image/jpeg','image/gif','image/webp','image/heic','image/heif',
         'application/pdf']
 where id = 'anomaly';

------------------------------------------------------------------
-- M9：新表把 TRUNCATE / REFERENCES / TRIGGER 也給了 authenticated。
--     TRUNCATE 不受 RLS 過濾，一句就能清空整表。PostgREST 碰不到，屬縱深防禦。
------------------------------------------------------------------
revoke truncate, references, trigger on public.task_checklist          from authenticated;
revoke truncate, references, trigger on public.eip_anomaly             from authenticated;
revoke truncate, references, trigger on public.eip_anomaly_attachment  from authenticated;
revoke truncate, references, trigger on public.eip_link                from authenticated;

------------------------------------------------------------------
-- L1：eip_anomaly_file_access 是 26 支受稽核函式裡唯一還對 anon 開放的。
--     它內部 `if v_me is null then return false` 是 fail-closed 所以無法利用，
--     但 storage 政策改綁 authenticated 之後就不需要 anon 了。
------------------------------------------------------------------
drop policy if exists anomaly_files_read   on storage.objects;
drop policy if exists anomaly_files_insert on storage.objects;
drop policy if exists anomaly_files_update on storage.objects;
drop policy if exists anomaly_files_delete on storage.objects;

create policy anomaly_files_read on storage.objects
  for select to authenticated using (bucket_id = 'anomaly' and public.eip_anomaly_file_access(name, false));
create policy anomaly_files_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'anomaly' and public.eip_anomaly_file_access(name, true));
create policy anomaly_files_update on storage.objects
  for update to authenticated using (bucket_id = 'anomaly' and public.eip_anomaly_file_access(name, true));
create policy anomaly_files_delete on storage.objects
  for delete to authenticated using (bucket_id = 'anomaly' and public.eip_anomaly_file_access(name, true));

revoke execute on function public.eip_anomaly_file_access(text, boolean) from anon;;
