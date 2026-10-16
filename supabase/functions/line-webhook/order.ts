// order.ts：LINE 訂單接收（文字／照片／檔案 → AI 解析 → 訂單草稿 → 老闆確認 → 內勤覆核）
//
// 流程：
//   1. 老闆傳文字（或照片、PDF、Excel）→ parseOrder() 以主檔清單為依據抽出客戶、交期、品項
//   2. 伺服器端再用主檔做一次「確定性比對」（代號／名稱／別名／相近字），AI 給的對應只當參考
//   3. 建立 eip_sales_order（status=draft）＋單身；送貨地址、聯絡人、付款條件、稅別、單價
//      由資料庫觸發器依客戶主檔／客戶價格／品項牌價自動帶入（網頁與 LINE 同一套規則）
//   4. 檢查交期、重複下單、數量異常、單位、最小訂量，寫進「待確認」交給內勤
//   學習資料（2026-10-17）：說法對照、客戶專屬說法、常訂品項（含凌越歷史）、過去範例，一起給 AI 參考；
//   伺服器比對時客戶專屬說法優先、多筆相近時依常訂判斷、沒講單位依慣用單位；有疑問的品項附按鈕讓老闆點選。
//   5. 老闆回「送出訂單」→ status=pending_review（觸發器通知覆核人員）
//      直接打字＝修改草稿（例：第2項改20箱、交期改週五），「取消訂單」＝作廢
// 安全：service_role 繞過 RLS，權限一律以 eip_user_has_perm(使用者, 'eip_sales_order', 'create') 自行把關。

export const ORDER_MODEL = "claude-sonnet-4-6";
export const PENDING_MINUTES = 60;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const CATALOG_LIMIT = 600;

export interface OrderMe { id: string; name: string; tenant_id: string; role: string; department_id?: string | null; line_user_id?: string | null }

export interface Attachment { path: string; name: string; mime: string; size: number }

type Addr = { id: string; label: string; address: string };
type Cust = { id: string; code: string | null; name: string; short_name: string | null; aliases: string[] | null; address: string | null; delivery_lead_days: number | null; eip_customer_address?: Addr[] };
type PUnit = { unit: string; ratio: number };
type Prod = { id: string; code: string | null; name: string; spec: string | null; unit: string | null; aliases: string[] | null; unit_price: number | null; min_order_qty: number | null; eip_product_unit?: PUnit[] };
export type Catalog = { customers: Cust[]; products: Prod[] };

// ───────────────────────── 工具 ─────────────────────────

export function taipeiToday(): { date: string; weekday: string } {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const date = now.toISOString().slice(0, 10);
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][now.getUTCDay()];
  return { date, weekday };
}

const WDAY = ["日", "一", "二", "三", "四", "五", "六"];
export const weekdayOf = (d: string) => WDAY[new Date(d + "T00:00:00Z").getUTCDay()];
export const addDays = (d: string, n: number) => {
  const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const dayLabel = (d: string) => `${d}（${weekdayOf(d)}）`;
/** 台北時間的日期對照表，放進系統提示，讓 AI 不用自己算日期 */
export function dateGuide(): string {
  const { date: today } = taipeiToday();
  const dow = new Date(today + "T00:00:00Z").getUTCDay(); // 0=日
  const mon = addDays(today, -((dow + 6) % 7));
  const month = today.slice(0, 7);
  const lastDay = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
  const prevMonth = addDays(`${month}-01`, -1).slice(0, 7);
  return [
    `今天 ${dayLabel(today)}；昨天 ${dayLabel(addDays(today, -1))}；明天 ${dayLabel(addDays(today, 1))}；後天 ${dayLabel(addDays(today, 2))}`,
    `本週（週一到週日）${mon} ～ ${addDays(mon, 6)}；下週 ${addDays(mon, 7)} ～ ${addDays(mon, 13)}；上週 ${addDays(mon, -7)} ～ ${addDays(mon, -1)}`,
    `本月 ${month}-01 ～ ${lastDay(month)}；上個月 ${prevMonth}-01 ～ ${lastDay(prevMonth)}`,
    `本週各天：${Array.from({ length: 7 }, (_, i) => { const d = addDays(mon, i); return `週${weekdayOf(d)} ${d.slice(5)}`; }).join("、")}`,
    `下週各天：${Array.from({ length: 7 }, (_, i) => { const d = addDays(mon, 7 + i); return `週${weekdayOf(d)} ${d.slice(5)}`; }).join("、")}`,
  ].join("\n");
}


export function norm(s: string | null | undefined): string {
  return String(s ?? "").toLowerCase().replace(/[\s　\-_.,，。、()（）「」【】]/g, "");
}

function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[m][n];
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const wdOf = (d: string) => ["日", "一", "二", "三", "四", "五", "六"][new Date(d + "T00:00:00Z").getUTCDay()];

// 確定性比對：完全相符（代號/名稱/簡稱/別名）→ 唯一包含 → 編輯距離 ≤1（且唯一）。對不到就回 null，交給內勤。
export function matchByNames<T extends { id: string; code: string | null; name: string; aliases: string[] | null }>(
  list: T[], text: string | null | undefined, hint: string | null | undefined, extra?: (t: T) => (string | null)[],
): { item: T | null; candidates: T[] } {
  const keysOf = (t: T) => [t.code, t.name, ...(t.aliases ?? []), ...(extra ? extra(t) : [])].map(norm).filter(Boolean);
  for (const q of [hint, text]) {
    const n = norm(q);
    if (!n) continue;
    const exact = list.filter((t) => keysOf(t).includes(n));
    if (exact.length === 1) return { item: exact[0], candidates: [] };
    if (exact.length > 1) return { item: null, candidates: exact.slice(0, 5) };
  }
  const n = norm(text);
  if (!n) return { item: null, candidates: [] };
  const contains = list.filter((t) => keysOf(t).some((k) => k.length >= 2 && (k.includes(n) || n.includes(k))));
  if (contains.length === 1) return { item: contains[0], candidates: [] };
  if (contains.length > 1) return { item: null, candidates: contains.slice(0, 5) };
  const near = list.filter((t) => keysOf(t).some((k) => lev(k, n) <= 1));
  if (near.length === 1) return { item: near[0], candidates: [] };
  return { item: null, candidates: near.slice(0, 5) };
}

// 送貨地點：比對客戶的分店標籤或地址
function matchAddress(addrs: Addr[], text: string | null | undefined): Addr | null {
  const n = norm(text);
  if (!n || !addrs.length) return null;
  const hit = addrs.filter((a) => {
    const l = norm(a.label), ad = norm(a.address);
    return l === n || ad === n || (l.length >= 2 && n.includes(l)) || (n.length >= 2 && l.includes(n)) || (n.length >= 6 && ad.includes(n));
  });
  return hit.length === 1 ? hit[0] : null;
}

async function loadCatalog(sb: any, tenantId: string): Promise<Catalog> {
  const [{ data: c }, { data: p }] = await Promise.all([
    sb.from("eip_customer").select("id,code,name,short_name,aliases,address,delivery_lead_days,eip_customer_address(id,label,address,is_active)")
      .eq("tenant_id", tenantId).eq("is_active", true).order("name").limit(CATALOG_LIMIT),
    sb.from("eip_product").select("id,code,name,spec,unit,aliases,unit_price,min_order_qty,eip_product_unit(unit,ratio)")
      .eq("tenant_id", tenantId).eq("is_active", true).order("name").limit(CATALOG_LIMIT),
  ]);
  const customers = ((c ?? []) as any[]).map((x) => ({ ...x, eip_customer_address: (x.eip_customer_address ?? []).filter((a: any) => a.is_active !== false) }));
  return { customers: customers as Cust[], products: (p ?? []) as Prod[] };
}

// 從訊息裡找出「唯一」提到的客戶（代號／名稱／簡稱／別名／分店），找不到或不只一家就回 null
export function detectCustomer(catalog: Catalog, text: string): Cust | null {
  const t = norm(text);
  if (!t) return null;
  const hits = catalog.customers.filter((c) =>
    [c.code, c.name, c.short_name, ...(c.aliases ?? [])].map(norm).some((k) => k.length >= 2 && t.includes(k)));
  return hits.length === 1 ? hits[0] : null;
}

// ───────────────────────── 學習資料 ─────────────────────────

type Usual = {
  product_id: string; order_count: number; usual_unit: string | null; base_unit: string | null;
  avg_base_qty: number | null; max_base_qty: number | null; last_qty: number | null; last_unit: string | null; last_date: string | null; is_hidden: boolean;
};
export type CustLearning = { customerId: string; aliases: { alias: string; product_id: string }[]; usual: Usual[] };
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const qtyStr = (n: number | null) => (n === null ? "?" : String(Math.round(n * 1000) / 1000));
/** 顯示用品名：去掉開頭的 [標籤] */
export const shortName = (s: string) => s.replace(/^\[[^\]]*\]\s*/, "");

