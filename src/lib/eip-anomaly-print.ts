// 異常缺失「個人疏失報告」列印：把單筆缺失套進人資既有的紙本格式
// （每日訂單疏失表，範本檔 1130913），交給瀏覽器列印／存 PDF。
//
// 為什麼不做 Word／PDF 檔：人資的需求是「確認資訊沒問題就直接印，不用再調格式」，
// 瀏覽器列印對話框本身就是預覽，也能直接存 PDF，不必再多裝 docx／pdf 套件。
//
// 為什麼用隱藏 iframe 而不是 window.open：新視窗會被彈出視窗攔截擋掉，
// 使用者只會看到「按了沒反應」；iframe 不受攔截影響。
//
// 範本上的固定文字（公司名、表單名、流程四點）依客戶指示照原樣印，集中放在下方常數，
// 換公司或改文字只動這一處。2026-09-03 客戶改表單名為「每日訂單疏失表」並拿掉底部繳交三點。

export type AnomalyPrintData = {
  code: string | null;
  /** 發生日期（YYYY-MM-DD）；沒填時退回開立日期 */
  occurredOn: string | null;
  raisedAt: string;
  title: string;
  detail: string | null;
  severityLabel: string;
  amount: number | string | null;
  cause: string | null;
  actionTaken: string | null;
  prevention: string | null;
  subjectName: string;
  departmentName: string;
  raisedByName: string;
};

const COMPANY_NAME = "艾士實業有限公司";
const FORM_TITLE = "每日訂單疏失表";
const PROCESS_HEADING = "強化訂單、預防疏失基本流程";
const PROCESS_STEPS: { text: string; underline?: string }[] = [
  { text: "1.電話接完訂單 請和客戶複誦做確認" },
  { text: "2.系統KEY完訂單後 再和便條紙加強核對打V 並壓章" },
  {
    text: "3.紙本總訂單上客戶沒叫貨的品項 請一律打X ",
    underline: "(休息附註休 電話未通 請附註 需再撥號 請附註)",
  },
  { text: "4.電話接單臨時寫的便條紙 請訂在總單後面驗核  (並有接單人、人員核對 簽名)" },
];

