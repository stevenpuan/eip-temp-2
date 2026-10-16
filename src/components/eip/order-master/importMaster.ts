import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { DEFAULT_TENANT_ID } from "@/lib/eip-constants";
import { humanizeError } from "@/lib/eip-error";
import { guessSheetKind, mapRow, splitList, toBool, toDate, toNum, toTaxType } from "@/lib/sales-order";

export type ImportReport = {
  sheet: string; kind: string; inserted: number; updated: number; skipped: number; errors: string[];
}[];

const KIND_LABEL: Record<string, string> = { customer: "客戶", address: "送貨地址", product: "品項", unit: "品項單位", price: "客戶價格" };
export const kindLabel = (k: string) => KIND_LABEL[k] ?? k;

const str = (v: unknown) => { const s = String(v ?? "").trim(); return s || null; };

async function fetchAll(table: string, cols: string) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(cols).range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** 依名稱或代號找主檔 id */
function indexer(rows: { id: string; code: string | null; name: string; short_name?: string | null }[]) {
  const m = new Map<string, string>();
  for (const r of rows) {
    if (r.code) m.set(String(r.code).trim().toLowerCase(), r.id);
    m.set(r.name.trim().toLowerCase(), r.id);
    if (r.short_name) m.set(r.short_name.trim().toLowerCase(), r.id);
  }
  return (ref: unknown) => { const k = String(ref ?? "").trim().toLowerCase(); return k ? m.get(k) ?? null : null; };
}

async function upsertMaster(table: "eip_customer" | "eip_product", recs: Record<string, unknown>[], rep: ImportReport[number]) {
  const existing = await fetchAll(table, "id,code,name");
  const byCode = new Map(existing.filter((r) => r.code).map((r) => [String(r.code).trim(), r.id]));
  const byName = new Map(existing.map((r) => [String(r.name).trim(), r.id]));
  const inserts: Record<string, unknown>[] = [];
  for (const { _row, ...rec } of recs as any[]) {
    const id = (rec.code && byCode.get(String(rec.code))) || byName.get(String(rec.name));
    if (id) {
      const { error } = await supabase.from(table).update(rec).eq("id", id);
      if (error) rep.errors.push(`第 ${_row} 列：${humanizeError(error, "更新")}`); else rep.updated++;
    } else inserts.push({ ...rec, tenant_id: DEFAULT_TENANT_ID, _row });
  }
  for (let i = 0; i < inserts.length; i += 200) {
    const chunk = inserts.slice(i, i + 200);
    const { error } = await supabase.from(table).insert(chunk.map(({ _row, ...r }) => r));
    if (!error) { rep.inserted += chunk.length; continue; }
    // 整批失敗就逐筆找出問題列
    for (const { _row, ...r } of chunk) {
      const { error: e1 } = await supabase.from(table).insert(r);
      if (e1) rep.errors.push(`第 ${_row} 列：${humanizeError(e1, "新增")}`); else rep.inserted++;
    }
  }
}

/**
 * 匯入一個 Excel 活頁簿：自動辨識每個工作表是哪一種資料，依「客戶 → 送貨地址 → 品項 → 單位 → 客戶價格」順序寫入。
 * 有代號就依代號更新，沒有代號就依名稱比對；找不到就新增。
 */
