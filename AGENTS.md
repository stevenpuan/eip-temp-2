# 艾士實業 EIP — 開發約定（給 AI 代理與工程師）

本專案為內部管理系統，前端 TanStack Router + React Query + Supabase，後端全表啟用 RLS。
以下是反覆踩過的地雷，請務必遵守。

## 日期與時區（最常出錯，務必遵守）

系統時區是 **Asia/Taipei（UTC+8）**。

- 取「今天」或把 Date 轉成日期字串（YYYY-MM-DD）：**一律**用 `@/lib/eip-routine` 的
  `taipeiToday()` 或 `toDateStr(date)`。
- **禁止** `new Date().toISOString().slice(0, 10)` 這類寫法當日期。`toISOString()` 是 UTC，
  台北在**清晨 8 點前**或**月初/月底**會退回前一天，導致逾期/未回報/達成率整批錯位。
  已有 ESLint 規則（`no-restricted-syntax`）會擋此寫法。
- 寫 `timestamptz` 欄位（如 `submitted_at`、`updated_at`、`completed_at`）用 `toISOString()` 是對的
  （那是「時間點」不是「日期」）。
- `datetime-local` 輸入框需要本地牆上時鐘字串，用 `getTimezoneOffset()` 校正後 `slice(0,16)`；
  這類正確用途請加 `// eslint-disable-next-line no-restricted-syntax -- 原因`。

## 資料查詢與錯誤處理

- Supabase 查詢**一定要檢查 `error`**，不要只解構 `data`。token 過期(PGRST301)/RLS/斷線時
  `data` 會是 null，若不分辨錯誤就顯示空白，使用者會以為資料不見了。
- 寫入後若要判斷是否真的成功，加 `.select("id")` 看回傳筆數；RLS 靜默擋掉時 `error` 可能為 null 但 0 列。
- 錯誤訊息用 `@/lib/eip-error` 的 `humanizeError()` 轉譯，不要把原始 Postgres 代碼丟給使用者。

## 權限

- 功能可見/可用一律讀 `can(module, action)`（來源＝role_module_permissions），**不要寫死角色代碼**。
- 後端寫入政策用 `eip_has_perm(module, action)`，與前端 `can()` 同源，保持一致。

- Install log cleanup through the SQL-only script in `scripts/`; preserve an existing comprehensive cleanup job and its policy settings to avoid dropping unrelated maintenance during migration.

## 刪除

- 刪除走 `eip_soft_delete` RPC，**不要**直接 `UPDATE deleted_at`（會被 RLS 擋）。

## HTML / 使用者輸入

- 任何 `dangerouslySetInnerHTML` 渲染使用者輸入（文件內文、需求描述等）**必須**先過
  `@/lib/sanitize-html` 的 `sanitizeHtml()`，避免儲存型 XSS。
