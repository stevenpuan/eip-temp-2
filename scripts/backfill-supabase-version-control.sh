#!/usr/bin/env bash
# 補版控：把雲端 Supabase 的 migration 與 edge function 抓回這個 repo。
#
# 為什麼要手動跑：這支要連 Supabase 雲端（要網路 + 你的資料庫密碼），
# 助理的沙箱環境連不到，所以請在你自己的 Mac 終端機執行。
#
# 用法：
#   cd <repo>
#   bash scripts/backfill-supabase-version-control.sh
#
# 執行前請先確認 git 是乾淨的（git status 沒有未提交的東西）。

set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT_REF=iegkmncnvmmzllqkijxm

echo "==> 0. 檢查 Supabase CLI"
if ! command -v supabase >/dev/null 2>&1; then
  echo "找不到 supabase CLI，請先安裝："
  echo "  brew install supabase/tap/supabase"
  exit 1
fi
supabase --version

echo
echo "==> 1. 連結專案（會問資料庫密碼，只存在本機 supabase/.temp，不會進 git）"
supabase link --project-ref "$PROJECT_REF"

echo
echo "==> 2. 封存 31 個舊的手寫 migration"
# 這些檔名不是雲端歷史的 14 位數字格式（例如 0001_core.sql）。
# 它們不在雲端 migration 歷史裡，留在 supabase/migrations/ 會害之後的
# `supabase db push` 以為還沒套用而想重跑一次 —— 那會很慘。
mkdir -p supabase/_legacy_migrations
moved=0
for f in supabase/migrations/*.sql; do
  [ -e "$f" ] || continue
  base="$(basename "$f")"
  if [[ ! "$base" =~ ^[0-9]{14}_ ]]; then
    git mv "$f" supabase/_legacy_migrations/ 2>/dev/null || mv "$f" supabase/_legacy_migrations/
    moved=$((moved+1))
  fi
done
echo "已封存 $moved 個舊檔到 supabase/_legacy_migrations/"

echo
echo "==> 3. 抓回雲端全部 migration（2026-08-29 當時是 234 個）"
supabase migration fetch

echo
echo "==> 4. 抓回三支沒進版控的 edge function"
for fn in eip-assistant line-push line-webhook; do
  echo "  - $fn"
  supabase functions download "$fn"
done

echo
echo "==> 5. 核對"
echo "--- 雲端 vs 本機 migration 對照（Local 欄位不該有空的）---"
supabase migration list
echo
echo "--- 本機 migration 檔數 ---"
ls supabase/migrations/*.sql | wc -l
echo "--- edge function 目錄 ---"
ls supabase/functions
echo
echo "--- git 變更 ---"
git status --short | head -40

cat <<'TIP'

完成。接著請自己確認後再提交：
  git add supabase
  git commit -m "chore: 補回 Supabase migration 與 edge function 版控"
  git push

注意事項：
  * supabase/config.toml 裡的 verify_jwt 已經照雲端現況填好，
    line-push / line-webhook 一定要維持 false，否則 deploy 會把線上鎖死。
  * 這支腳本只「抓下來」，不會 push 任何東西到雲端，跑錯不會影響線上。
TIP
