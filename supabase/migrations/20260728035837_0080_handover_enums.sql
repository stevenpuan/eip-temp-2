-- 0080: 交接/離職機制所需的 enum 值（必須與使用它們的 migration 分開執行）
alter type notification_type   add value if not exists 'reassign_needed';
alter type notification_type   add value if not exists 'handover_created';
alter type notification_type   add value if not exists 'handover_completed';
alter type notification_type   add value if not exists 'anomaly_opened';
alter type notification_entity add value if not exists 'handover';
alter type notification_entity add value if not exists 'anomaly';
alter type notification_entity add value if not exists 'leave_handover';
;
