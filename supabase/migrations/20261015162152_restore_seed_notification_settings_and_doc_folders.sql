-- 複製專案時只帶結構未帶種子資料：補回通知規則（依歷次 migration 的最終狀態）與文件中心預設資料夾
-- 已套用至 Supabase（version 20261015162152）
insert into public.notification_setting
  (tenant_id, event_code, department_id, recipient_scopes, notif_type, in_app_enabled, line_enabled, is_active)
select '00000000-0000-0000-0000-000000000001', v.event_code, null, v.scopes, v.notif_type, v.in_app, v.line, true
from (values
  ('task_assigned',            array['owner'],                                                     'assigned',           true, true ),
  ('task_status_changed',      array['owner','dept_manager'],                                      'status_changed',     true, false),
  ('task_comment_added',       array['owner'],                                                     'mentioned',          true, false),
  ('quick_report_submitted',   array['dept_manager'],                                              'quick_report',       true, true ),
  ('recurring_due_soon',       array['owner'],                                                     'due_soon',           true, false),
  ('recurring_overdue',        array['owner','dept_manager','parent_dept_manager'],                'overdue',            true, true ),
  ('announcement_published',   '{}'::text[],                                                       'announcement',       true, false),
  ('meeting_invited',          '{}'::text[],                                                       'assigned',           true, false),
  ('worklog_submitted',        array['dept_manager','parent_dept_manager'],                        'review_needed',      true, false),
  ('worklog_nudge',            array['owner'],                                                     'review_needed',      true, true ),
  ('worklog_reviewed',         array['owner'],                                                     'worklog_reviewed',   true, false),
  ('leave_handover_created',   array['deputy','dept_manager','parent_dept_manager','role:company_admin'], 'handover_created', true, true ),
  ('leave_handover_completed', array['owner','dept_manager','parent_dept_manager'],                'handover_completed', true, false),
  ('direct_notify',            '{}'::text[],                                                       'assigned',           true, true ),
  ('anomaly_opened',           array['owner','deputy'],                                            'anomaly_opened',     true, true ),
  ('anomaly_filled',           array['dept_manager'],                                              'anomaly_filled',     true, true ),
  ('anomaly_confirmed',        array['owner'],                                                     'anomaly_confirmed',  true, true ),
  ('anomaly_closed',           array['owner'],                                                     'anomaly_closed',     true, false),
  ('anomaly_overdue',          array['owner','dept_manager'],                                      'anomaly_overdue',    true, true )
) v(event_code, scopes, notif_type, in_app, line)
where not exists (
  select 1 from public.notification_setting s
   where s.tenant_id = '00000000-0000-0000-0000-000000000001'
     and s.event_code = v.event_code and s.department_id is null);

insert into public.eip_doc_folder (tenant_id, name, sort_order)
select '00000000-0000-0000-0000-000000000001', v.name, v.so
from (values ('標準作業程序(SOP)',1),('公司制度規章',2),('表單範本',3)) v(name, so)
where not exists (select 1 from public.eip_doc_folder where tenant_id='00000000-0000-0000-0000-000000000001');
