// assistant_tools.ts：LINE 助理的查詢工具（行事曆、團隊任務、訂單、客戶、價格、業績）
// 安全：service_role 繞過 RLS，每個工具都要自己檢查權限並限縮 tenant／使用者範圍。
import { addDays, dateGuide, loadCatalog, matchByNames, taipeiToday, weekdayOf, type Catalog } from "./order.ts";
export { addDays, dateGuide, weekdayOf };

export interface ToolMe { id: string; name: string; tenant_id: string; role: string; department_id?: string | null }

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const fmtMoney = (n: number) => Math.round(n).toLocaleString("en-US");
const dayLabel = (d: string | null) => (d ? `${d}（${weekdayOf(d)}）` : "未指定");
const STATUS_ZH: Record<string, string> = { draft: "草稿（老闆未送出）", pending_review: "待覆核", confirmed: "已確認", cancelled: "已取消" };
const SRC_ZH: Record<string, string> = { contract: "專屬價", last_order: "上次成交價", product_unit: "單位價", product: "牌價" };

async function hasPerm(sb: any, me: ToolMe, module: string, action = "view"): Promise<boolean> {
  const { data } = await sb.rpc("eip_user_has_perm", { p_user: me.id, p_module: module, p_action: action });
  return data === true;
}
const canSeeOrders = (sb: any, me: ToolMe) => hasPerm(sb, me, "eip_sales_order", "view");
async function canSeeMaster(sb: any, me: ToolMe) {
  return (await hasPerm(sb, me, "eip_sales_order", "view")) || (await hasPerm(sb, me, "eip_order_master", "view"));
}
const NO_ORDER_PERM = { error: "你的帳號沒有「訂單接收」的查看權限，請聯絡管理者開通。" };

// 依文字找客戶：唯一就回傳，多筆就回候選讓 AI 反問
function findCustomer(catalog: Catalog, text: string) {
  const r = matchByNames(catalog.customers, text, null, (c) => [c.short_name]);
  return r;
}
function findProduct(catalog: Catalog, text: string) {
  return matchByNames(catalog.products, text, null);
}
const candidatesMsg = (kind: string, text: string, names: string[]) =>
  names.length ? { error: `「${text}」對到多個${kind}：${names.join("、")}，請問是哪一個？` } : { error: `找不到${kind}「${text}」，請確認名稱（可用代號、全名、簡稱或別名）。` };

