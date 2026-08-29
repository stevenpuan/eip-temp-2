
-- 個人行程加上時間欄位（null = 整天；UI 以 30 分為單位）
alter table public.personal_event
  add column if not exists start_time time,
  add column if not exists end_time   time;
;
