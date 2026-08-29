-- =====================================================================
-- 0008_seed.sql — 種子資料（新公司開站套用）
-- 內含:1 個 tenant + 預設 task_status 五欄 + 範例 task_type。
-- 角色由 app_user.role 決定;成員於設定頁建立並綁定 LINE,故此處不種子 user。
--
-- 開站時:把下方 tenant 名稱改成該公司名,或由 bootstrap 腳本帶入。
-- =====================================================================

-- ---- 預設租戶（單租戶上線;多公司時每家各一套 Supabase,各自一筆） ----
insert into tenant (id, name)
values ('00000000-0000-0000-0000-000000000001', '預設公司（請於開站時改名）')
on conflict (id) do nothing;

-- ---- task_status 種子:待辦 / 進行中 / 待確認 / 完成 (+卡關) ----
-- 「待確認」= 員工回報完成、等主管驗收才到「完成」。
-- 「卡關」= 讓瓶頸浮現的自訂欄位。
insert into task_status (tenant_id, name, sort_order, is_done_state, is_default) values
  ('00000000-0000-0000-0000-000000000001', '待辦',   1, false, true),
  ('00000000-0000-0000-0000-000000000001', '進行中', 2, false, true),
  ('00000000-0000-0000-0000-000000000001', '待確認', 3, false, true),
  ('00000000-0000-0000-0000-000000000001', '完成',   4, true,  true),
  ('00000000-0000-0000-0000-000000000001', '卡關',   5, false, true)
on conflict do nothing;

-- ---- 範例 task_type（含子任務步驟範本;開站後由使用者自訂增刪） ----
insert into task_type (tenant_id, name, default_steps) values
  ('00000000-0000-0000-0000-000000000001', '拍攝影片',
   '["道具準備","場內生產","拍照前置","拍攝","後製"]'::jsonb),
  ('00000000-0000-0000-0000-000000000001', '一般任務', null)
on conflict do nothing;

-- ---- 範例部門（開站後依該公司實際組織調整） ----
insert into department (tenant_id, name) values
  ('00000000-0000-0000-0000-000000000001', '管理部'),
  ('00000000-0000-0000-0000-000000000001', '業務部'),
  ('00000000-0000-0000-0000-000000000001', '行銷部')
on conflict do nothing;

-- 註:首位 company_admin 帳號於 Supabase Auth 建立 user 後,
--    在 app_user 寫入對應 profile 並設 role = 'company_admin'。
--    見 scripts/bootstrap.md。
