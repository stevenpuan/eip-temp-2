-- 0094 任務查詢索引（配合前端加時間窗與完成收合）
-- 目的不是現在（155 筆），而是一年後 2,000 筆、三年後 6,000 筆時看板仍然順。

-- 看板／清單主查詢：排除已刪除 + 依狀態 + 依排序
create index if not exists idx_task_live_board
  on public.task (status_id, board_position, created_at desc)
  where deleted_at is null;

-- 「我負責」「我建立的」入口
create index if not exists idx_task_owner_live
  on public.task (owner_id, due_date) where deleted_at is null;
create index if not exists idx_task_created_by_live
  on public.task (created_by, created_at desc) where deleted_at is null;

-- 完成時間窗（近 N 天已完成）
create index if not exists idx_task_completed_at
  on public.task (completed_at desc) where completed_at is not null and deleted_at is null;

-- 常態工作當日展開（eip_worklog_seed 與 eip_run_recurring 都會用到）
create index if not exists idx_task_recurring_occurrence
  on public.task (recurring_rule_id, occurrence_date) where recurring_rule_id is not null;

-- 部門／專案篩選
create index if not exists idx_task_dept_live
  on public.task (department_id) where deleted_at is null;
create index if not exists idx_task_project_live
  on public.task (project_id) where project_id is not null and deleted_at is null;

analyze public.task;
;