// ───────────────────────── 行事曆（個人行程＋會議＋到期任務） ─────────────────────────
export async function getAgenda(sb: any, me: ToolMe, input: Record<string, unknown>) {
  const { date: today } = taipeiToday();
  const start = isDate(input.date) ? input.date : today;
  const days = Math.min(Math.max(Number(input.days) || 1, 1), 14);
  const end = addDays(start, days - 1);

  const [{ data: events }, { data: own }, { data: att }, { data: tasks }] = await Promise.all([
    sb.from("personal_event").select("title, start_time, end_time, start_date, end_date")
      .eq("user_id", me.id).is("deleted_at", null).lte("start_date", end).or(`end_date.gte.${start},end_date.is.null`)
      .order("start_date").order("start_time", { ascending: true, nullsFirst: true }),
    sb.from("meeting").select("id, title, meeting_date, location, status").eq("tenant_id", me.tenant_id).eq("created_by", me.id)
      .gte("meeting_date", `${start}T00:00:00+08:00`).lte("meeting_date", `${end}T23:59:59+08:00`),
    sb.from("meeting_attendee").select("meeting(id, title, meeting_date, location, status, tenant_id)").eq("user_id", me.id),
    sb.from("task").select("title, priority, due_date, task_status(name, is_done_state)")
      .eq("owner_id", me.id).gte("due_date", start).lte("due_date", end).is("deleted_at", null),
  ]);
  const meetings = new Map<string, any>();
  const lo = new Date(`${start}T00:00:00+08:00`).getTime(), hi = new Date(`${end}T23:59:59+08:00`).getTime();
  for (const m of (own ?? []) as any[]) meetings.set(m.id, m);
  for (const a of (att ?? []) as any[]) {
    const m = a.meeting;
    if (!m || m.tenant_id !== me.tenant_id || !m.meeting_date) continue;
    const t = new Date(m.meeting_date).getTime();
    if (t >= lo && t <= hi) meetings.set(m.id, m);
  }
  const tpe = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600e3).toISOString();
  const out: any[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    const ev = ((events ?? []) as any[]).filter((e) => e.start_date <= d && (!e.end_date || e.end_date >= d))
      .map((e) => ({ 類型: "行程", 標題: e.title, 時間: e.start_time ? e.start_time.slice(0, 5) + (e.end_time ? "-" + e.end_time.slice(0, 5) : "") : "整天" }));
    const mt = [...meetings.values()].filter((m) => tpe(m.meeting_date).slice(0, 10) === d && !["cancelled", "draft"].includes(m.status))
      .sort((a, b) => a.meeting_date.localeCompare(b.meeting_date))
      .map((m) => ({ 類型: "會議", 標題: m.title, 時間: tpe(m.meeting_date).slice(11, 16), 地點: m.location ?? null }));
    const tk = ((tasks ?? []) as any[]).filter((t) => t.due_date === d && t.task_status?.is_done_state !== true)
      .map((t) => ({ 類型: "到期任務", 標題: t.title, 狀態: t.task_status?.name ?? null, 優先級: t.priority }));
    out.push({ 日期: dayLabel(d), 項目: [...mt, ...ev].sort((a: any, b: any) => String(a.時間).localeCompare(String(b.時間))).concat(tk as any[]) });
  }
  return { 範圍: days > 1 ? `${start} ～ ${end}` : dayLabel(start), 每日: out, 說明: "空的日子代表沒有行程、會議或到期任務。" };
}

// ───────────────────────── 團隊任務（管理者全公司；主管看管轄部門） ─────────────────────────
export async function listTeamTasks(sb: any, me: ToolMe, input: Record<string, unknown>) {
  const { date: today } = taipeiToday();
  let deptIds: string[] | null = null;
  if (me.role !== "company_admin") {
    const { data: sup } = await sb.rpc("eip_supervised_departments_of", { p_user: me.id });
    deptIds = (sup ?? []).map((r: any) => (typeof r === "string" ? r : r?.eip_supervised_departments_of ?? r?.id)).filter(Boolean);
    if (!deptIds!.length) return { error: "只有主管或管理者可以查團隊任務；查自己的任務請說「我的任務」。" };
  }
  let q = sb.from("task").select("title, due_date, priority, progress, owner_id, task_status(name, is_done_state), project(name), app_user:owner_id(name)")
    .eq("tenant_id", me.tenant_id).is("deleted_at", null).order("due_date", { ascending: true, nullsFirst: false }).limit(500);
  if (deptIds) q = q.in("department_id", deptIds);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  let rows = ((data ?? []) as any[]).filter((r) => r.task_status?.is_done_state !== true || input.include_done === true);
  const owner = String(input.owner_name ?? "").trim();
  if (owner) rows = rows.filter((r) => String(r.app_user?.name ?? "").includes(owner));
  if (input.status_name) rows = rows.filter((r) => r.task_status?.name === input.status_name);
  if (input.overdue_only) rows = rows.filter((r) => r.due_date && r.due_date < today && r.task_status?.is_done_state !== true);
  const within = Number(input.due_within_days);
  if (within > 0) rows = rows.filter((r) => r.due_date && r.due_date >= today && r.due_date <= addDays(today, within));
  const limit = Math.min(Number(input.limit) || 20, 50);
  const overdue = rows.filter((r) => r.due_date && r.due_date < today).length;
  return {
    範圍: me.role === "company_admin" ? "全公司" : "你管轄的部門", 符合筆數: rows.length, 其中逾期: overdue,
    任務: rows.slice(0, limit).map((r) => ({ 標題: r.title, 負責人: r.app_user?.name ?? null, 狀態: r.task_status?.name ?? null, 期限: r.due_date ? dayLabel(r.due_date) : null, 逾期: !!(r.due_date && r.due_date < today), 進度: r.progress, 專案: r.project?.name ?? null })),
    ...(rows.length > limit ? { 說明: `只列前 ${limit} 筆，共 ${rows.length} 筆` } : {}),
  };
}