export async function importWorkbook(file: File, opts: { onlyKind?: string; users: { id: string; name: string }[] }): Promise<ImportReport> {
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: false });
  const sheets = wb.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: "" });
    const headers = rows.length ? Object.keys(rows[0]) : [];
    return { name, rows, kind: guessSheetKind(name, headers) ?? (wb.SheetNames.length === 1 ? opts.onlyKind ?? null : null) };
  }).filter((s) => s.kind && s.rows.length);
  const order = ["customer", "address", "product", "unit", "price"];
  sheets.sort((a, b) => order.indexOf(a.kind!) - order.indexOf(b.kind!));
  const report: ImportReport = [];
  const userByName = new Map(opts.users.map((u) => [u.name.trim(), u.id]));

  for (const sh of sheets) {
    const rep = { sheet: sh.name, kind: sh.kind!, inserted: 0, updated: 0, skipped: 0, errors: [] as string[] };
    report.push(rep);
    const rows = sh.rows.map((raw, i) => ({ r: mapRow(sh.kind!, raw), row: i + 2 }));

    if (sh.kind === "customer" || sh.kind === "product") {
      const recs: Record<string, unknown>[] = [];
      for (const { r, row } of rows) {
        if (!str(r.name)) { rep.skipped++; continue; }
        const rec: Record<string, unknown> = { _row: row };
        const textFields = sh.kind === "customer"
          ? ["code", "name", "short_name", "tax_id", "invoice_title", "invoice_address", "contact_name", "phone", "fax", "email", "address", "payment_terms", "customer_type", "region", "delivery_route", "delivery_time_window", "delivery_note", "note"]
          : ["code", "name", "spec", "unit", "category", "barcode", "pack_desc", "note"];
        for (const f of textFields) if (f in r) rec[f] = str(r[f]);
        if ("aliases" in r) rec.aliases = splitList(r.aliases);
        if ("is_active" in r) rec.is_active = toBool(r.is_active);
        if (sh.kind === "customer") {
          if ("tax_type" in r) rec.tax_type = toTaxType(r.tax_type);
          if ("credit_limit" in r) rec.credit_limit = toNum(r.credit_limit);
          if ("delivery_lead_days" in r) { const n = toNum(r.delivery_lead_days); rec.delivery_lead_days = n === null ? null : Math.max(0, Math.min(60, Math.round(n))); }
          if (rec.tax_id && !/^\d{8}$/.test(String(rec.tax_id))) rep.errors.push(`第 ${row} 列：統編「${rec.tax_id}」不是 8 碼數字（仍已匯入，請確認）`);
          if ("sales_owner" in r) {
            const id = userByName.get(String(r.sales_owner).trim());
            if (id) rec.sales_owner_id = id; else rep.errors.push(`第 ${row} 列：找不到業務「${r.sales_owner}」，未設定`);
          }
        } else {
          if ("unit_price" in r) rec.unit_price = toNum(r.unit_price);
          if ("min_order_qty" in r) rec.min_order_qty = toNum(r.min_order_qty);
        }
        recs.push(rec);
      }
      await upsertMaster(sh.kind === "customer" ? "eip_customer" : "eip_product", recs, rep);
      continue;
    }

    const custFind = indexer(await fetchAll("eip_customer", "id,code,name,short_name"));
    const prodFind = indexer(await fetchAll("eip_product", "id,code,name"));

    if (sh.kind === "address") {
      for (const { r, row } of rows) {
        const cid = custFind(r.customer_ref);
        if (!cid) { rep.errors.push(`第 ${row} 列：找不到客戶「${r.customer_ref ?? ""}」`); continue; }
        if (!str(r.address)) { rep.skipped++; continue; }
        const label = str(r.label) ?? "主要";
        const rec = {
          tenant_id: DEFAULT_TENANT_ID, customer_id: cid, label, address: str(r.address),
          receiver_name: str(r.receiver_name), receiver_phone: str(r.receiver_phone),
          delivery_time_window: str(r.delivery_time_window), note: str(r.note),
          is_default: "is_default" in r ? toBool(r.is_default, false) : false,
        };
        const { data: ex } = await supabase.from("eip_customer_address").select("id").eq("customer_id", cid).eq("label", label).maybeSingle();
        const { error } = ex ? await supabase.from("eip_customer_address").update(rec).eq("id", ex.id) : await supabase.from("eip_customer_address").insert(rec);
        if (error) rep.errors.push(`第 ${row} 列：${humanizeError(error, "地址")}`); else if (ex) rep.updated++; else rep.inserted++;
      }
    } else if (sh.kind === "unit") {
      for (const { r, row } of rows) {
        const pid = prodFind(r.product_ref);
        if (!pid) { rep.errors.push(`第 ${row} 列：找不到品項「${r.product_ref ?? ""}」`); continue; }
        const ratio = toNum(r.ratio);
        if (!str(r.unit) || !ratio || ratio <= 0) { rep.errors.push(`第 ${row} 列：單位或換算率不正確`); continue; }
        const rec = { tenant_id: DEFAULT_TENANT_ID, product_id: pid, unit: str(r.unit), ratio, unit_price: toNum(r.unit_price), barcode: str(r.barcode) };
        const { data: ex } = await supabase.from("eip_product_unit").select("id").eq("product_id", pid).eq("unit", rec.unit).maybeSingle();
        const { error } = ex ? await supabase.from("eip_product_unit").update(rec).eq("id", ex.id) : await supabase.from("eip_product_unit").insert(rec);
        if (error) rep.errors.push(`第 ${row} 列：${humanizeError(error, "單位")}`); else if (ex) rep.updated++; else rep.inserted++;
      }
    } else if (sh.kind === "price") {
      for (const { r, row } of rows) {
        const cid = custFind(r.customer_ref), pid = prodFind(r.product_ref);
        if (!cid || !pid) { rep.errors.push(`第 ${row} 列：找不到${!cid ? `客戶「${r.customer_ref ?? ""}」` : ""}${!pid ? `品項「${r.product_ref ?? ""}」` : ""}`); continue; }
        const price = toNum(r.unit_price);
        if (price === null || price < 0) { rep.errors.push(`第 ${row} 列：單價不正確`); continue; }
        const unit = str(r.unit);
        const rec = { tenant_id: DEFAULT_TENANT_ID, customer_id: cid, product_id: pid, unit, unit_price: price, source: "contract", valid_from: toDate(r.valid_from), valid_to: toDate(r.valid_to), note: str(r.note) };
        let q = supabase.from("eip_customer_price").select("id").eq("customer_id", cid).eq("product_id", pid).eq("source", "contract");
        q = unit ? q.eq("unit", unit) : q.is("unit", null);
        const { data: ex } = await q.limit(1).maybeSingle();
        const { error } = ex ? await supabase.from("eip_customer_price").update(rec).eq("id", ex.id) : await supabase.from("eip_customer_price").insert(rec);
        if (error) rep.errors.push(`第 ${row} 列：${humanizeError(error, "價格")}`); else if (ex) rep.updated++; else rep.inserted++;
      }
    }
  }
  if (!report.length) throw new Error("看不出這個檔案的內容是哪一種資料。請使用「下載匯入範本」的工作表名稱或欄名。");
  return report;
}

