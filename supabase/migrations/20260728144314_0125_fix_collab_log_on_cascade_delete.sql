-- 0125 修一個既有的潛在 bug（在驗證 0124 時撞到的）
--
-- `trg_task_collab_change` 是 task_collaborator 的 AFTER DELETE trigger，
-- 會往 task_change_log 寫一筆「移除協作者」。
-- 但當任務被硬刪除（eip_purge_deleted 放行 guard 之後）時，
-- CASCADE 會先刪掉 task_collaborator，此時 trigger 想寫入的 task_change_log
-- 其 task_id 外鍵已經不存在 → 23503 外鍵違反 → **整個永久刪除失敗**。
--
-- 修法：AFTER DELETE 時先確認母任務還在，不在就不寫紀錄
--       （任務都被清掉了，變更紀錄也會被 CASCADE 清掉，寫了也留不住）。
--
-- 附帶：0124 的 L1 守衛已經讓「有協作者的任務」不能永久刪，所以這條路徑目前走不到；
--       但硬刪任務不是只有這一個入口，把它修乾淨比依賴上層剛好擋住可靠。

create or replace function public.eip_log_task_collab_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if TG_OP = 'INSERT' then
    insert into task_change_log(task_id, changed_by, field, old_value, new_value)
      values (NEW.task_id, auth.uid(), '協作者', null,
              (select name from app_user where id = NEW.user_id));
  elsif TG_OP = 'DELETE' then
    -- 母任務已被刪除（CASCADE 連帶）就不要再寫紀錄，否則外鍵違反會讓刪除整個失敗
    if exists (select 1 from public.task where id = OLD.task_id) then
      insert into task_change_log(task_id, changed_by, field, old_value, new_value)
        values (OLD.task_id, auth.uid(), '協作者',
                (select name from app_user where id = OLD.user_id), null);
    end if;
  end if;
  return null;
end;
$function$;

revoke execute on function public.eip_log_task_collab_change() from public, anon, authenticated;;
