-- 任務「補充說明」(task_update.comment) 的作者本人可修改、可刪除
--
-- 問題（2026-09-04 客戶回報）：作者在編輯任務對話框按「編輯」→「儲存」，
-- 畫面跳「修改失敗：只有這則補充說明的作者可以修改」，刪除同樣按了沒效。
-- 根因：task_update 自 0007/0011 起只有 SELECT 與 INSERT 兩條政策，
-- 從來沒有 UPDATE／DELETE 政策；RLS 對沒有政策的指令一律拒絕，PostgREST 回 0 列。
-- 前端的「編輯／刪除」按鈕（tasks.tsx canModify = appUser.id === n.user_id）因此從上線起就不可能成功。
--
-- 修法：補上兩條政策，範圍就是前端訊息講的「作者本人」——user_id = auth.uid()。
-- 不開放管理者改別人的留言：那是需求變動，客戶界線是只修 bug。
-- with_check 與 task_update_insert 對齊，改留言時不能順手把 user_id／task_id 改到別處。

create policy task_update_author_update on public.task_update
  for update
  using (
    tenant_id = current_tenant_id()
    and user_id = (select auth.uid())
  )
  with check (
    tenant_id = current_tenant_id()
    and user_id = (select auth.uid())
    and eip_can_see_task(task_id)
  );

create policy task_update_author_delete on public.task_update
  for delete
  using (
    tenant_id = current_tenant_id()
    and user_id = (select auth.uid())
  );
