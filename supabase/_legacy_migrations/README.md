# 封存的舊 migration（不要放回 supabase/migrations/）

封存日：2026-08-29

## 為什麼要搬出來

`supabase/migrations/` 現在是**雲端 migration 歷史的鏡像**（234 個，
與 `supabase_migrations.schema_migrations` 一對一）。
這個資料夾裡的 29 個檔案**不在雲端歷史裡**，留在 migrations/ 會讓
`supabase db push` 以為它們還沒套用而重跑一次。

## 內容分三類

**1. 手寫檔名的早期 migration（9 個）**
`0001_core.sql`、`0002_m1_tasks.sql` … 這種沒有 14 位時間戳的。
Lovable 接手之前的檔案，內容早就被後續 migration 蓋過。

**2. 重複檔（19 個）**
Lovable 先 commit 到 repo、雲端幾秒後才記錄，於是同一支 migration
存在兩個時間戳。已逐檔比對確認**內容相同**（忽略空白與分號差異），例如：
`20260729010119_b7230aff-….sql` ≡ 雲端的 `20260729010123_20260729010119_b7230aff-….sql`

**3. ⚠️ 一個手工補的版控紀錄（1 個）—— 這支特別危險**
`20260630000000_announcement_mgr_delete_and_qr_delete.sql`
當初是人工寫來「補記錄」live migration 0048 的，從來沒有進雲端歷史。
它裡面的三條 policy **已經被後來的稽核輪次改過**：

| policy | 檔案裡的舊版 | 正式庫現況 |
|---|---|---|
| `announcement_manager_delete` | 沒有 `deleted_at is null` | 有 |
| `qr_delete` | 同上 | 有 |
| `qr_update_own` | 同上 | 有 |

正式庫另外還套了 `(select auth.uid())` 的 initplan 最佳化。
**如果把這支放回去讓 db push 跑，會把軟刪除防護和效能最佳化一起洗掉。**

## 這些檔案還留著的理由

純粹當歷史紀錄。要看某段 SQL 當初長什麼樣可以翻，但**不要執行**。
