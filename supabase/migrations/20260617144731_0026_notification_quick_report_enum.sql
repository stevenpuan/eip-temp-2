-- 擴充通知 enum,讓臨時回報能進通知中心(enum 新增值需獨立 migration)
alter type notification_type   add value if not exists 'quick_report';
alter type notification_entity add value if not exists 'quick_report';;
