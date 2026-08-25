/**
 * 日期／時間「起訖」欄位的共用邏輯（純函式，沒有 UI）。
 *
 * 為什麼有這個檔案（2026-08-25 客戶回報「快速回報」的日期時間）：
 *  1. 原生 `<input type="date">`／`type="time"` 的日曆／時鐘小視窗會**往下展開蓋住欄位本身**，
 *     選完之後使用者「要按一下視窗外」把小視窗關掉才看得到自己選了什麼。
 *     → 解法是把目前選到的區間用人看得懂的字串顯示在**欄位上方**
 *       （元件在 `components/eip/RangeSummary.tsx`；放下方會被小視窗蓋住）。
 *  2. 起日／起時選好之後，迄日／迄時不會跟著連動，得再選一次；選到早於起點也沒人擋。
 *     → 解法是 `syncToDate` / `syncToTime` 等連動規則，三個入口共用同一套，行為才一致。
 *
 * 三個共用此檔的入口：
 *  ・`components/eip/QuickReportButton.tsx`（右下角浮動「快速回報」）
 *  ・`routes/dashboard/eip/quick-reports.tsx`（「臨時回報」頁的編輯對話框）
 *  ・`components/eip/LeaveRequestDialog.tsx`（「我的工作區」請假申請完整版）
 *
 * 注意：這裡一律用字串運算或 `Date.UTC` 取星期，不碰 `toISOString()`／本地時區，
 * 免得台北 UTC+8 造成日期或星期偏一天（見 AGENTS.md）。
 */

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})/;

/** "2026-08-25" → "8/25(二)"。不合法就原樣回傳，不要在畫面上炸掉 */
export function fmtDate(date: string): string {
  const m = DATE_RE.exec(date);
  if (!m) return date;
  const [, y, mo, d] = m;
  // 用 UTC 建構再取 UTC 星期：避免 new Date("YYYY-MM-DD") 被當 UTC 午夜、在台北退成前一天
  const wd = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))).getUTCDay();
  return `${Number(mo)}/${Number(d)}(${WEEKDAY[wd] ?? ""})`;
}

/** "HH:MM" → 分鐘數；不合法回 null */
function toMinutes(time: string): number | null {
  const m = TIME_RE.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

const pad = (n: number) => String(n).padStart(2, "0");
const fromMinutes = (total: number) => `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;

/** 時間加減分鐘，夾在 00:00–23:59 之內（跨日交給日期欄位處理，這裡不進位） */
export function addMinutes(time: string, minutes: number): string {
  const base = toMinutes(time);
  if (base === null) return time;
  return fromMinutes(Math.min(23 * 60 + 59, Math.max(0, base + minutes)));
}

/** 分鐘數 → "1 小時 30 分" / "45 分" / "9 小時" */
function fmtDuration(minutes: number): string {
  if (minutes <= 0) return "0 分";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} 小時 ${m} 分`;
  if (h) return `${h} 小時`;
  return `${m} 分`;
}

/** 兩個日期字串相差幾天（含頭含尾）；任一不合法回 null */
function dayCount(fromDate: string, toDate: string): number | null {
  const a = DATE_RE.exec(fromDate);
  const b = DATE_RE.exec(toDate);
  if (!a || !b) return null;
  const ms =
    Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3])) -
    Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  return Math.floor(ms / 86400000) + 1;
}

/** 日期區間摘要："8/25(二) ～ 8/26(三)（2 天）"；都沒選回空字串 */
export function summarizeDateRange(fromDate: string, toDate: string): string {
  if (!fromDate && !toDate) return "";
  if (fromDate && toDate) {
    if (fromDate === toDate) return `${fmtDate(fromDate)}（1 天）`;
    const days = dayCount(fromDate, toDate);
    const tail = days && days > 0 ? `（${days} 天）` : "";
    return `${fmtDate(fromDate)} ～ ${fmtDate(toDate)}${tail}`;
  }
  return `${fromDate ? fmtDate(fromDate) : "—"} ～ ${toDate ? fmtDate(toDate) : "—"}`;
}

/**
 * 時段摘要："09:00 ～ 10:30（1 小時 30 分）"。
 * `emptyLabel` 給請假用（兩邊都沒填＝整日）。只填一邊時另一邊顯示 —。
 */
export function summarizeTimeRange(fromTime: string, toTime: string, emptyLabel = ""): string {
  if (!fromTime && !toTime) return emptyLabel;
  const a = toMinutes(fromTime);
  const b = toMinutes(toTime);
  if (a !== null && b !== null && b >= a) {
    return `${fromTime} ～ ${toTime}（${fmtDuration(b - a)}）`;
  }
  return `${fromTime || "—"} ～ ${toTime || "—"}`;
}

/** 日期＋時間合併摘要（請假申請那張表單的起訖各自帶時間，用這個） */
export function summarizeDateTimeRange(
  fromDate: string,
  fromTime: string,
  toDate: string,
  toTime: string,
): string {
  if (!fromDate && !toDate) return "";
  const left = `${fromDate ? fmtDate(fromDate) : "—"}${fromTime ? ` ${fromTime}` : ""}`;
  const right = `${toDate ? fmtDate(toDate) : "—"}${toTime ? ` ${toTime}` : ""}`;
  const days = fromDate && toDate ? dayCount(fromDate, toDate) : null;
  if (fromDate && fromDate === toDate) {
    const span = summarizeTimeRange(fromTime, toTime, "整日");
    return `${fmtDate(fromDate)} ${span}`;
  }
  return `${left} ～ ${right}${days && days > 0 ? `（${days} 天）` : ""}`;
}

/** 起日改變後迄日該是什麼：空的或早於起日就跟上，其餘不動使用者已選的 */
export function syncToDate(nextFromDate: string, toDate: string): string {
  if (!nextFromDate) return toDate;
  if (!toDate || toDate < nextFromDate) return nextFromDate;
  return toDate;
}

/** 迄日改變後起日該是什麼：空的或晚於迄日就跟上 */
export function syncFromDate(nextToDate: string, fromDate: string): string {
  if (!nextToDate) return fromDate;
  if (!fromDate || fromDate > nextToDate) return nextToDate;
  return fromDate;
}

/**
 * 起時改變後迄時該是什麼。
 * 只有「同一天（或純時段）」才連動：跨日的迄時屬於最後一天，不能拿起時去推。
 * 迄時空的、或早於／等於起時，就補成起時 + `defaultMinutes`（預設 1 小時）。
 */
export function syncToTime(
  nextFromTime: string,
  toTime: string,
  opts: { sameDay?: boolean; defaultMinutes?: number } = {},
): string {
  const { sameDay = true, defaultMinutes = 60 } = opts;
  if (!nextFromTime || !sameDay) return toTime;
  const next = toMinutes(nextFromTime);
  const cur = toMinutes(toTime);
  if (next === null) return toTime;
  if (cur === null || cur <= next) return addMinutes(nextFromTime, defaultMinutes);
  return toTime;
}
