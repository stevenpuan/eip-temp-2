-- ============================================================
-- 清除測試資料（上線前執行一次）
-- 範圍：
--   * 員工編號 T001~T009 的測試帳號（含登入帳號）
--   * 部門代碼以 'T-' 開頭的測試部門
--   * 標題含「[測試]」的資料，以及測試帳號建立／負責的資料
-- 不會動到：syichg@gmail.com、A0001、通知規則、選單權限等系統設定
-- 執行方式：Supabase 後台 SQL Editor 貼上整段執行。
--           整段是單一交易，任何一步失敗就全部不生效。
-- 想先試跑不刪除：把最後一行 `end $cleanup$;` 前面的
--           `-- raise exception` 那行取消註解，執行後會回報剩餘筆數並全部復原。
-- ============================================================
do $cleanup$
declare tu uuid[]; td uuid[]; tt uuid[]; rep text;
begin
  tu := array(select id from public.app_user where employee_no ~ '^T00[0-9]$');
  td := array(select id from public.department where code like 'T-%');
  tt := array(select id from public.task where title like '[測試]%' or owner_id = any(tu) or created_by = any(tu));

  -- 通知
  delete from public.eip_notification_miss where user_id = any(tu);
  delete from public.notification where user_id = any(tu) or message like '%[測試]%' or entity_id = any(tt);

  -- 會議
  delete from public.meeting_action_item where meeting_id in (select id from public.meeting where title like '[測試]%');
  delete from public.meeting_agenda_item where meeting_id in (select id from public.meeting where title like '[測試]%');
  delete from public.meeting_attendee where meeting_id in (select id from public.meeting where title like '[測試]%') or user_id = any(tu);
  delete from public.meeting where title like '[測試]%' or created_by = any(tu);

  -- 任務
  delete from public.comment where entity_id = any(tt) or user_id = any(tu);
  delete from public.task_update where task_id = any(tt) or user_id = any(tu);
  delete from public.task_checklist where task_id = any(tt);
  delete from public.task_collaborator where task_id = any(tt) or user_id = any(tu);
  delete from public.task_change_log where task_id = any(tt);
  delete from public.eip_link where from_id = any(tt) or to_id = any(tt);
  delete from public.task where id = any(tt);
  delete from public.recurring_rule where title like '[測試]%' or owner_id = any(tu);

  -- 專案
  delete from public.milestone where project_id in (select id from public.project where name like '[測試]%');
  delete from public.project_member where project_id in (select id from public.project where name like '[測試]%') or user_id = any(tu);
  delete from public.project where name like '[測試]%';

  -- 公告
  delete from public.announcement_read where user_id = any(tu) or announcement_id in (select id from public.announcement where title like '[測試]%');
  delete from public.announcement_target where announcement_id in (select id from public.announcement where title like '[測試]%');
  delete from public.announcement where title like '[測試]%';

  -- 請假／回報
  delete from public.eip_leave_handover_item where quick_report_id in (select id from public.eip_quick_report where submitter_id = any(tu));
  delete from public.eip_handover_item where user_id = any(tu);
  delete from public.eip_quick_report where submitter_id = any(tu);

  -- 異常缺失
  delete from public.eip_anomaly_attachment where anomaly_id in (select id from public.eip_anomaly where subject_id = any(tu));
  delete from public.eip_anomaly where subject_id = any(tu) or title like '[測試]%';

  -- 工作日誌
  delete from public.work_log_review where work_log_id in (select id from public.work_log where user_id = any(tu));
  delete from public.work_log_item where work_log_id in (select id from public.work_log where user_id = any(tu));
  delete from public.work_log where user_id = any(tu);

  -- 其他
  delete from public.eip_document_version where document_id in (select id from public.eip_document where title like '[測試]%');
  delete from public.eip_document where title like '[測試]%';
  delete from public.eip_feature_request where title like '[測試]%' or submitter_id = any(tu);
  delete from public.personal_event_share where user_id = any(tu);
  delete from public.personal_event where user_id = any(tu);
  delete from public.personal_routine where user_id = any(tu);
  delete from public.phone_order_daily where user_id = any(tu);
  delete from public.phone_order_month where user_id = any(tu);
  delete from public.eip_dept_supervisor where user_id = any(tu) or department_id = any(td);
  delete from public.eip_dept_view_grant where department_id = any(td);

  -- 帳號與部門
  update public.app_user set deputy_id = null where deputy_id = any(tu);
  update public.department set manager_id = null where id = any(td);
  delete from public.user_roles where user_id = any(tu);
  delete from public.app_user where id = any(tu);
  delete from public.profiles where id = any(tu);
  delete from auth.identities where user_id = any(tu);
  delete from auth.users where id = any(tu);
  delete from public.department where id = any(td) and parent_id is not null;
  delete from public.department where id = any(td);

  -- 訂單接收：測試訂單與 [測試] 主檔（上線前清空訂單；主檔只刪 [測試] 開頭的）
  delete from public.notification where entity_type = 'sales_order';
  delete from public.line_pending_order;
  delete from public.line_inbound_message;
  delete from public.eip_sales_order_log;
  delete from public.eip_sales_order_line;
  delete from public.eip_sales_order;
  delete from public.eip_customer where name like '[測試]%';
  delete from public.eip_product where name like '[測試]%';

  rep := format('剩餘：測試帳號=%s 測試部門=%s 任務=%s 專案=%s 會議=%s 公告=%s 回報=%s 缺失=%s 日誌=%s ｜保留：syichg=%s A0001=%s 通知規則=%s',
    (select count(*) from public.app_user where employee_no ~ '^T00[0-9]$'),
    (select count(*) from public.department where code like 'T-%'),
    (select count(*) from public.task), (select count(*) from public.project),
    (select count(*) from public.meeting), (select count(*) from public.announcement),
    (select count(*) from public.eip_quick_report), (select count(*) from public.eip_anomaly),
    (select count(*) from public.work_log),
    (select count(*) from public.app_user where email = 'syichg@gmail.com'),
    (select count(*) from public.app_user where employee_no = 'A0001'),
    (select count(*) from public.notification_setting));
  raise notice '%', rep;
  -- raise exception '試跑（已全部復原）：%', rep;
end $cleanup$;
