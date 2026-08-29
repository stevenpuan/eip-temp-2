-- 讓使用者可刪除自己的通知（供「清除已讀」使用）
drop policy if exists notification_delete on public.notification;
create policy notification_delete on public.notification for delete to authenticated
  using (user_id = (select auth.uid()));
grant delete on public.notification to authenticated;;
