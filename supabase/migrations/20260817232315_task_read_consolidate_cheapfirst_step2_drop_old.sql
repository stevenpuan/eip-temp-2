-- Step 2: drop the two original SELECT policies now that task_read_v2 covers their union.
-- Also removes the multiple-permissive-policies overhead for task SELECT.
drop policy if exists task_read on public.task;
drop policy if exists task_shared_read on public.task;;
