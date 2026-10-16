// 訂單接收／主檔共用：選項、標籤、Excel 匯入欄名對照
export type TaxType = "exclusive" | "inclusive" | "exempt";
export const TAX_TYPE_LABEL: Record<TaxType, string> = { exclusive: "外加稅（未稅價）", inclusive: "內含稅（含稅價）", exempt: "免稅" };
export const TAX_TYPE_SHORT: Record<TaxType, string> = { exclusive: "未稅", inclusive: "含稅", exempt: "免稅" };

export type PriceSource = "contract" | "last_order" | "product_unit" | "product" | "manual" | "ai";
export const PRICE_SOURCE_LABEL: Record<PriceSource, { label: string; cls: string; tip: string }> = {
  contract: { label: "合約", cls: "bg-emerald-100 text-emerald-800", tip: "客戶專屬（合約）價" },
  last_order: { label: "上次", cls: "bg-sky-100 text-sky-800", tip: "此客戶最近一次成交價" },
  product_unit: { label: "單位", cls: "bg-violet-100 text-violet-800", tip: "品項單位換算價" },
  product: { label: "牌價", cls: "bg-slate-100 text-slate-700", tip: "品項主檔牌價" },
  manual: { label: "手改", cls: "bg-amber-100 text-amber-800", tip: "人工輸入" },
  ai: { label: "老闆", cls: "bg-rose-100 text-rose-800", tip: "老闆在訊息中指定的價格" },
};

export const PAYMENT_TERMS_PRESETS = ["月結 30 天", "月結 60 天", "貨到付款", "預付", "週結", "現金"];
export const CUSTOMER_TYPE_PRESETS = ["經銷商", "量販／超市", "便利商店", "餐飲", "零售門市", "電商", "團購", "其他"];

/** 稅額試算（與資料庫觸發器同一套規則，畫面先算給人看，存檔以資料庫為準） */
export function calcTotals(sum: number, taxType: TaxType, rate: number) {
  const r = taxType === "exempt" ? 0 : rate;
  if (taxType === "inclusive") {
    const subtotal = Math.round(sum / (1 + r));
    return { subtotal, tax: sum - subtotal, total: sum };
  }
  const tax = Math.round(sum * r);
  return { subtotal: sum, tax, total: sum + tax };
}

export const money = (n: number | null | undefined) =>
  n === null || n === undefined || Number.isNaN(Number(n)) ? "" : Number(n).toLocaleString("zh-TW", { maximumFractionDigits: 2 });

// ── Excel 匯入：欄名對照（相容凌越等 ERP 匯出的常見欄名）
export const HEADER_ALIASES: Record<string, Record<string, string[]>> = {
  customer: {
    code: ["客戶代號", "客戶編號", "客戶代碼", "客代", "客戶id", "代號", "編號"],
    name: ["客戶名稱", "客戶全名", "公司名稱", "客戶全稱", "名稱", "全名"],
    short_name: ["客戶簡稱", "簡稱"],
    aliases: ["別名", "別名（逗號分隔）", "俗稱", "常用稱呼"],
    tax_id: ["統一編號", "統編", "營利事業統一編號"],
    invoice_title: ["發票抬頭", "抬頭"],
    invoice_address: ["發票地址", "帳單地址", "登記地址", "公司地址"],
    contact_name: ["聯絡人", "聯絡人姓名", "採購"],
    phone: ["電話", "聯絡電話", "電話一", "電話1", "公司電話"],
    fax: ["傳真", "傳真號碼"],
    email: ["email", "e-mail", "電子郵件", "電子信箱", "mail"],
    address: ["送貨地址", "出貨地址", "收貨地址", "地址"],
    payment_terms: ["付款條件", "收款條件", "付款方式", "結帳方式", "收款方式"],
    tax_type: ["稅別", "課稅別", "稅率別", "含稅否"],
    customer_type: ["客戶類別", "通路", "通路別", "客戶類型", "類別"],
    region: ["區域", "地區", "區域別"],
    delivery_route: ["配送路線", "路線", "送貨路線"],
    credit_limit: ["信用額度", "額度"],
    delivery_lead_days: ["交期天數", "預設交期", "前置天數"],
    delivery_time_window: ["收貨時段", "送貨時段"],
    delivery_note: ["送貨注意事項", "送貨備註"],
    sales_owner: ["業務", "業務員", "負責業務", "業務人員"],
    note: ["備註", "說明"],
    is_active: ["啟用", "狀態", "是否啟用"],
  },
  address: {
    customer_ref: ["客戶代號", "客戶編號", "客戶名稱", "客戶"],
    label: ["地點名稱", "分店", "分店名稱", "門市", "標籤", "名稱"],
    address: ["地址", "送貨地址"],
    receiver_name: ["收貨人", "聯絡人"],
    receiver_phone: ["收貨電話", "電話"],
    delivery_time_window: ["收貨時段", "送貨時段"],
    note: ["備註"],
    is_default: ["預設", "是否預設", "預設地址"],
  },
  product: {
    code: ["品號", "產品編號", "商品編號", "料號", "貨號", "品項代號", "產品代號", "代號"],
    name: ["品名", "產品名稱", "商品名稱", "品項名稱", "名稱"],
    spec: ["規格", "產品規格", "規格說明"],
    unit: ["單位", "銷售單位", "主單位", "計量單位"],
    unit_price: ["單價", "售價", "標準售價", "建議售價", "定價", "牌價", "批價"],
    category: ["類別", "產品類別", "商品類別", "分類", "大類"],
    barcode: ["條碼", "國際條碼", "商品條碼", "ean"],
    pack_desc: ["包裝", "包裝說明", "包裝規格", "入數"],
    min_order_qty: ["最小訂量", "最低訂量", "moq"],
    aliases: ["別名", "別名（逗號分隔）", "俗稱"],
    note: ["備註", "說明"],
    is_active: ["啟用", "狀態", "是否啟用"],
  },
  unit: {
    product_ref: ["品號", "產品編號", "品名"],
    unit: ["單位", "換算單位"],
    ratio: ["換算率", "換算比例", "等於幾個主單位", "主單位數量"],
    unit_price: ["單價", "售價"],
    barcode: ["條碼"],
  },
  price: {
    customer_ref: ["客戶代號", "客戶編號", "客戶名稱", "客戶"],
    product_ref: ["品號", "產品編號", "品名", "品項"],
    unit: ["單位"],
    unit_price: ["單價", "售價", "合約價", "專屬價", "價格"],
    valid_from: ["生效日", "起始日", "開始日期"],
    valid_to: ["到期日", "結束日", "截止日期"],
    note: ["備註"],
  },
};