/** 客戶專屬說法＋常訂品項（含手動隱藏的；建議時再排除） */
export async function loadCustomerLearning(sb: any, customerId: string): Promise<CustLearning> {
  const [{ data: a }, { data: u }] = await Promise.all([
    sb.from("eip_customer_product_alias").select("alias, product_id").eq("customer_id", customerId).limit(300),
    sb.from("eip_customer_product_profile")
      .select("product_id, order_count, usual_unit, base_unit, avg_base_qty, max_base_qty, last_qty, last_unit, last_date, is_hidden")
      .eq("customer_id", customerId).gt("order_count", 0).order("order_count", { ascending: false }).limit(80),
  ]);
  return {
    customerId,
    aliases: ((a ?? []) as any[]).map((x) => ({ alias: String(x.alias), product_id: x.product_id })),
    usual: ((u ?? []) as any[]).map((x) => ({
      ...x, order_count: Number(x.order_count), avg_base_qty: numOrNull(x.avg_base_qty), max_base_qty: numOrNull(x.max_base_qty), last_qty: numOrNull(x.last_qty),
    })),
  };
}

// 最近訂單（「照舊」用）：先看已確認訂單，沒有就看凌越匯入的歷史銷貨
async function recentOrdersText(sb: any, tenantId: string, c: Cust): Promise<string | null> {
  const head = `【${c.name} 最近的訂單】（老闆說「照舊／跟上次一樣」時，以第一筆為準）`;
  const { data: orders } = await sb.from("eip_sales_order")
    .select("id, order_no, order_date, delivery_date, eip_customer_address(label), eip_sales_order_line(line_no, qty, unit, product_text, eip_product(code, name))")
    .eq("tenant_id", tenantId).eq("customer_id", c.id).eq("status", "confirmed").is("deleted_at", null)
    .order("created_at", { ascending: false }).limit(2);
  if (orders?.length) {
    return head + "\n" + (orders as any[]).map((o) => {
      const ls = [...(o.eip_sales_order_line ?? [])].sort((a: any, b: any) => a.line_no - b.line_no)
        .map((l: any) => `${l.eip_product?.code ?? "-"}｜${l.eip_product?.name ?? l.product_text} × ${Number(l.qty)}${l.unit ?? ""}`).join("；");
      return `・${o.order_no}（訂 ${o.order_date}${o.eip_customer_address?.label ? `，送${o.eip_customer_address.label}` : ""}）：${ls}`;
    }).join("\n");
  }
  const { data: h } = await sb.from("eip_sales_history").select("sale_date, doc_no, qty, unit, eip_product(code, name)")
    .eq("tenant_id", tenantId).eq("customer_id", c.id).order("sale_date", { ascending: false }).order("created_at", { ascending: true }).limit(80);
  if (!h?.length) return null;
  const groups = new Map<string, any[]>();
  for (const r of h as any[]) {
    const k = `${r.sale_date}｜${r.doc_no ?? ""}`;
    if (!groups.has(k) && groups.size >= 2) continue;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return head + "\n" + [...groups.entries()].map(([k, rs]) => {
    const [d, no] = k.split("｜");
    return `・${no || "凌越歷史"}（${d}）：` + rs.map((r: any) => `${r.eip_product?.code ?? "-"}｜${r.eip_product?.name ?? "?"} × ${Number(r.qty)}${r.unit ?? ""}`).join("；");
  }).join("\n");
}

type Example = { id: string; input_text: string; expected_text: string; message_date: string | null };
async function loadExamples(sb: any, tenantId: string, customerId: string | null): Promise<Example[]> {
  const sel = "id, input_text, expected_text, message_date";
  const base = () => sb.from("eip_order_example").select(sel).eq("tenant_id", tenantId).eq("is_active", true).order("created_at", { ascending: false });
  const [own, manual, others] = await Promise.all([
    customerId ? base().eq("customer_id", customerId).limit(3) : Promise.resolve({ data: [] }),
    base().in("source", ["manual", "test"]).limit(3),
    base().eq("source", "order").limit(4),
  ]);
  const out: Example[] = [];
  const seen = new Set<string>();
  for (const list of [own.data, manual.data, others.data]) {
    for (const e of (list ?? []) as Example[]) {
      if (out.length >= 5 || seen.has(e.id)) continue;
      if (list === others.data && out.length >= 4) continue;
      seen.add(e.id); out.push(e);
    }
  }
  return out;
}

/** 給 AI 的學習資料：說法對照、此客戶專屬說法與常訂品項、最近訂單、過去範例 */
export async function buildOrderContext(sb: any, tenantId: string, catalog: Catalog, text: string, customerId?: string | null): Promise<string | null> {
  const cust = customerId ? catalog.customers.find((c) => c.id === customerId) ?? null : (text ? detectCustomer(catalog, text) : null);
  const pById = new Map(catalog.products.map((p) => [p.id, p]));
  const pLabel = (id: string) => { const p = pById.get(id); return p ? `${p.code ?? "-"}｜${p.name}` : null; };
  const parts: string[] = [];
  const [{ data: ph }, learn, recent, ex] = await Promise.all([
    sb.from("eip_order_phrase").select("phrase, meaning").eq("tenant_id", tenantId).eq("is_active", true).order("sort_order").limit(80),
    cust ? loadCustomerLearning(sb, cust.id) : Promise.resolve(null),
    cust ? recentOrdersText(sb, tenantId, cust) : Promise.resolve(null),
    loadExamples(sb, tenantId, cust?.id ?? null),
  ]);
  if (ph?.length) parts.push("【說法對照】（全公司共用的口語說法）\n" + (ph as any[]).map((x) => `・${x.phrase}：${x.meaning}`).join("\n"));
  if (cust && learn) {
    const al = learn.aliases.map((a) => { const l = pLabel(a.product_id); return l ? `・「${a.alias}」＝ ${l}` : null; }).filter(Boolean);
    if (al.length) parts.push(`【${cust.name} 的專屬說法】（只適用這個客戶，優先於一般品名比對）\n` + al.join("\n"));
    const us = learn.usual.filter((u) => !u.is_hidden).slice(0, 25).map((u) => {
      const l = pLabel(u.product_id);
      if (!l) return null;
      const bu = u.base_unit ?? "";
      return `・${l}｜叫過 ${u.order_count} 次｜慣用單位 ${u.usual_unit ?? (bu || "-")}｜平均 ${qtyStr(u.avg_base_qty)}${bu}、最多 ${qtyStr(u.max_base_qty)}${bu}` +
        (u.last_date ? `｜上次 ${u.last_date.slice(5)} ${qtyStr(u.last_qty)}${u.last_unit ?? ""}` : "");
    }).filter(Boolean);
    if (us.length) parts.push(`【${cust.name} 的常訂品項】（品名不明確時優先考慮這些；沒提到的品項不要自己加進來）\n` + us.join("\n"));
  }
  if (recent) parts.push(recent);
  if (ex.length) {
    parts.push("【過去範例】（只用來理解老闆的寫法與簡稱；範例裡的品項、數量、日期都不要套用到這張單）\n" +
      ex.map((e, i) => `範例${i + 1}　訊息（${e.message_date ? dayLabel(e.message_date) : "日期不詳"} 傳的）：\n${e.input_text.slice(0, 300)}\n正確結果：\n${e.expected_text.slice(0, 400)}`).join("\n\n"));
  }
  return parts.length ? parts.join("\n\n") : null;
}

type OrderSetting = { qty_alert_ratio: number; no_delivery_weekdays: number[]; holidays: string[] };
async function loadSetting(sb: any, tenantId: string): Promise<OrderSetting> {
  const { data } = await sb.from("eip_sales_order_setting").select("qty_alert_ratio, no_delivery_weekdays, holidays").eq("tenant_id", tenantId).maybeSingle();
  return {
    qty_alert_ratio: Number(data?.qty_alert_ratio ?? 3),
    no_delivery_weekdays: (data?.no_delivery_weekdays ?? [0]).map(Number),
    holidays: (data?.holidays ?? []).map(String),
  };
}

// 不送貨日：設定的星期（預設週日）或休息日
function isNoDeliveryDay(s: OrderSetting, d: string): boolean {
  return s.no_delivery_weekdays.includes(new Date(d + "T00:00:00Z").getUTCDay()) || s.holidays.includes(d);
}

export async function canCreateOrder(sb: any, userId: string): Promise<boolean> {
  const { data, error } = await sb.rpc("eip_user_has_perm", { p_user: userId, p_module: "eip_sales_order", p_action: "create" });
  if (error) { console.error("perm", error); return false; }
  return data === true;
}

// ───────────────────────── AI 解析 ─────────────────────────

const ORDER_TOOL = {
  name: "submit_order",
  description: "回報從訊息／圖片／檔案中解析出的訂單內容。一定要呼叫這個工具，不要用文字回答。",
  input_schema: {
    type: "object",
    properties: {
      is_order: { type: "boolean", description: "內容是否為客戶訂單／叫貨。不是就填 false，其餘欄位可留空。" },
      customer_text: { type: "string", description: "訊息中客戶的原始說法（照原文）" },
      customer_code: { type: "string", description: "若能從【客戶主檔】確定是哪一家，填該客戶的代號或完整名稱；不確定就留空，不可猜" },
      contact_name: { type: "string" },
      contact_phone: { type: "string" },
      delivery_date: { type: "string", description: "交貨日期 YYYY-MM-DD；口語（明天、週五、月底）請換算；沒提到就留空" },
      delivery_place: { type: "string", description: "送貨地點：客戶的分店名稱（對照客戶主檔的「分店」）或完整地址；沒提到就留空" },
      note: { type: "string", description: "其他交代事項（付款、送貨時段、特殊要求）" },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            product_text: { type: "string", description: "品項的原始說法（照原文）" },
            product_code: { type: "string", description: "若能從【品項主檔】確定，填品號或完整品名；不確定留空，不可猜" },
            spec: { type: "string", description: "規格、口味、包裝（只有訊息有講才填）" },
            qty: { type: "number", description: "數量（阿拉伯數字）；沒說就留空" },
            unit: { type: "string", description: "單位（箱、包、公斤…），照原文；沒說就留空，系統會帶主單位" },
            unit_price: { type: "number", description: "只有訊息明確講到價格才填，否則留空（系統依客戶價格自動帶）" },
            note: { type: "string" },
            uncertain: { type: "boolean", description: "這一行有看不清、聽不懂或可能有誤的地方就填 true" },
          },
          required: ["product_text"],
        },
      },
      issues: { type: "array", items: { type: "string" }, description: "缺少或不確定、需要內勤確認的事項，每項一句話" },
      summary: { type: "string", description: "一句話摘要這張訂單" },
    },
    required: ["is_order", "lines", "issues"],
  },
};

