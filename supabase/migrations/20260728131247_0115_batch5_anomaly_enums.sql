-- 0115 批5（前置）：異常缺失模組需要的 enum 值
-- ALTER TYPE ... ADD VALUE 新增的值不能在同一個交易內被使用，
-- 所以 enum 單獨一筆 migration，實際使用放 0116。
-- notification_type 已有 anomaly_opened、notification_entity 已有 anomaly。

alter type public.notification_type add value if not exists 'anomaly_filled';
alter type public.notification_type add value if not exists 'anomaly_confirmed';
alter type public.notification_type add value if not exists 'anomaly_closed';
alter type public.notification_type add value if not exists 'anomaly_overdue';

-- 主管開立缺失要能貼截圖，attachment 的 entity_type 需支援 anomaly
alter type public.attachment_entity add value if not exists 'anomaly';;
