# 資料庫日誌定期清理

在 **EIP_Temp_2 的 Supabase SQL Editor** 執行 `scripts/install_log_cleanup.sql`，確認選到正確專案。此程式未自動執行到任何遠端資料庫，不更換目前連線。

## 執行前

- 先完成 EIP 表結構與函式遷移，並啟用 Supabase 的 `pg_cron`。
- 排程時區必須是 UTC／GMT；程式遇到其他時區會取消安裝。
- 安裝不立即刪除資料，但會啟用下一次每天台北 **06:00** 的清理，執行前請確認備份及保留期限。

## 清理範圍

新增的 `eip_cleanup_system_logs` 只清除 `error_logs`、`activity_logs`、`audit_logs`；不清除帳號、任務、訂單、開發歷程等業務資料。

保留天數讀取現有 `eip_purge_policy`，不覆寫設定；未設定的日誌沿用 **90 天**。停用的項目不清理。以 `created_at` 判斷，剛好在保留期限邊界與沒有日期的資料不刪除。

新程式每日每張表最多清理 **5,000 筆**，降低一次大量刪除的負擔；若累積更多，後續每天繼續處理，因此過期資料可能多留幾天。只有 SQL Editor 的 postgres 身分及受信任的 service_role 能執行，請勿在瀏覽器放置 service_role 金鑰。

若已有 `eip-log-purge-daily` 綜合清理排程，保留其清理通知、對話及回收區的既有指令，只確認時間為台北 06:00，不重複建立排程。**上述每表 5,000 筆上限僅適用新增的日誌程式，不適用既有綜合清理。** 既有同名排程是舊版純日誌清理時，更新成新程式；遇到未知指令會整筆復原，不覆寫。

## 試跑與結果

先試跑，不刪日誌，但會新增執行紀錄：

```sql
select public.eip_cleanup_system_logs(true, 5000);
```

確認 `ok = true`，並檢查每張表的 `days` 與 `rows`。試跑的筆數是全部待清理量，不受單次正式刪除上限限制。

```sql
select ran_at, dry_run, ok, duration_ms, detail, error
from public.eip_purge_run_log
order by ran_at desc limit 20;
```

新程式部分表失敗時，會保留其他表成功結果並記錄 `ok = false`。請以此執行紀錄判斷成功，不只看 cron 顯示成功。未來的執行紀錄與 cron 歷程本次不新增清理規則。

若確認要立即正式清理：

```sql
select public.eip_cleanup_system_logs(false, 5000);
```

## 停用排程

```sql
select cron.alter_job(jobid, active := false)
from cron.job
where jobname = 'eip-log-purge-daily' and username = current_user;
```

停用的是每日清理；若目前沿用綜合清理，也會一併暫停它原本的通知、對話與回收區清理。不會刪除函式或任何資料。