function catalogText(customers: Cust[], products: Prod[]): string {
  const c = customers.map((x) => {
    const br = (x.eip_customer_address ?? []).map((a) => a.label).slice(0, 8);
    return `${x.code ?? "-"}｜${x.name}${x.short_name ? "｜" + x.short_name : ""}${x.aliases?.length ? "｜別名:" + x.aliases.join("/") : ""}${br.length ? "｜分店:" + br.join("/") : ""}`;
  }).join("\n");
  const p = products.map((x) => {
    const units = [x.unit, ...(x.eip_product_unit ?? []).map((u) => u.unit)].filter(Boolean);
    return `${x.code ?? "-"}｜${x.name}${x.spec ? "｜" + x.spec : ""}${units.length ? "｜單位:" + units.join("/") : ""}${x.aliases?.length ? "｜別名:" + x.aliases.join("/") : ""}`;
  }).join("\n");
  return `【客戶主檔】（代號｜名稱｜簡稱｜別名｜分店）\n${c || "（尚未建立）"}\n\n【品項主檔】（品號｜品名｜規格｜可用單位｜別名）\n${p || "（尚未建立）"}`;
}

export interface ParsedOrder {
  is_order: boolean; customer_text?: string; customer_code?: string; contact_name?: string; contact_phone?: string;
  delivery_date?: string; delivery_place?: string; delivery_address?: string; note?: string;
  lines: { product_text: string; product_code?: string; spec?: string; qty?: number; unit?: string; unit_price?: number; note?: string; uncertain?: boolean }[];
  issues: string[]; summary?: string;
}

