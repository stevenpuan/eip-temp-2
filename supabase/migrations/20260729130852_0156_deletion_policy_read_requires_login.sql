-- 掃 anon 全表時發現：eip_deletion_policy 的讀取政策是 `using (true)` 且 TO public，
-- 所以未登入就讀得到 9 列納管設定（module_key／table_name／purge_role）。
-- 不是使用者資料，但它等於把「哪些表存在、哪個模組的永久刪除歸誰」直接攤開，
-- 沒有理由給未登入的人看。前端只在登入後才需要它（回收區頁）。
drop policy if exists edp_read on public.eip_deletion_policy;
create policy edp_read on public.eip_deletion_policy
  for select to authenticated using (true);;