// 缺失標題／說明／原因都是使用者輸入，一律轉義後才進 HTML
const esc = (s: string | null | undefined) =>
  (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// 多段文字在儲存格裡各自成段；空段落不印
const paras = (parts: (string | null | undefined)[]) =>
  parts
    .filter((p): p is string => !!p && p.trim() !== "")
    .map((p) => `<p>${esc(p.trim())}</p>`)
    .join("");

// 日期欄很窄，年與月日分兩行印（2026 / 09/03）；來源是 YYYY-MM-DD 或 ISO 時間字串。
// 不走 toISOString()：UTC+8 深夜會退回前一天。
const fmtDateCell = (s: string | null) => {
  if (!s) return "";
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  if (Number.isNaN(d.getTime())) return esc(s);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}<br />${mm}/${dd}`;
};

export function buildAnomalyReportHtml(a: AnomalyPrintData): string {
  const date = fmtDateCell(a.occurredOn ?? a.raisedAt);
  const remarks = [
    a.code ? `單號 ${a.code}` : "",
    a.severityLabel ? `嚴重程度：${a.severityLabel}` : "",
    // 未填金額不印，0 元與「不適用」是兩件事
    a.amount == null || a.amount === ""
      ? ""
      : `金額 ${Number(a.amount).toLocaleString("zh-TW")} 元`,
  ];
  const related = [
    a.subjectName,
    a.departmentName,
    // 主管開立時把開立人一起列出；自主填報時開立人就是當事人，不重複印
    a.raisedByName && a.raisedByName !== a.subjectName ? `開立：${a.raisedByName}` : "",
  ];

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<title>${esc(FORM_TITLE)}${a.code ? ` ${esc(a.code)}` : ""}</title>
<style>
  @page { size: A4 portrait; margin: 14mm 16mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Microsoft JhengHei", "PingFang TC", "Noto Sans CJK TC", "Heiti TC", sans-serif;
    color: #000; font-size: 11pt; line-height: 1.45;
  }
  .sheet { width: 178mm; margin: 0 auto; }
  h1, h2 { text-align: center; margin: 0; font-weight: 700; }
  h1 { font-size: 15pt; margin-top: 4mm; }
  h2 { font-size: 15pt; margin: 4mm 0 5mm; }
  .heading { display: inline-block; background: #000; color: #fff; font-weight: 700;
    font-size: 15pt; padding: 0 2mm; margin-bottom: 3mm; }
  .steps p { margin: 0 0 1mm; }
  .steps u { text-decoration: underline; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 8mm 0 6mm; }
  th, td { border: 1px solid #000; padding: 1.5mm 2mm; vertical-align: top; word-break: break-word; }
  th { background: #9e9e9e; font-weight: 700; text-align: center; font-size: 12pt; padding: 3mm 2mm; }
  td.label { text-align: center; padding-top: 3mm; }
  td.label span { display: inline-block; width: 1em; line-height: 1.3; }
  td.date { text-align: center; padding-top: 3mm; white-space: nowrap; }
  td p { margin: 0 0 1.5mm; white-space: pre-wrap; }
  tr.body td { height: 42mm; }
  tr.sign td { height: 22mm; }
  @media print { .sheet { width: auto; } }
</style>
</head>
<body>
<div class="sheet">
  <h1>${esc(COMPANY_NAME)}</h1>
  <h2>${esc(FORM_TITLE)}</h2>
  <div class="heading">${esc(PROCESS_HEADING)}</div>
  <div class="steps">
    ${PROCESS_STEPS.map(
      (s) => `<p>${esc(s.text)}${s.underline ? `<u>${esc(s.underline)}</u>` : ""}</p>`,
    ).join("\n    ")}
  </div>

  <table>
    <colgroup>
      <col style="width:11%" /><col style="width:5%" /><col style="width:17%" /><col style="width:13%" />
      <col style="width:17%" /><col style="width:9%" /><col style="width:14%" /><col style="width:14%" />
    </colgroup>
    <thead>
      <tr>
        <th>日期</th>
        <th colspan="3">訂單缺失</th>
        <th colspan="2">檢討缺失原因</th>
        <th>備註</th>
        <th>相關人員</th>
      </tr>
    </thead>
    <tbody>
      <tr class="body">
        <td class="date" rowspan="2">${date}</td>
        <td class="label"><span>缺失</span></td>
        <td colspan="2">${paras([a.title, a.detail])}</td>
        <td colspan="2" rowspan="2">${paras([a.cause])}</td>
        <td rowspan="2">${paras(remarks)}</td>
        <td rowspan="2">${paras(related)}</td>
      </tr>
      <tr class="body">
        <td class="label"><span>改進</span></td>
        <td colspan="2">${paras([a.actionTaken, a.prevention])}</td>
      </tr>
      <tr>
        <th colspan="3">檢討報告人</th>
        <th colspan="2">單位主管批示</th>
        <th colspan="3">總經理批示</th>
      </tr>
      <tr class="sign">
        <td colspan="3">${esc(a.subjectName)}</td>
        <td colspan="2"></td>
        <td colspan="3"></td>
      </tr>
    </tbody>
  </table>

</div>
</body>
</html>`;
}

/**
 * 開啟瀏覽器列印對話框印出單筆缺失報告。
 * 回傳 false 表示無法建立列印用 iframe（極少見，例如非瀏覽器環境）。
 */
export function printAnomalyReport(a: AnomalyPrintData): boolean {
  if (typeof document === "undefined") return false;
  const html = buildAnomalyReportHtml(a);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const cleanup = () => {
    // 列印對話框關閉後才能移除，太早移除 Safari 會印出空白頁
    window.setTimeout(() => iframe.remove(), 1000);
  };

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return false;
  }
  doc.open();
  doc.write(html);
  doc.close();
  // 一定要在 doc.open() 之後才掛：document.open() 會把該 window 上所有事件監聽都清掉
  win.addEventListener("afterprint", cleanup);
  // 等字型與版面排好再叫列印，否則第一次印會拿到空表格
  window.setTimeout(() => {
    win.focus();
    win.print();
    // 不支援 afterprint 的瀏覽器就用保底時間清掉
    window.setTimeout(cleanup, 60_000);
  }, 150);
  return true;
}