export async function parseOrder(apiKey: string, catalog: Catalog, input: {
  text?: string; image?: { mime: string; b64: string }; pdf?: { b64: string }; sheetText?: string; existing?: unknown; senderName: string;
  context?: string | null;
}): Promise<ParsedOrder> {
  const { date, weekday } = taipeiToday();
  const system =
    `你是艾士實業的訂單整理助理。把老闆（${input.senderName}）從 LINE 傳來的訂單內容整理成結構化資料，呼叫 submit_order 回報。\n` +
    `今天是 ${date}（星期${weekday}），時區台北。日期對照（直接使用，不要自己推算）：\n${dateGuide()}\n` +
    `規則：\n` +
    `1. 客戶、品項只能從下方主檔中對應；主檔裡沒有、或有兩個以上可能時，code 欄留空，原始說法照填，並在 issues 說明。絕對不可自己編造代號。\n` +
    `2. 數量一律轉成阿拉伯數字（「一打」=12、「半打」=6 要寫在 issues 提醒換算）；單位照原文，沒講單位就留空。\n` +
    `3. 日期換算成 YYYY-MM-DD：「明天」「後天」「下週一」「月底」依今天推算。只說「週X」時，指今天之後（不含今天）最近的那一天；若今天就是週X，指下週的週X。\n` +
    `4. 價格只有明確講到才填；沒講就留空，系統會依客戶價格自動帶入。\n` +
    `5. 看不清楚、語意不明或互相矛盾的地方，該行 uncertain=true，並寫進 issues。寧可標示待確認，也不要猜。\n` +
    `6. 一則訊息若有多個品項，逐項拆成 lines；同一品項不同規格分開列。\n` +
    `7. 送到哪一家分店或地址，填在 delivery_place（盡量用主檔裡的分店名稱）。\n` +
    `8. 若提供了「目前草稿」，代表老闆是在修改那張草稿：以草稿為基礎套用這次的修改（例：「第2項改20箱」「交期改週五」「再加3箱綠茶」「刪掉第1項」），回傳修改後的完整訂單；草稿裡已有的單價維持原值。\n` +
    `9. 若提供了「目前草稿」，但這次訊息跟這張訂單無關（例如問行事曆、交辦任務、閒聊），is_order 填 false。\n` +
    `10. 若提供了「最近的訂單」：老闆說「照舊」「跟上次一樣」「老樣子」時，沿用最近一筆的品項與數量，再套用他這次說的增減（例：「照舊，原味多 5 箱」）；沒有這樣說時，只把它當作品名比對的參考，不要自己加品項。\n` +
    `11. 中文數字要正確換算（例：「十二」=12、「兩百」=200、「一千五」=1500、「兩箱半」=2.5）。\n` +
    `12. 若提供了【說法對照】與【客戶的專屬說法】，照著理解；專屬說法只適用那一個客戶，且優先於一般品名比對。\n` +
    `13. 品名講得不完整（例：只說「豆乾」）時，若【常訂品項】裡只有一個符合，product_code 可以填它，但該行 uncertain=true；有兩個以上符合就留空。\n` +
    `14. 【過去範例】只用來理解老闆的寫法，絕對不要把範例裡的品項、數量或日期放進這張單。\n\n` +
    catalogText(catalog.customers, catalog.products);

  const content: any[] = [];
  if (input.existing) content.push({ type: "text", text: "目前草稿（JSON）：\n" + JSON.stringify(input.existing) });
  if (input.context) content.push({ type: "text", text: "以下是學習資料：\n\n" + input.context });
  if (input.image) content.push({ type: "image", source: { type: "base64", media_type: input.image.mime, data: input.image.b64 } });
  if (input.pdf) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: input.pdf.b64 } });
  if (input.sheetText) content.push({ type: "text", text: "檔案內容（試算表轉文字）：\n" + input.sheetText.slice(0, 30000) });
  content.push({ type: "text", text: input.text ? "老闆的訊息：\n" + input.text : "請解析上面的圖片／檔案內容。" });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: ORDER_MODEL, max_tokens: 2048, temperature: 0, system,
      tools: [ORDER_TOOL], tool_choice: { type: "tool", name: "submit_order" },
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) throw new Error(`AI 解析失敗（${res.status}）：${(await res.text().catch(() => "")).slice(0, 200)}`);
  const data = await res.json();
  const tu = (data.content ?? []).find((b: any) => b.type === "tool_use");
  if (!tu) throw new Error("AI 沒有回傳訂單結構");
  const out = tu.input as ParsedOrder;
  out.lines = Array.isArray(out.lines) ? out.lines : [];
  out.issues = Array.isArray(out.issues) ? out.issues : [];
  return out;
}

