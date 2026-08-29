UPDATE public.task t
SET department_id = o.department_id
FROM public.app_user o
WHERE o.id = t.owner_id
  AND t.deleted_at IS NULL
  AND o.department_id IS NOT NULL
  AND (t.department_id IS NULL OR t.department_id <> o.department_id);;