export const SHEET_ALIASES: Record<string, string[]> = {
  customer: ["客戶", "客戶主檔", "客戶資料", "customer", "customers"],
  address: ["送貨地址", "客戶地址", "分店", "地址"],
  product: ["品項", "品項主檔", "產品", "商品", "產品資料", "product", "products"],
  unit: ["品項單位", "單位換算", "單位"],
  price: ["客戶價格", "客戶專屬價", "合約價", "價格"],
};

const normHeader = (s: string) => s.toLowerCase().replace(/[\s　()（）_\-:：*]/g, "");

/** 把一列 Excel（欄名可能不一致）轉成標準欄位 */
export function mapRow(kind: string, raw: Record<string, unknown>): Record<string, unknown> {
  const aliases = HEADER_ALIASES[kind];
  const byNorm = new Map(Object.keys(raw).map((k) => [normHeader(k), k]));
  const out: Record<string, unknown> = {};
  for (const [field, names] of Object.entries(aliases)) {
    for (const n of [field, ...names]) {
      const k = byNorm.get(normHeader(n));
      if (k !== undefined && raw[k] !== undefined && String(raw[k]).trim() !== "") { out[field] = raw[k]; break; }
    }
  }
  return out;
}

export function guessSheetKind(sheetName: string, headers: string[]): string | null {
  const n = normHeader(sheetName);
  for (const [kind, names] of Object.entries(SHEET_ALIASES)) if (names.some((x) => normHeader(x) === n)) return kind;
  // 依欄名判斷
  const hs = headers.map(normHeader);
  const has = (kind: string, field: string) => [field, ...HEADER_ALIASES[kind][field]].some((x) => hs.includes(normHeader(x)));
  if (has("price", "customer_ref") && has("price", "product_ref") && has("price", "unit_price")) return "price";
  if (has("unit", "ratio")) return "unit";
  if (has("address", "label") && has("address", "customer_ref")) return "address";
  if (has("product", "code") && (hs.includes("品名") || hs.includes("產品名稱") || hs.includes("商品名稱"))) return "product";
  if (has("customer", "name") || has("customer", "tax_id")) return "customer";
  return null;
}

export const splitList = (v: unknown) =>
  String(v ?? "").split(/[,，、;；\n/]/).map((s) => s.trim()).filter(Boolean);

export const toBool = (v: unknown, dflt = true) => {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return dflt;
  return !/^(n|no|否|停用|0|false|x|無效|關閉|inactive)$/.test(s);
};

export const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/[,，$＄元\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export const toTaxType = (v: unknown): TaxType | null => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/免/.test(s)) return "exempt";
  if (/內含|含稅|應稅內含|^y$|是/i.test(s)) return "inclusive";
  if (/外加|未稅|應稅|^n$|否/i.test(s)) return "exclusive";
  return null;
};

/** Excel 日期可能是序號或字串 */
export const toDate = (v: unknown): string | null => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 864e5));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim().replace(/[./]/g, "-");
  const m = s.match(/^(\d{2,4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  let y = Number(m[1]); if (y < 1000) y += 1911; // 民國年
  return `${y}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
};