// ───────────────────────── 寫入草稿 ─────────────────────────

function validDate(s: string | undefined | null): string | null {
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) ? s : null;
}

// 檢查：重複下單、數量異常（與此客戶常訂品項的平均量比；常訂資料含凌越歷史，上線第一天就能檢查）
async function sanityIssues(sb: any, me: OrderMe, setting: OrderSetting, customerId: string | null, deliveryDate: string | null, excludeOrderId: string | null,
  lines: { product_id: string | null; qty: number | null; unit: string | null; label: string }[], learn: CustLearning | null, products: Prod[]): Promise<string[]> {
  const out: string[] = [];
  if (!customerId) return out;
  const since3 = new Date(Date.now() - 3 * 864e5).toISOString();
  let q = sb.from("eip_sales_order").select("id, order_no, delivery_date, status")
    .eq("tenant_id", me.tenant_id).eq("customer_id", customerId).in("status", ["draft", "pending_review", "confirmed"])
    .is("deleted_at", null).gte("created_at", since3).limit(10);
  if (excludeOrderId) q = q.neq("id", excludeOrderId);
  const { data: recent } = await q;
  const dup = (recent ?? []).filter((o: any) => !deliveryDate || !o.delivery_date || o.delivery_date === deliveryDate);
  if (dup.length) out.push(`此客戶 3 天內已有訂單 ${dup.map((o: any) => o.order_no).join("、")}${deliveryDate ? "（同交期）" : ""}，請確認是否重複下單`);

  if (!learn) return out;
  const ratio = setting.qty_alert_ratio;
  for (const l of lines) {
    if (!l.product_id || !l.qty) continue;
    const u = learn.usual.find((x) => x.product_id === l.product_id);
    if (!u || u.order_count < 2 || !u.avg_base_qty) continue;
    const p = products.find((x) => x.id === l.product_id);
    const r = !l.unit || l.unit === p?.unit ? 1 : Number(p?.eip_product_unit?.find((x) => x.unit === l.unit)?.ratio ?? NaN);
    if (!isFinite(r) || r <= 0) continue;
    const base = l.qty * r, avg = u.avg_base_qty, bu = u.base_unit ?? p?.unit ?? "";
    const shown = r === 1 ? `${qtyStr(l.qty)}${l.unit ?? bu}` : `${qtyStr(l.qty)}${l.unit}（約 ${qtyStr(base)}${bu}）`;
    if (base > avg * ratio) out.push(`${l.label} 數量 ${shown} 明顯高於此客戶平均 ${qtyStr(avg)}${bu}（最多 ${qtyStr(u.max_base_qty)}${bu}），請確認`);
    else if (base * ratio < avg) out.push(`${l.label} 數量 ${shown} 明顯低於此客戶平均 ${qtyStr(avg)}${bu}，請確認`);
  }
  return out;
}

