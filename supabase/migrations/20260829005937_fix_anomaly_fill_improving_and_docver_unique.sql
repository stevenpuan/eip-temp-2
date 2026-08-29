-- 兩個純 bug 修補，不改動任何既定權限規則：
--
-- (1) anomaly_fill 的 USING 已經允許 status='improving'（當事人在改善中階段可以讀寫這一列），
--     但 WITH CHECK 漏了 'improving'，導致更新後的列不通過檢查 → 當事人在「改善中」
--     補填原因／處理方式必定被回 42501。這是漏寫一個值，補上讓 CHECK 與 USING 一致。
drop policy if exists anomaly_fill on public.eip_anomaly;
create policy anomaly_fill on public.eip_anomaly
  for update
  using (
    tenant_id = current_tenant_id()
    and deleted_at is null
    and subject_id = (select auth.uid())
    and status = any (array['pending_fill','filled','improving'])
  )
  with check (
    tenant_id = current_tenant_id()
    and deleted_at is null
    and subject_id = (select auth.uid())
    and status = any (array['pending_fill','filled','improving'])
  );

-- (2) eip_document_version 缺少 (document_id, version_no) 唯一約束。
--     文件儲存流程是「更新主檔 current_version」＋「插入新版本」，兩段的 RLS 條件不一致時
--     會插出重複的 version_no，之後讀現行版本的 .maybeSingle() 會撞 PGRST116，
--     前端的防呆會把該文件的儲存永久擋死。目前 15 筆版本尚無重複，先補上約束擋住。
create unique index if not exists ux_eip_document_version_doc_ver
  on public.eip_document_version (document_id, version_no);;
