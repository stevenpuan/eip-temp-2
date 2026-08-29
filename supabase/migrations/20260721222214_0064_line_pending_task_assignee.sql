-- 支援 LINE 指派任務給其他成員:暫存表記錄指派對象(owner)與其部門
alter table public.line_pending_task add column if not exists owner_id uuid references public.app_user(id) on delete set null;
alter table public.line_pending_task add column if not exists department_id uuid references public.department(id) on delete set null;;