export async function saveDraft(sb: any, me: OrderMe, parsed: ParsedOrder, catalog: Catalog, opts: {
  existingOrderId?: string | null; rawText?: string | null; attachments?: Attachment[];
}): Promise<{ orderId: string; orderNo: string }> {
  const issues = [...parsed.issues];
  const { date: today } = taipeiToday();
  const cm = matchByNames(catalog.customers, parsed.customer_text, parsed.customer_code, (c) => [c.short_name]);
  if (!cm.item && (parsed.customer_text || parsed.customer_code)) {
    issues.push(cm.candidates.length
      ? `客戶「${parsed.customer_text ?? parsed.customer_code}」有多筆相近：${cm.candidates.map((c) => c.name).join("、")}`
      : `客戶「${parsed.customer_text ?? parsed.customer_code}」不在主檔，請內勤建立或對應`);
  }
  if (!parsed.customer_text && !parsed.customer_code) issues.push("沒有提到客戶");

  // 送貨地點：對到客戶分店就用分店（觸發器帶地址、收貨人）；對不到就保留原文給內勤
  const place = parsed.delivery_place ?? parsed.delivery_address ?? null;
  const addr = cm.item ? matchAddress(cm.item.eip_customer_address ?? [], place) : null;
  const isMainAddr = !!place && !!cm.item?.address && norm(place) === norm(cm.item.address);
  if (place && cm.item && !addr && !isMainAddr && (cm.item.eip_customer_address ?? []).length) issues.push(`送貨地點「${place}」不在此客戶的地址清單，請確認`);

  const [setting, learn] = await Promise.all([
    loadSetting(sb, me.tenant_id),
    cm.item ? loadCustomerLearning(sb, cm.item.id) : Promise.resolve(null),
  ]);
  const usualIds = new Set((learn?.usual ?? []).filter((u) => !u.is_hidden).map((u) => u.product_id));
  const deliveryDate = validDate(parsed.delivery_date);
  if (deliveryDate && deliveryDate < today) issues.push(`交期 ${deliveryDate} 早於今天，請確認`);
  else if (deliveryDate === today) issues.push("交期是今天（當日出貨），請確認是否正確");
  if (deliveryDate && isNoDeliveryDay(setting, deliveryDate)) issues.push(`交期 ${deliveryDate.slice(5).replace("-", "/")}（週${wdOf(deliveryDate)}）是不送貨日，請確認`);
  if (!deliveryDate) {
    if (cm.item?.delivery_lead_days != null) issues.push(`未指定交期，已依客戶預設 ${cm.item.delivery_lead_days} 天帶入（遇不送貨日自動順延），請確認`);
    else issues.push("尚未指定交貨日期");
  }

  const header: Record<string, unknown> = {
    tenant_id: me.tenant_id,
    customer_id: cm.item?.id ?? null,
    customer_text: parsed.customer_text ?? parsed.customer_code ?? null,
    contact_name: parsed.contact_name || null,
    contact_phone: parsed.contact_phone || null,
    delivery_date: deliveryDate,
    customer_address_id: addr?.id ?? null,
    delivery_address: addr ? addr.address : (place || null),
    note: parsed.note || null,
    ai_summary: parsed.summary ?? null,
  };

  const lines = parsed.lines.map((l, i) => {
    const label = `第${i + 1}項「${l.product_text}」`;
    let guessed = false;
    // 1. 這個客戶的專屬說法（內勤覆核時教過的）優先
    const t = norm(l.product_text);
    const aliasHits = t && learn ? learn.aliases.filter((a) => norm(a.alias) === t) : [];
    const aliasItem = aliasHits.length === 1 ? catalog.products.find((p) => p.id === aliasHits[0].product_id) ?? null : null;
    const pm = aliasItem ? { item: aliasItem, candidates: [] as Prod[] } : matchByNames(catalog.products, l.product_text, l.product_code);
    // 2. 多筆相近但只有一個是這個客戶常訂的 → 先帶它，標示待確認
    if (!pm.item && pm.candidates.length > 1 && usualIds.size) {
      const u = pm.candidates.filter((c) => usualIds.has(c.id));
      if (u.length === 1) { pm.item = u[0]; guessed = true; }
    }
    if (!pm.item) {
      issues.push(pm.candidates.length
        ? `${label}有多筆相近品項：${pm.candidates.map((p) => p.name).join("、")}`
        : `${label}不在品項主檔`);
    } else if (guessed) {
      issues.push(`${label}有多筆相近品項，依此客戶常訂先帶「${pm.item.name}」，請確認`);
    }
    const qty = typeof l.qty === "number" && isFinite(l.qty) && l.qty > 0 ? l.qty : null;
    if (qty === null) issues.push(`${label}沒有數量`);
    let unitBad = false;
    let unit = l.unit?.trim() || null;
    // 3. 沒講單位：依此客戶慣用單位（與主單位不同時才提醒）
    if (pm.item && !unit && learn) {
      const u = learn.usual.find((x) => x.product_id === pm.item!.id);
      if (u?.usual_unit && u.usual_unit !== pm.item.unit) { unit = u.usual_unit; issues.push(`${label}沒講單位，已依此客戶慣用單位「${unit}」帶入`); }
    }
    if (pm.item && unit) {
      const allowed = [pm.item.unit, ...(pm.item.eip_product_unit ?? []).map((u) => u.unit)].filter(Boolean).map((u) => norm(u));
      if (allowed.length && !allowed.includes(norm(unit))) { unitBad = true; issues.push(`${label}單位「${unit}」不在此品項的單位設定（${[pm.item.unit, ...(pm.item.eip_product_unit ?? []).map((u) => u.unit)].filter(Boolean).join("/")}）`); }
    }
    if (pm.item?.min_order_qty && qty !== null && (!unit || unit === pm.item.unit) && qty < Number(pm.item.min_order_qty)) {
      issues.push(`${label}數量 ${qty} 低於最小訂量 ${Number(pm.item.min_order_qty)}`);
    }
    const aiPrice = typeof l.unit_price === "number" && isFinite(l.unit_price) ? l.unit_price : null;
    return {
      tenant_id: me.tenant_id, line_no: i + 1,
      product_id: pm.item?.id ?? null, product_text: l.product_text ?? null,
      spec: l.spec || null, qty, unit,
      unit_price: aiPrice, price_source: aiPrice !== null ? "ai" : null,
      note: l.note || null,
      needs_review: !!l.uncertain || !pm.item || guessed || qty === null || unitBad,
      _label: label,
    };
  });
  if (lines.length === 0) issues.push("沒有解析到任何品項");

  issues.push(...await sanityIssues(sb, me, setting, cm.item?.id ?? null, deliveryDate, opts.existingOrderId ?? null,
    lines.map((l) => ({ product_id: l.product_id, qty: l.qty, unit: l.unit, label: l._label })), learn, catalog.products));
  header.ai_issues = Array.from(new Set(issues)).slice(0, 20);

  let orderId = opts.existingOrderId ?? null;
  let orderNo = "";
  if (orderId) {
    const { data: cur } = await sb.from("eip_sales_order").select("customer_id, raw_text, attachments").eq("id", orderId).maybeSingle();
    const upd: Record<string, unknown> = { ...header };
    const custChanged = cur?.customer_id !== header.customer_id;
    if (!custChanged) {
      // 同一客戶：沒提到的欄位維持草稿原值（例如觸發器帶入的地址、聯絡人）
      for (const k of ["contact_name", "contact_phone", "note"]) if (upd[k] == null) delete upd[k];
      if (!place) { delete upd.customer_address_id; delete upd.delivery_address; }
    } else {
      // 換客戶：清掉舊客戶帶入的資料，讓觸發器依新客戶重帶
      for (const k of ["contact_name", "contact_phone", "delivery_address", "payment_terms", "delivery_time_window"]) if (upd[k] == null) upd[k] = null;
    }
    if (opts.rawText) upd.raw_text = [cur?.raw_text, opts.rawText].filter(Boolean).join("\n—— 修改 ——\n");
    if (opts.attachments?.length) upd.attachments = [...(cur?.attachments ?? []), ...opts.attachments];
    const { data, error } = await sb.from("eip_sales_order").update(upd).eq("id", orderId).select("order_no").maybeSingle();
    if (error) throw new Error(error.message);
    orderNo = data?.order_no ?? "";
    await sb.from("eip_sales_order_line").delete().eq("order_id", orderId);
  } else {
    const { data, error } = await sb.from("eip_sales_order").insert({
      ...header, status: "draft", source: "line", created_by: me.id,
      raw_text: opts.rawText ?? null, attachments: opts.attachments ?? [],
    }).select("id, order_no").maybeSingle();
    if (error) throw new Error(error.message);
    orderId = data.id; orderNo = data.order_no;
  }
  if (lines.length) {
    const { error } = await sb.from("eip_sales_order_line").insert(lines.map(({ _label, ...l }) => ({ ...l, order_id: orderId })));
    if (error) throw new Error(error.message);
  }
  await sb.from("line_pending_order").upsert({ user_id: me.id, order_id: orderId, created_at: new Date().toISOString() }, { onConflict: "user_id" });
  return { orderId: orderId!, orderNo };
}

