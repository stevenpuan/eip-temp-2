-- LINE 助理意圖對照 v2：行事曆／會議改由 LINE 直接查；新增訂單、客戶、價格、業績、團隊任務；
-- 移除互相衝突的關鍵字（「今天」→ 工作概況、「統計」→ 報表分析）。
-- 已套用到 Supabase 專案 tjkeycrbgkyvlxwywyvt

update public.eip_assistant_intent set keywords = array['概況','待辦','要做什麼','我的工作','有沒有逾期','儀表板','dashboard'], updated_at = now()
 where feature = '工作概況';

update public.eip_assistant_intent set keywords = array['行事曆','行程','今天有什麼','明天有什麼','這週安排','排程','時程','calendar'],
       intent = 'get_today_agenda', in_line_assistant = true,
       example_questions = array['今天有什麼行程？','明天要做什麼？','這週的安排'], updated_at = now()
 where feature = '行事曆';

update public.eip_assistant_intent set keywords = array['開會','會議時間','有什麼會','meeting'],
       intent = 'get_today_agenda', in_line_assistant = true,
       note = '只查會議時間地點；議程、決議、會議紀錄請到網頁', updated_at = now()
 where feature = '會議';

update public.eip_assistant_intent set keywords = array['報表','完成率','逾期率','達成率','任務統計','report'], updated_at = now()
 where feature = '報表分析';

insert into public.eip_assistant_intent (tenant_id, feature, keywords, example_questions, intent, in_line_assistant, web_route, note, sort_order)
select t.tenant_id, v.feature, v.keywords, v.examples, v.intent, v.in_line, v.route, v.note, v.sort_order
  from (select distinct tenant_id from public.eip_assistant_intent) t
 cross join (values
   ('會議紀錄', array['議程','決議','會議紀錄','行動項目'], array['上次會議的決議'], 'web:會議', false, '/dashboard/eip/meetings', null, 65),
   ('團隊任務', array['大家的任務','部門任務','誰逾期','手上有什麼','團隊'], array['部門有誰的任務逾期？','王大明手上有什麼任務？'], 'list_team_tasks', true, '/dashboard/eip/tasks', '管理者看全公司、主管看管轄部門', 22),
   ('下訂單', array['下單','叫貨','訂貨','要貨','照舊','跟上次一樣'], array['下單，王記，原味 10 箱，週五送','王記照舊'], 'create_order_draft', true, '/dashboard/eip/sales-orders', null, 140),
   ('訂單查詢', array['訂單','單號','待覆核','出貨','交貨','幾張單'], array['今天有幾張單要出貨？','SO261016-001 的內容','待覆核的單有哪些？'], 'query_sales_orders / get_sales_order', true, '/dashboard/eip/sales-orders', null, 150),
   ('客戶資料', array['客戶','地址','電話','付款條件','聯絡人','分店'], array['大成的送貨地址','王記的付款條件'], 'lookup_customer', true, '/dashboard/eip/order-master', null, 160),
   ('價格查詢', array['價格','單價','多少錢','報價','牌價','專屬價'], array['原味豆乾賣王記多少？','禮盒組多少錢？'], 'lookup_price', true, '/dashboard/eip/order-master', null, 170),
   ('業績統計', array['業績','營業額','銷售','賣了多少','排行','叫最多'], array['這個月業績多少？','哪個客戶叫最多？','原味豆乾這個月賣幾箱？'], 'sales_summary', true, '/dashboard/eip/sales-orders', '只算已確認訂單', 180)
 ) as v(feature, keywords, examples, intent, in_line, route, note, sort_order)
 where not exists (select 1 from public.eip_assistant_intent x where x.tenant_id = t.tenant_id and x.feature = v.feature);