// ───────────────────────── 訂單查詢 ─────────────────────────
export async function querySalesOrders(sb: any, me: ToolMe, input: Record<string, unknown>) {
  if (!(await canSeeOrders(sb, me))) return NO_ORDER_PERM;
  const status = String(input.status ?? "open");
  const field = input.date_field === "order_date" ? "order_date" : "delivery_date";
  let q = sb.from("eip_sales_order")
    .select("order_no, status, order_date, delivery_date, total_amount, customer_text, source, eip_customer(name), eip_customer_address(label), eip_sales_order_line(id)")
    .eq("tenant_id", me.tenant_id).is("deleted_at", null).order(field, { ascending: true, nullsFirst: false }).order("order_no").limit(300);
  if (status === "open") q = q.in("status", ["draft", "pending_review", "confirmed"]);
  else if (status !== "all") q = q.eq("status", status);
  if (isDate(input.date_from)) q = q.gte(field, input.date_from);
  if (isDate(input.date_to)) q = q.lte(field, input.date_to);
  let custName: string | null = null;
  if (input.customer) {
    const catalog = await loadCatalog(sb, me.tenant_id);
    const m = findCustomer(catalog, String(input.customer));
    if (!m.item) return candidatesMsg("客戶", String(input.customer), m.candidates.map((c) => c.name));
    q = q.eq("customer_id", m.item.id); custName = m.item.name;
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[STATUS_ZH[r.status] ?? r.status] = (byStatus[STATUS_ZH[r.status] ?? r.status] ?? 0) + 1;
  const total = rows.filter((r) => r.status !== "cancelled").reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
  const limit = Math.min(Number(input.limit) || 15, 40);
  return {
    條件: { 狀態: status === "open" ? "未取消（草稿＋待覆核＋已確認）" : status === "all" ? "全部" : STATUS_ZH[status] ?? status, 日期欄位: field === "delivery_date" ? "交貨日" : "訂單日", 起: input.date_from ?? null, 迄: input.date_to ?? null, 客戶: custName },
    筆數: rows.length, 依狀態: byStatus, 合計含稅金額: `${fmtMoney(total)} 元`,
    訂單: rows.slice(0, limit).map((r) => ({
      單號: r.order_no, 狀態: STATUS_ZH[r.status] ?? r.status, 客戶: r.eip_customer?.name ?? `（未對應）${r.customer_text ?? ""}`,
      送貨地點: r.eip_customer_address?.label ?? null, 訂單日: r.order_date, 交貨日: dayLabel(r.delivery_date),
      品項數: r.eip_sales_order_line?.length ?? 0, 總計: `${fmtMoney(Number(r.total_amount ?? 0))} 元`, 來源: r.source === "line" ? "LINE" : "網頁",
    })),
    ...(rows.length > limit ? { 說明: `只列前 ${limit} 張，共 ${rows.length} 張` } : {}),
  };
}

export async function getSalesOrder(sb: any, me: ToolMe, input: Record<string, unknown>) {
  if (!(await canSeeOrders(sb, me))) return NO_ORDER_PERM;
  const no = String(input.order_no ?? "").trim().toUpperCase().replace(/\s/g, "");
  if (!no) return { error: "請提供單號，例如 SO261016-001" };
  const sel = "id, order_no, status, order_date, delivery_date, delivery_address, delivery_time_window, contact_name, contact_phone, payment_terms, tax_type, subtotal, tax_amount, total_amount, note, customer_text, ai_issues, cancelled_reason, eip_customer(name), eip_customer_address(label), eip_sales_order_line(line_no, product_text, spec, qty, unit, unit_price, amount, price_source, eip_product(name))";
  let { data } = await sb.from("eip_sales_order").select(sel).eq("tenant_id", me.tenant_id).is("deleted_at", null).eq("order_no", no).maybeSingle();
  if (!data) {
    const safe = no.replace(/[^A-Z0-9-]/g, "");
    const { data: list } = await sb.from("eip_sales_order").select("order_no").eq("tenant_id", me.tenant_id).is("deleted_at", null)
      .ilike("order_no", `%${safe}%`).order("created_at", { ascending: false }).limit(5);
    if (!list?.length) return { error: `找不到單號「${no}」` };
    if (list.length > 1) return { error: `「${no}」對到多張訂單：${list.map((x: any) => x.order_no).join("、")}，請說完整單號。` };
    ({ data } = await sb.from("eip_sales_order").select(sel).eq("order_no", list[0].order_no).maybeSingle());
  }
  const o: any = data;
  const lines = [...(o.eip_sales_order_line ?? [])].sort((a: any, b: any) => a.line_no - b.line_no);
  return {
    單號: o.order_no, 狀態: STATUS_ZH[o.status] ?? o.status, 客戶: o.eip_customer?.name ?? `（未對應）${o.customer_text ?? ""}`,
    訂單日: o.order_date, 交貨日: dayLabel(o.delivery_date), 送貨地點: o.eip_customer_address?.label ?? null, 地址: o.delivery_address,
    收貨時段: o.delivery_time_window, 收貨人: o.contact_name, 電話: o.contact_phone, 付款條件: o.payment_terms,
    品項: lines.map((l: any) => ({ 品名: l.eip_product?.name ?? l.product_text, 規格: l.spec, 數量: Number(l.qty), 單位: l.unit, 單價: l.unit_price != null ? Number(l.unit_price) : null, 金額: l.amount != null ? Number(l.amount) : null })),
    未稅: Number(o.subtotal), 稅額: Number(o.tax_amount), 總計: `${fmtMoney(Number(o.total_amount))} 元`,
    備註: o.note, 待確認事項: o.status === "confirmed" ? [] : (o.ai_issues ?? []), 取消原因: o.cancelled_reason,
  };
}

// ───────────────────────── 客戶資料 ─────────────────────────
export async function lookupCustomer(sb: any, me: ToolMe, input: Record<string, unknown>) {
  if (!(await canSeeMaster(sb, me))) return NO_ORDER_PERM;
  const text = String(input.name ?? "").trim();
  if (!text) return { error: "請提供客戶名稱" };
  const catalog = await loadCatalog(sb, me.tenant_id);
  const m = findCustomer(catalog, text);
  if (!m.item) return candidatesMsg("客戶", text, m.candidates.map((c) => c.name));
  const { data: c } = await sb.from("eip_customer").select("*, eip_customer_address(label, address, receiver_name, receiver_phone, delivery_time_window, is_default, is_active), app_user:sales_owner_id(name)").eq("id", m.item.id).maybeSingle();
  const { date: today } = taipeiToday();
  const monthStart = today.slice(0, 8) + "01";
  const [{ data: recent }, { data: month }] = await Promise.all([
    sb.from("eip_sales_order").select("order_no, status, order_date, delivery_date, total_amount").eq("customer_id", m.item.id).is("deleted_at", null)
      .neq("status", "cancelled").order("created_at", { ascending: false }).limit(3),
    sb.from("eip_sales_order").select("total_amount").eq("customer_id", m.item.id).is("deleted_at", null).eq("status", "confirmed").gte("order_date", monthStart),
  ]);
  const monthTotal = ((month ?? []) as any[]).reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
  return {
    代號: c.code, 名稱: c.name, 簡稱: c.short_name, 別名: c.aliases, 統編: c.tax_id, 聯絡人: c.contact_name, 電話: c.phone, Email: c.email,
    付款條件: c.payment_terms, 稅別: c.tax_type === "inclusive" ? "內含" : c.tax_type === "exempt" ? "免稅" : c.tax_type === "exclusive" ? "外加" : "依系統預設",
    預設交期天數: c.delivery_lead_days, 收貨時段: c.delivery_time_window, 送貨注意事項: c.delivery_note, 主要送貨地址: c.address, 業務: c.app_user?.name ?? null,
    分店地址: ((c.eip_customer_address ?? []) as any[]).filter((a) => a.is_active).map((a) => ({ 地點: a.label + (a.is_default ? "（預設）" : ""), 地址: a.address, 收貨人: a.receiver_name, 電話: a.receiver_phone, 收貨時段: a.delivery_time_window })),
    本月已確認金額: `${fmtMoney(monthTotal)} 元`,
    最近訂單: ((recent ?? []) as any[]).map((o) => ({ 單號: o.order_no, 狀態: STATUS_ZH[o.status], 訂單日: o.order_date, 交貨日: o.delivery_date, 總計: `${fmtMoney(Number(o.total_amount))} 元` })),
  };
}

// ───────────────────────── 價格查詢 ─────────────────────────
export async function lookupPrice(sb: any, me: ToolMe, input: Record<string, unknown>) {
  if (!(await canSeeMaster(sb, me))) return NO_ORDER_PERM;
  const ptext = String(input.product ?? "").trim();
  if (!ptext) return { error: "請提供品項名稱" };
  const catalog = await loadCatalog(sb, me.tenant_id);
  const pm = findProduct(catalog, ptext);
  if (!pm.item) return candidatesMsg("品項", ptext, pm.candidates.map((p) => p.name));
  const p = pm.item;
  let cust: { id: string; name: string } | null = null;
  if (input.customer) {
    const cm = findCustomer(catalog, String(input.customer));
    if (!cm.item) return candidatesMsg("客戶", String(input.customer), cm.candidates.map((c) => c.name));
    cust = { id: cm.item.id, name: cm.item.name };
  }
  const units = [p.unit, ...(p.eip_product_unit ?? []).map((u) => u.unit)].filter(Boolean) as string[];
  const askUnit = input.unit ? String(input.unit) : null;
  const { date: today } = taipeiToday();
  const prices: any[] = [];
  for (const u of askUnit ? [askUnit] : units.length ? units : [null]) {
    const { data } = await sb.rpc("eip_price_lookup", { p_customer: cust?.id ?? null, p_product: p.id, p_unit: u, p_date: today });
    const r = Array.isArray(data) ? data[0] : data;
    prices.push({ 單位: u ?? "主單位", 單價: r ? `${fmtMoney(Number(r.unit_price))} 元` : "查無價格", 來源: r ? SRC_ZH[r.source] ?? r.source : null });
  }
  let contract: any[] = [];
  if (cust) {
    const { data } = await sb.from("eip_customer_price").select("unit, unit_price, valid_from, valid_to, source").eq("customer_id", cust.id).eq("product_id", p.id);
    contract = ((data ?? []) as any[]).map((x) => ({ 種類: x.source === "contract" ? "專屬價" : "上次成交價", 單位: x.unit ?? p.unit, 單價: `${fmtMoney(Number(x.unit_price))} 元`, 有效期間: x.valid_from || x.valid_to ? `${x.valid_from ?? ""} ～ ${x.valid_to ?? ""}` : null }));
  }
  return {
    品項: `${p.code ? p.code + "｜" : ""}${p.name}`, 規格: p.spec, 主單位: p.unit, 牌價: p.unit_price != null ? `${fmtMoney(Number(p.unit_price))} 元／${p.unit ?? "主單位"}` : "未設定",
    其他單位: (p.eip_product_unit ?? []).map((u) => `${u.unit}（=${u.ratio} ${p.unit ?? "主單位"}）`),
    客戶: cust?.name ?? "（未指定客戶，以下為一般價格）", 下單時會帶的價格: prices, 此客戶價格紀錄: cust ? contract : undefined,
    說明: "帶價順序：專屬價（有效期間內）→ 上次成交價 → 單位價 → 牌價。",
  };
}

// ───────────────────────── 業績統計（已確認訂單） ─────────────────────────
export async function salesSummary(sb: any, me: ToolMe, input: Record<string, unknown>) {
  if (!(await canSeeOrders(sb, me))) return NO_ORDER_PERM;
  const { date: today } = taipeiToday();
  const from = isDate(input.date_from) ? input.date_from : today.slice(0, 8) + "01";
  const to = isDate(input.date_to) ? input.date_to : today;
  const group = ["customer", "product", "day"].includes(String(input.group_by)) ? String(input.group_by) : "customer";
  const statuses = input.include_pending ? ["confirmed", "pending_review"] : ["confirmed"];
  let q = sb.from("eip_sales_order")
    .select("id, order_no, order_date, subtotal, total_amount, customer_id, eip_customer(name), eip_sales_order_line(qty, unit, amount, product_id, product_text, eip_product(name))")
    .eq("tenant_id", me.tenant_id).is("deleted_at", null).in("status", statuses).gte("order_date", from).lte("order_date", to).limit(3000);
  const catalog = (input.customer || input.product) ? await loadCatalog(sb, me.tenant_id) : null;
  let custName: string | null = null, prod: { id: string; name: string } | null = null;
  if (input.customer && catalog) {
    const cm = findCustomer(catalog, String(input.customer));
    if (!cm.item) return candidatesMsg("客戶", String(input.customer), cm.candidates.map((c) => c.name));
    q = q.eq("customer_id", cm.item.id); custName = cm.item.name;
  }
  if (input.product && catalog) {
    const pm = findProduct(catalog, String(input.product));
    if (!pm.item) return candidatesMsg("品項", String(input.product), pm.candidates.map((p) => p.name));
    prod = { id: pm.item.id, name: pm.item.name };
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const orders = (data ?? []) as any[];
  const agg = new Map<string, { 未稅: number; 數量: Map<string, number>; 張數: Set<string> }>();
  let subtotal = 0, total = 0, count = 0;
  for (const o of orders) {
    const lines = ((o.eip_sales_order_line ?? []) as any[]).filter((l) => !prod || l.product_id === prod.id);
    if (prod && !lines.length) continue;
    count++;
    if (!prod) { subtotal += Number(o.subtotal ?? 0); total += Number(o.total_amount ?? 0); }
    const keyOf = (l: any) => group === "customer" ? (o.eip_customer?.name ?? "（未對應）") : group === "day" ? o.order_date : (l.eip_product?.name ?? l.product_text ?? "（未對應）");
    for (const l of lines) {
      const k = keyOf(l);
      const a = agg.get(k) ?? { 未稅: 0, 數量: new Map(), 張數: new Set() };
      a.未稅 += Number(l.amount ?? 0); a.張數.add(o.id);
      const u = l.unit ?? "";
      a.數量.set(u, (a.數量.get(u) ?? 0) + Number(l.qty ?? 0));
      agg.set(k, a);
      if (prod) subtotal += Number(l.amount ?? 0);
    }
  }
  const top = Math.min(Number(input.top) || 10, 30);
  const ranked = [...agg.entries()].sort((a, b) => group === "day" ? a[0].localeCompare(b[0]) : b[1].未稅 - a[1].未稅);
  return {
    期間: `${from} ～ ${to}`, 計入: input.include_pending ? "已確認＋待覆核" : "只算已確認", 客戶: custName, 品項: prod?.name ?? null,
    訂單張數: count, 未稅合計: `${fmtMoney(subtotal)} 元`, ...(prod ? {} : { 含稅合計: `${fmtMoney(total)} 元` }),
    [group === "customer" ? "依客戶" : group === "day" ? "依日期" : "依品項"]: ranked.slice(0, group === "day" ? 62 : top).map(([k, a]) => ({
      名稱: k, 未稅金額: `${fmtMoney(a.未稅)} 元`, 張數: a.張數.size,
      數量: [...a.數量.entries()].map(([u, q]) => `${Math.round(q * 1000) / 1000}${u}`).join("、"),
    })),
    說明: "金額為未稅；品項明細加總可能因四捨五入與訂單總額差 1 元。",
  };
}
