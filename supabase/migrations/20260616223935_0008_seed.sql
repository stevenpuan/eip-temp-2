insert into tenant (id, name)
values ('00000000-0000-0000-0000-000000000001', '預設公司（請於開站時改名）')
on conflict (id) do nothing;

insert into task_status (tenant_id, name, sort_order, is_done_state, is_default) values
  ('00000000-0000-0000-0000-000000000001', '待辦',   1, false, true),
  ('00000000-0000-0000-0000-000000000001', '進行中', 2, false, true),
  ('00000000-0000-0000-0000-000000000001', '待確認', 3, false, true),
  ('00000000-0000-0000-0000-000000000001', '完成',   4, true,  true),
  ('00000000-0000-0000-0000-000000000001', '卡關',   5, false, true)
on conflict do nothing;

insert into task_type (tenant_id, name, default_steps) values
  ('00000000-0000-0000-0000-000000000001', '拍攝影片',
   '["道具準備","場內生產","拍照前置","拍攝","後製"]'::jsonb),
  ('00000000-0000-0000-0000-000000000001', '一般任務', null)
on conflict do nothing;

insert into department (tenant_id, name) values
  ('00000000-0000-0000-0000-000000000001', '管理部'),
  ('00000000-0000-0000-0000-000000000001', '業務部'),
  ('00000000-0000-0000-0000-000000000001', '行銷部')
on conflict do nothing;;