// 回給老闆看的草稿摘要（由資料庫組字，不讓 AI 自由發揮，避免數字被改寫）
export async function draftSummary(sb: any, orderId: string): Promise<string> {
  const { data: o } = await sb.from("eip_sales_order")
    .select("order_no, customer_text, delivery_date, delivery_address, note, ai_issues, payment_terms, tax_type, subtotal, tax_amount, total_amount, eip_customer(name), eip_customer_address(label)")
    .eq("id", orderId).maybeSingle();
  const { data: ls } = await sb.from("eip_sales_order_line")
    .select("line_no, product_text, spec, qty, unit, unit_price, amount, needs_review, eip_product(name)")
    .eq("order_id", orderId).order("line_no");
  const cust = o?.eip_customer?.name ? `${o.eip_customer.name} ✓` : `${o?.customer_text ?? "（未指定）"} ⚠主檔未對應`;
  let missingPrice = 0;
  const lines = (ls ?? []).map((l: any) => {
    const name = l.eip_product?.name ?? l.product_text ?? "（未知品項）";
    const q = l.qty !== null && l.qty !== undefined ? `× ${Number(l.qty)}${l.unit ?? ""}` : "× ？";
    const hasPrice = l.unit_price !== null && l.unit_price !== undefined;
    if (!hasPrice) missingPrice++;
    const price = hasPrice ? ` @${fmt(Number(l.unit_price))}${l.qty ? ` = ${fmt(Number(l.amount))}` : ""}` : "";
    const spec = l.spec ? `（${l.spec}）` : "";
    return `${l.line_no}. ${name}${spec} ${q}${price}${l.needs_review ? " ⚠" : ""}`;
  });
  const issues: string[] = o?.ai_issues ?? [];
  const taxLabel = o?.tax_type === "inclusive" ? "含稅" : o?.tax_type === "exempt" ? "免稅" : "未稅";
  const money = Number(o?.total_amount ?? 0) > 0
    ? [o?.tax_type === "exclusive"
        ? `金額：${fmt(Number(o.subtotal))}＋稅 ${fmt(Number(o.tax_amount))}＝${fmt(Number(o.total_amount))}`
        : `金額：${fmt(Number(o.total_amount))}（${taxLabel}）`]
    : [];
  const place = o?.eip_customer_address?.label ? `【${o.eip_customer_address.label}】` : "";
  return [
    `📦 訂單草稿 ${o?.order_no ?? ""}`,
    `客戶：${cust}`,
    `交貨：${o?.delivery_date ? `${o.delivery_date.slice(5).replace("-", "/")}（${wdOf(o.delivery_date)}）` : "未指定"}${o?.delivery_address ? `｜${place}${o.delivery_address}` : ""}`,
    ...(o?.payment_terms ? [`付款：${o.payment_terms}`] : []),
    `品項：`,
    ...(lines.length ? lines : ["（沒有品項）"]),
    ...money,
    ...(missingPrice ? [`（${missingPrice} 項尚無單價，由內勤補上）`] : []),
    ...(o?.note ? [`備註：${o.note}`] : []),
    ...(issues.length ? ["", "待確認：", ...issues.slice(0, 6).map((s) => "・" + s)] : []),
    "",
    (ls ?? []).some((l: any) => l.needs_review)
      ? "⚠ 的品項可以點下方按鈕選正確的，或直接打字修改；沒問題就按「送出訂單」。"
      : "按「送出訂單」交給內勤覆核；要修改直接打字（例：第2項改20箱、交期改週五、送中和店）。",
  ].join("\n");
}