/** 匯入範本：五張工作表，各附一列範例 */
export function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: Record<string, unknown>[]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
  add("客戶", [{
    客戶代號: "C001", 客戶名稱: "範例食品行股份有限公司", 簡稱: "範例", 別名: "老范,范記", 統一編號: "12345678", 發票抬頭: "範例食品行股份有限公司",
    發票地址: "台北市中山區範例路 1 號", 聯絡人: "王先生", 電話: "02-1234-5678", 傳真: "", Email: "", 送貨地址: "台北市中山區範例路 1 號",
    付款條件: "月結 30 天", 稅別: "外加", 客戶類別: "經銷商", 區域: "北區", 配送路線: "A 線", 信用額度: 300000, 交期天數: 2,
    收貨時段: "09:00-12:00", 送貨注意事項: "後門卸貨", 業務: "", 備註: "", 啟用: "Y",
  }]);
  add("送貨地址", [
    { 客戶代號: "C001", 地點名稱: "總店", 地址: "台北市中山區範例路 1 號", 收貨人: "王先生", 收貨電話: "02-1234-5678", 收貨時段: "09:00-12:00", 預設: "Y", 備註: "" },
    { 客戶代號: "C001", 地點名稱: "中和店", 地址: "新北市中和區範例路 2 號", 收貨人: "李店長", 收貨電話: "02-2222-3333", 收貨時段: "", 預設: "N", 備註: "" },
  ]);
  add("品項", [{ 品號: "P001", 品名: "範例商品", 規格: "500g×12", 單位: "箱", 單價: 1200, 類別: "常溫", 條碼: "", 包裝: "12包/箱", 最小訂量: 1, 別名: "原味,小包", 備註: "", 啟用: "Y" }]);
  add("品項單位", [{ 品號: "P001", 單位: "包", 換算率: 0.0833, 單價: 110, 條碼: "" }]);
  add("客戶價格", [{ 客戶代號: "C001", 品號: "P001", 單位: "箱", 單價: 1150, 生效日: "2026-01-01", 到期日: "", 備註: "年度合約價" }]);
  XLSX.writeFile(wb, "客戶品項主檔_匯入範本.xlsx");
}