// ───────────────────────── 疑問品項的按鈕 ─────────────────────────

export type Choice = { label: string; text: string };
const clip = (s: string, n = 20) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** 依目前草稿算出要給老闆點的按鈕：客戶對不到 → 候選客戶；品項有疑問 → 候選品項（沒有候選就給此客戶常訂） */
export async function orderChoices(sb: any, tenantId: string, orderId: string, catalog?: Catalog): Promise<Choice[]> {
  const cat = catalog ?? await loadCatalog(sb, tenantId);
  const [{ data: o }, { data: ls }] = await Promise.all([
    sb.from("eip_sales_order").select("customer_id, customer_text").eq("id", orderId).maybeSingle(),
    sb.from("eip_sales_order_line").select("line_no, product_id, product_text, needs_review").eq("order_id", orderId).order("line_no"),
  ]);
  const out: Choice[] = [];
  if (o && !o.customer_id && o.customer_text) {
    const m = matchByNames(cat.customers, o.customer_text, null, (c) => [c.short_name]);
    for (const c of m.candidates.slice(0, 3)) out.push({ label: clip(`客戶：${shortName(c.short_name ?? c.name)}`), text: `客戶改成 ${c.code ?? c.name}` });
  }
  const learn = o?.customer_id ? await loadCustomerLearning(sb, o.customer_id) : null;
  for (const l of (ls ?? []) as any[]) {
    if (!l.needs_review || !l.product_text) continue;
    const m = matchByNames(cat.products, l.product_text, null);
    let cands = (m.item ? [] : m.candidates).filter((p) => p.id !== l.product_id);
    if (!cands.length && !l.product_id && learn) {
      cands = learn.usual.filter((u) => !u.is_hidden).slice(0, 3)
        .map((u) => cat.products.find((p) => p.id === u.product_id)).filter(Boolean) as Prod[];
    }
    for (const p of cands.slice(0, 4)) out.push({ label: clip(`第${l.line_no}項：${shortName(p.name)}`), text: `第${l.line_no}項是 ${p.code ?? p.name}` });
  }
  return out.slice(0, 11);
}

export const PICK_RE = /^第\s*(\d+)\s*項\s*(?:是|改成|改為|選|＝|=|:|：)\s*(.+?)\s*$/;

/** 老闆點「第N項是 品號」：直接改那一行的品項（保留原本說法，覆核確認時會記成這個客戶的專屬說法） */
export async function pickLineProduct(sb: any, orderId: string, lineNo: number, query: string, catalog: Catalog): Promise<boolean> {
  const q = norm(query);
  if (!q) return false;
  let p = catalog.products.find((x) => norm(x.code) === q) ?? null;
  if (!p) {
    const byName = catalog.products.filter((x) => norm(x.name) === q || norm(shortName(x.name)) === q);
    p = byName.length === 1 ? byName[0] : null;
  }
  if (!p) return false;
  const { data: line } = await sb.from("eip_sales_order_line").select("id, qty").eq("order_id", orderId).eq("line_no", lineNo).maybeSingle();
  if (!line) return false;
  const { error } = await sb.from("eip_sales_order_line")
    .update({ product_id: p.id, unit_price: null, price_source: null, needs_review: line.qty === null }).eq("id", line.id);
  if (error) throw new Error(error.message);
  const { data: o } = await sb.from("eip_sales_order").select("ai_issues").eq("id", orderId).maybeSingle();
  const prefix = `第${lineNo}項「`;
  const issues = ((o?.ai_issues ?? []) as string[]).filter((s) => !(s.startsWith(prefix) && /多筆相近|不在品項主檔|常訂/.test(s)));
  await sb.from("eip_sales_order").update({ ai_issues: issues }).eq("id", orderId);
  return true;
}

// ───────────────────────── 檔案下載與存放 ─────────────────────────

export async function downloadLineContent(token: string, messageId: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const r = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) throw new Error(`下載 LINE 檔案失敗（${r.status}）`);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.byteLength > MAX_FILE_BYTES) throw new Error("檔案超過 10MB，請改傳較小的檔案或拍照");
  return { bytes: buf, mime: r.headers.get("content-type") ?? "application/octet-stream" };
}

export function toB64(bytes: Uint8Array): string {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

export async function storeAttachment(sb: any, orderId: string, fileName: string, bytes: Uint8Array, mime: string): Promise<Attachment | null> {
  const safe = fileName.replace(/[^\w.\-]/g, "_").slice(-80) || "file";
  const path = `${orderId}/${Date.now()}_${safe}`;
  const { error } = await sb.storage.from("sales-order").upload(path, bytes, { contentType: mime, upsert: false });
  if (error) { console.error("upload", error); return null; }
  return { path, name: fileName, mime, size: bytes.byteLength };
}

export async function addAttachment(sb: any, orderId: string, att: Attachment) {
  const { data } = await sb.from("eip_sales_order").select("attachments").eq("id", orderId).maybeSingle();
  await sb.from("eip_sales_order").update({ attachments: [...(data?.attachments ?? []), att] }).eq("id", orderId);
}

export async function sheetToText(bytes: Uint8Array): Promise<string> {
  const XLSX = await import("https://esm.sh/xlsx@0.18.5");
  const wb = XLSX.read(bytes, { type: "array" });
  return wb.SheetNames.slice(0, 5).map((n: string) => `# 工作表 ${n}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[n])).join("\n\n");
}

export { loadCatalog };
