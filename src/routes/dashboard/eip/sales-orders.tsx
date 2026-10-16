import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ClipboardList, Plus, Search, Download, Save, CheckCircle2, XCircle, Trash2,
  Paperclip, AlertTriangle, MessageSquareText, History, UserPlus, PackagePlus, RotateCcw,
} from "lucide-react";

// 新資料表尚未進 src/integrations/supabase/types.ts，這裡用 any 版 client。
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useAllUsers } from "@/hooks/useUsers";
import { DEFAULT_TENANT_ID } from "@/lib/eip-constants";
import { exportToExcel } from "@/lib/eip-export";
import { humanizeError } from "@/lib/eip-error";
import { RequirePerm } from "@/components/RequirePerm";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SearchSelect } from "@/components/eip/SearchSelect";
import { NumberInput } from "@/components/eip/NumberInput";
import {
  PAYMENT_TERMS_PRESETS, PRICE_SOURCE_LABEL, TAX_TYPE_LABEL, TAX_TYPE_SHORT, calcTotals, money,
  type PriceSource, type TaxType,
} from "@/lib/sales-order";

export const Route = createFileRoute("/dashboard/eip/sales-orders")({
  component: () => (
    <RequirePerm module="eip_sales_order">
      <SalesOrdersPage />
    </RequirePerm>
  ),
});

type Status = "draft" | "pending_review" | "confirmed" | "cancelled";
const STATUS_META: Record<Status, { label: string; cls: string }> = {
  draft: { label: "草稿（老闆未送出）", cls: "bg-muted text-muted-foreground" },
  pending_review: { label: "待覆核", cls: "bg-amber-100 text-amber-800" },
  confirmed: { label: "已確認", cls: "bg-emerald-100 text-emerald-800" },
  cancelled: { label: "已取消", cls: "bg-rose-100 text-rose-700" },
};

type Customer = {
  id: string; code: string | null; name: string; short_name: string | null; address: string | null; is_active: boolean; aliases: string[] | null;
  contact_name: string | null; phone: string | null; payment_terms: string | null; tax_type: TaxType | null; delivery_time_window: string | null;
  delivery_lead_days: number | null; delivery_note: string | null;
};
type Address = { id: string; customer_id: string; label: string; address: string; receiver_name: string | null; receiver_phone: string | null; delivery_time_window: string | null; is_default: boolean; is_active: boolean };
type Product = {
  id: string; code: string | null; name: string; spec: string | null; unit: string | null; unit_price: number | null; is_active: boolean;
  aliases: string[] | null; eip_product_unit?: { unit: string; ratio?: number | null }[];
};
type Usual = { product_id: string; order_count: number; usual_unit: string | null; base_unit: string | null; avg_base_qty: number | null; max_base_qty: number | null; is_hidden: boolean };
type Order = {
  id: string; order_no: string; status: Status; source: "line" | "web";
  customer_id: string | null; customer_text: string | null; contact_name: string | null; contact_phone: string | null;
  order_date: string; delivery_date: string | null; delivery_address: string | null; note: string | null;
  customer_address_id: string | null; delivery_time_window: string | null; payment_terms: string | null;
  tax_type: TaxType; tax_rate: number; subtotal: number; tax_amount: number; total_amount: number;
  raw_text: string | null; ai_summary: string | null; ai_issues: string[]; attachments: { path: string; name: string; mime: string; size: number }[];
  created_by: string | null; owner_confirmed_at: string | null; reviewed_by: string | null; reviewed_at: string | null;
  cancelled_reason: string | null; erp_order_no: string | null; created_at: string;
  eip_customer?: { name: string; code: string | null } | null;
  eip_sales_order_line?: { id: string; needs_review: boolean }[];
};
type Line = {
  id?: string; line_no: number; product_id: string | null; product_text: string | null; spec: string | null;
  qty: number | null; unit: string | null; unit_price: number | null; note: string | null; needs_review: boolean;
  price_source: PriceSource | null;
};

const fmtDT = (s: string | null) => (s ? new Date(s).toLocaleString("zh-TW", { hour12: false }) : "—");
const WD = ["日", "一", "二", "三", "四", "五", "六"];
const weekdayOf = (d: string | null) => (d ? WD[new Date(d + "T00:00:00Z").getUTCDay()] : "");
type OrderSetting = { default_tax_type: TaxType; tax_rate: number; no_delivery_weekdays: number[]; holidays: string[]; qty_alert_ratio?: number };
const isNoDeliveryDay = (s: OrderSetting, d: string | null) => !!d && (s.no_delivery_weekdays.includes(new Date(d + "T00:00:00Z").getUTCDay()) || s.holidays.includes(d));
const nextDeliveryDay = (s: OrderSetting, d: string) => {
  const x = new Date(d + "T00:00:00Z");
  for (let i = 0; i < 14 && isNoDeliveryDay(s, x.toISOString().slice(0, 10)); i++) x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};
// 用來判斷「有沒有未儲存的修改」
const snapshotOf = (o: Order | null, ls: Line[]) => JSON.stringify(o ? [
  o.customer_id, o.customer_address_id, o.contact_name ?? "", o.contact_phone ?? "", o.order_date, o.delivery_date ?? "", o.delivery_address ?? "",
  o.delivery_time_window ?? "", o.payment_terms ?? "", o.tax_type, o.note ?? "", o.erp_order_no ?? "",
  ls.map((l) => [l.product_id, l.product_text, l.spec ?? "", l.qty, l.unit ?? "", l.unit_price, l.note ?? ""]),
] : null);

function SalesOrdersPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const canCreate = can("eip_sales_order", "create");
  const canEdit = can("eip_sales_order", "edit");
  const canExport = can("eip_sales_order", "export");
  const [tab, setTab] = useState<"pending_review" | "draft" | "confirmed" | "cancelled" | "all">("pending_review");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: users = [] } = useAllUsers();
  const userName = useMemo(() => new Map((users as any[]).map((u) => [u.id, u.name])), [users]);

  const { data: orders = [], isLoading, error } = useQuery({
    queryKey: ["sales-orders"],
    queryFn: async () => {
      const { data, error } = await supabase.from("eip_sales_order")
        .select("*, eip_customer(name,code), eip_sales_order_line(id,needs_review)")
        .is("deleted_at", null).order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as Order[];
    },
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: orders.length };
    for (const o of orders) c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, [orders]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return orders.filter((o) => (tab === "all" || o.status === tab) && (!kw || [o.order_no, o.eip_customer?.name, o.customer_text, o.raw_text, o.erp_order_no].some((s) => (s ?? "").toLowerCase().includes(kw))));
  }, [orders, tab, q]);

  const createManual = async () => {
    const { data, error } = await supabase.from("eip_sales_order").insert({ tenant_id: DEFAULT_TENANT_ID, status: "pending_review", source: "web" }).select("id").maybeSingle();
    if (error || !data) { toast.error(error ? humanizeError(error, "新增訂單") : "新增訂單失敗：沒有權限"); return; }
    await qc.invalidateQueries({ queryKey: ["sales-orders"] });
    setOpenId(data.id);
  };

  const exportList = () => {
    const rows = filtered.map((o) => ({
      單號: o.order_no, 狀態: STATUS_META[o.status].label, 來源: o.source === "line" ? "LINE" : "網頁",
      客戶: o.eip_customer?.name ?? `（未對應）${o.customer_text ?? ""}`, 客戶代號: o.eip_customer?.code ?? "",
      訂單日期: o.order_date, 交貨日期: o.delivery_date ?? "", 交貨地址: o.delivery_address ?? "",
      品項數: o.eip_sales_order_line?.length ?? 0, 未稅: Number(o.subtotal ?? 0), 稅額: Number(o.tax_amount ?? 0), 總計: Number(o.total_amount ?? 0), 凌越單號: o.erp_order_no ?? "",
      建立者: userName.get(o.created_by ?? "") ?? "", 建立時間: fmtDT(o.created_at),
    }));
    const headers = ["單號", "狀態", "來源", "客戶", "客戶代號", "訂單日期", "交貨日期", "交貨地址", "品項數", "未稅", "稅額", "總計", "凌越單號", "建立者", "建立時間"];
    exportToExcel({ filename: "訂單接收", sheetName: "訂單", rows, columns: headers.map((h) => ({ header: h, key: h })) });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="訂單接收"
        description="老闆從 LINE 傳來的訂單（文字、照片、PDF、Excel）會由 AI 整理成草稿；老闆按「送出訂單」後進入「待覆核」，由內勤在這裡對應客戶與品項主檔、補齊資料後確認。"
        actions={<>
          {canExport && <Button variant="outline" onClick={exportList}><Download className="h-4 w-4 mr-1.5" />匯出 Excel</Button>}
          {canCreate && <Button onClick={createManual}><Plus className="h-4 w-4 mr-1.5" />手動新增訂單</Button>}
        </>}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="pending_review">待覆核 {counts.pending_review ?? 0}</TabsTrigger>
            <TabsTrigger value="draft">草稿 {counts.draft ?? 0}</TabsTrigger>
            <TabsTrigger value="confirmed">已確認 {counts.confirmed ?? 0}</TabsTrigger>
            <TabsTrigger value="cancelled">已取消 {counts.cancelled ?? 0}</TabsTrigger>
            <TabsTrigger value="all">全部 {counts.all ?? 0}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative w-64">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input className="pl-8" placeholder="搜尋單號、客戶、原始訊息" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="p-6 text-destructive text-sm">{humanizeError(error, "讀取訂單")}</div>
          ) : isLoading ? (
            <div className="p-6 text-muted-foreground text-sm">載入中…</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground text-sm">
              <ClipboardList className="h-8 w-8 mx-auto mb-2 opacity-60" />
              目前沒有訂單。老闆可在 LINE 輸入「下單，客戶、品項、數量、交期」，或直接傳訂單照片／檔案。
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>單號</TableHead><TableHead>客戶</TableHead><TableHead>交貨日期</TableHead>
                  <TableHead className="text-right">品項</TableHead><TableHead className="text-right">總計</TableHead><TableHead>來源</TableHead><TableHead>建立者</TableHead>
                  <TableHead>狀態</TableHead><TableHead>建立時間</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((o) => {
                  const warn = (o.eip_sales_order_line ?? []).filter((l) => l.needs_review).length + (o.customer_id ? 0 : 1);
                  return (
                    <TableRow key={o.id} className="cursor-pointer" onClick={() => setOpenId(o.id)}>
                      <TableCell className="font-mono text-xs">{o.order_no}</TableCell>
                      <TableCell>
                        {o.eip_customer?.name ?? <span className="text-amber-700">⚠ {o.customer_text ?? "未指定"}</span>}
                      </TableCell>
                      <TableCell>{o.delivery_date ?? <span className="text-muted-foreground">未指定</span>}</TableCell>
                      <TableCell className="text-right">
                        {o.eip_sales_order_line?.length ?? 0}
                        {warn > 0 && o.status !== "confirmed" && o.status !== "cancelled" && <span className="ml-1 text-amber-700 text-xs">（{warn} 待確認）</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{Number(o.total_amount) > 0 ? money(o.total_amount) : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>{o.source === "line" ? <Badge variant="secondary">LINE</Badge> : <Badge variant="outline">網頁</Badge>}</TableCell>
                      <TableCell>{userName.get(o.created_by ?? "") ?? "—"}</TableCell>
                      <TableCell><span className={`text-xs px-2 py-0.5 rounded ${STATUS_META[o.status].cls}`}>{STATUS_META[o.status].label}</span></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDT(o.created_at)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {openId && (
        <OrderDialog
          orderId={openId}
          canEdit={canEdit}
          userName={userName}
          onClose={() => { setOpenId(null); qc.invalidateQueries({ queryKey: ["sales-orders"] }); }}
        />
      )}
    </div>
  );
}

function OrderDialog({ orderId, canEdit, userName, onClose }: {
  orderId: string; canEdit: boolean; userName: Map<string, string>; onClose: () => void;
}) {
  const { user } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [setting, setSetting] = useState<OrderSetting>({ default_tax_type: "exclusive", tax_rate: 0.05, no_delivery_weekdays: [0], holidays: [] });
  const snap = useRef<string>("");
  const blankOnLoad = useRef(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [askCancel, setAskCancel] = useState(false);

  const loadAddresses = async (customerId: string | null) => {
    if (!customerId) { setAddresses([]); return [] as Address[]; }
    const { data } = await supabase.from("eip_customer_address").select("*").eq("customer_id", customerId).order("is_default", { ascending: false }).order("label");
    const list = (data ?? []) as Address[];
    setAddresses(list);
    return list;
  };

  const load = async () => {
    const [o, l, c, p, g, s] = await Promise.all([
      supabase.from("eip_sales_order").select("*").eq("id", orderId).maybeSingle(),
      supabase.from("eip_sales_order_line").select("*").eq("order_id", orderId).order("line_no"),
      supabase.from("eip_customer").select("id,code,name,short_name,address,is_active,aliases,contact_name,phone,payment_terms,tax_type,delivery_time_window,delivery_lead_days,delivery_note").order("name").limit(3000),
      supabase.from("eip_product").select("id,code,name,spec,unit,unit_price,is_active,aliases,eip_product_unit(unit,ratio)").order("name").limit(5000),
      supabase.from("eip_sales_order_log").select("*").eq("order_id", orderId).order("created_at"),
      supabase.from("eip_sales_order_setting").select("default_tax_type,tax_rate,no_delivery_weekdays,holidays,qty_alert_ratio").maybeSingle(),
    ]);
    if (o.error) { toast.error(humanizeError(o.error, "讀取訂單")); return; }
    const od = o.data as Order;
    const nextOrder = od ? { ...od, tax_rate: Number(od.tax_rate ?? 0.05) } : od;
    const nextLines = (l.data ?? []) as Line[];
    setOrder(nextOrder);
    setLines(nextLines);
    snap.current = snapshotOf(nextOrder, nextLines);
    blankOnLoad.current = !!od && od.source === "web" && !od.customer_id && nextLines.length === 0 && !od.note && !od.raw_text;
    setCustomers((c.data ?? []) as Customer[]);
    setProducts((p.data ?? []) as Product[]);
    setLogs(g.data ?? []);
    if (s.data) setSetting({
      default_tax_type: s.data.default_tax_type, tax_rate: Number(s.data.tax_rate),
      no_delivery_weekdays: (s.data.no_delivery_weekdays ?? [0]).map(Number), holidays: (s.data.holidays ?? []).map(String),
      qty_alert_ratio: Number(s.data.qty_alert_ratio ?? 3),
    });
    await loadAddresses(od?.customer_id ?? null);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orderId]);

  const editable = !!order && order.status !== "cancelled" && order.status !== "confirmed" &&
    (canEdit || (order.created_by === user?.id && (order.status === "draft" || order.status === "pending_review")));
  const prodMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  // 此客戶常訂品項（歷史銷貨＋已確認訂單）：選單排前面、帶慣用單位、數量明顯偏離時提醒
  const [usual, setUsual] = useState<Map<string, Usual>>(new Map());
  useEffect(() => {
    const cid = order?.customer_id;
    if (!cid) { setUsual(new Map()); return; }
    let alive = true;
    void supabase.from("eip_customer_product_profile").select("product_id,order_count,usual_unit,base_unit,avg_base_qty,max_base_qty,is_hidden")
      .eq("customer_id", cid).gt("order_count", 0).then(({ data }) => {
        if (alive) setUsual(new Map(((data ?? []) as Usual[]).map((u) => [u.product_id, { ...u, avg_base_qty: u.avg_base_qty == null ? null : Number(u.avg_base_qty), max_base_qty: u.max_base_qty == null ? null : Number(u.max_base_qty) }])));
      });
    return () => { alive = false; };
  }, [order?.customer_id]);
  const qtyHint = (l: Line): string | null => {
    const u = l.product_id ? usual.get(l.product_id) : undefined;
    const p = l.product_id ? prodMap.get(l.product_id) : undefined;
    if (!u || u.order_count < 2 || !u.avg_base_qty || !l.qty || !p) return null;
    const r = !l.unit || l.unit === p.unit ? 1 : Number(p.eip_product_unit?.find((x) => x.unit === l.unit)?.ratio ?? NaN);
    if (!Number.isFinite(r) || r <= 0) return null;
    const base = l.qty * r, k = setting.qty_alert_ratio ?? 3, bu = u.base_unit ?? p.unit ?? "";
    if (base > u.avg_base_qty * k) return `高於此客戶平均 ${money(u.avg_base_qty)}${bu}`;
    if (base * k < u.avg_base_qty) return `低於此客戶平均 ${money(u.avg_base_qty)}${bu}`;
    return null;
  };
  const custMap = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const sum = lines.reduce((s, l) => s + Math.round((l.qty ?? 0) * (l.unit_price ?? 0) * 100) / 100, 0);
  const totals = order ? calcTotals(sum, order.tax_type ?? setting.default_tax_type, Number(order.tax_rate ?? setting.tax_rate)) : { subtotal: 0, tax: 0, total: 0 };
  const custOpts = useMemo(() => customers.filter((c) => c.is_active || c.id === order?.customer_id)
    .map((c) => ({ value: c.id, label: `${c.code ? c.code + "｜" : ""}${c.name}`, hint: [c.short_name, c.payment_terms].filter(Boolean).join("・") || null, keywords: [c.short_name, ...(c.aliases ?? [])] })), [customers, order?.customer_id]);
  const prodOpts = useMemo(() => products.filter((p) => p.is_active || lines.some((l) => l.product_id === p.id))
    .map((p) => {
      const u = usual.get(p.id);
      const often = u && !u.is_hidden ? u.order_count : 0;
      return {
        often,
        value: p.id, label: `${p.code ? p.code + "｜" : ""}${p.name}`,
        hint: [often ? `★ 常訂 ${often} 次` : null, p.spec, p.unit && `${p.unit}${p.unit_price != null ? " $" + money(p.unit_price) : ""}`].filter(Boolean).join("・") || null,
        keywords: p.aliases ?? [],
      };
    })
    .sort((a, b) => b.often - a.often)
    .map(({ often: _o, ...o }) => o), [products, lines, usual]);

  const setO = (patch: Partial<Order>) => setOrder((o) => (o ? { ...o, ...patch } : o));
  const setL = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  // 依「專屬價 → 最近成交價 → 單位價 → 牌價」取價（與資料庫同一個函式）
  const resolvePrice = async (customerId: string | null, productId: string, unit: string | null) => {
    const { data } = await supabase.rpc("eip_resolve_price", { p_customer: customerId, p_product: productId, p_unit: unit, p_date: order?.order_date ?? null });
    const r = Array.isArray(data) ? data[0] : data;
    return r ? { unit_price: Number(r.unit_price), price_source: r.source as PriceSource } : null;
  };
  const repriceLine = async (i: number, productId: string | null, unit: string | null, customerId = order?.customer_id ?? null) => {
    if (!productId) return;
    const r = await resolvePrice(customerId, productId, unit);
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, unit_price: r?.unit_price ?? null, price_source: r?.price_source ?? null } : l)));
  };

  // 換客戶：帶入預設地址、聯絡人、付款條件、稅別、交期，並重新取價（手改／老闆指定的價格不動）
  const changeCustomer = async (customerId: string | null) => {
    if (!order) return;
    const c = customerId ? custMap.get(customerId) : undefined;
    const addrs = await loadAddresses(customerId);
    const def = addrs.find((a) => a.is_default && a.is_active);
    const patch: Partial<Order> = { customer_id: customerId };
    if (c) {
      patch.customer_address_id = def?.id ?? null;
      patch.delivery_address = def?.address ?? c.address ?? order.delivery_address;
      patch.contact_name = def?.receiver_name ?? c.contact_name ?? order.contact_name;
      patch.contact_phone = def?.receiver_phone ?? c.phone ?? order.contact_phone;
      patch.delivery_time_window = def?.delivery_time_window ?? c.delivery_time_window ?? order.delivery_time_window;
      patch.payment_terms = c.payment_terms ?? order.payment_terms;
      patch.tax_type = c.tax_type ?? setting.default_tax_type;
      if (!order.delivery_date && c.delivery_lead_days != null) {
        const d = new Date(order.order_date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + c.delivery_lead_days);
        patch.delivery_date = nextDeliveryDay(setting, d.toISOString().slice(0, 10));
      }
    }
    setO(patch);
    const next = await Promise.all(lines.map(async (l) => {
      if (!l.product_id || l.price_source === "manual" || l.price_source === "ai") return l;
      const r = await resolvePrice(customerId, l.product_id, l.unit);
      return { ...l, unit_price: r?.unit_price ?? null, price_source: r?.price_source ?? null };
    }));
    setLines(next);
    if (c) toast.success(`已帶入「${c.name}」的預設資料${c.delivery_note ? `（送貨注意：${c.delivery_note}）` : ""}`);
  };
  const changeAddress = (addrId: string | null) => {
    const a = addresses.find((x) => x.id === addrId);
    if (!a) { setO({ customer_address_id: null }); return; }
    setO({ customer_address_id: a.id, delivery_address: a.address, contact_name: a.receiver_name ?? order?.contact_name ?? null, contact_phone: a.receiver_phone ?? order?.contact_phone ?? null, delivery_time_window: a.delivery_time_window ?? order?.delivery_time_window ?? null });
  };

  const save = async (silent = false): Promise<boolean> => {
    if (!order) return false;
    setBusy(true);
    try {
      const { error } = await supabase.from("eip_sales_order").update({
        customer_id: order.customer_id, customer_address_id: order.customer_address_id, contact_name: order.contact_name, contact_phone: order.contact_phone,
        order_date: order.order_date, delivery_date: order.delivery_date || null, delivery_address: order.delivery_address,
        delivery_time_window: order.delivery_time_window, payment_terms: order.payment_terms, tax_type: order.tax_type,
        note: order.note, erp_order_no: order.erp_order_no,
      }).eq("id", order.id);
      if (error) throw error;
      const { error: de } = await supabase.from("eip_sales_order_line").delete().eq("order_id", order.id);
      if (de) throw de;
      if (lines.length) {
        const rows = lines.map((l, i) => ({
          tenant_id: DEFAULT_TENANT_ID, order_id: order.id, line_no: i + 1,
          product_id: l.product_id, product_text: l.product_text, spec: l.spec, qty: l.qty, unit: l.unit,
          unit_price: l.unit_price, price_source: l.unit_price === null ? null : l.price_source,
          note: l.note, needs_review: !l.product_id || !(l.qty && l.qty > 0),
        }));
        const { error: ie } = await supabase.from("eip_sales_order_line").insert(rows);
        if (ie) throw ie;
      }
      if (!silent) toast.success("已儲存");
      await load();
      return true;
    } catch (e) {
      toast.error(humanizeError(e, "儲存訂單"));
      return false;
    } finally { setBusy(false); }
  };

  // 已確認訂單只更新凌越單號，不動單身
  const saveErp = async () => {
    if (!order) return;
    setBusy(true);
    const { error } = await supabase.from("eip_sales_order").update({ erp_order_no: order.erp_order_no || null }).eq("id", order.id);
    setBusy(false);
    if (error) { toast.error(humanizeError(error, "儲存凌越單號")); return; }
    toast.success("已儲存凌越單號");
    await load();
  };

  const setStatus = async (status: Status, extra: Record<string, unknown> = {}) => {
    if (!order) return;
    if (status === "confirmed") {
      if (!order.customer_id) { toast.error("請先選擇客戶（主檔）再確認"); return; }
      if (!lines.length) { toast.error("訂單沒有任何品項"); return; }
      const bad = lines.filter((l) => !l.product_id || !(l.qty && l.qty > 0)).length;
      if (bad) { toast.error(`有 ${bad} 項還沒對應品項主檔或沒有數量`); return; }
      if (!order.delivery_date) { toast.error("請填寫交貨日期再確認"); return; }
      if (isNoDeliveryDay(setting, order.delivery_date) && !window.confirm(`交貨日 ${order.delivery_date}（週${weekdayOf(order.delivery_date)}）是不送貨日，仍要確認嗎？`)) return;
      const missing = lines.filter((l) => l.unit_price === null).length;
      if (missing && !window.confirm(`有 ${missing} 項沒有單價，仍要確認嗎？`)) return;
    }
    if (status === "confirmed" || status === "pending_review") { if (!(await save(true))) return; }
    setBusy(true);
    const { error } = await supabase.from("eip_sales_order").update({ status, ...extra }).eq("id", order.id);
    setBusy(false);
    if (error) { toast.error(humanizeError(error, "更新訂單狀態")); return; }
    toast.success(status === "confirmed" ? "訂單已確認，已記住客戶說法與成交價" : status === "cancelled" ? "訂單已取消" : "已更新");
    await load();
  };

  const addCustomerFromText = async (text?: string) => {
    const name = (text ?? order?.customer_text ?? "").trim();
    if (!order || !name) return;
    const { data, error } = await supabase.from("eip_customer").insert({ tenant_id: DEFAULT_TENANT_ID, name, address: order.delivery_address })
      .select("id,code,name,short_name,address,is_active,aliases,contact_name,phone,payment_terms,tax_type,delivery_time_window,delivery_lead_days,delivery_note").maybeSingle();
    if (error || !data) { toast.error(error ? humanizeError(error, "新增客戶") : "新增客戶失敗：沒有權限"); return; }
    setCustomers((cs) => [...cs, data as Customer].sort((a, b) => a.name.localeCompare(b.name)));
    setO({ customer_id: data.id });
    toast.success(`已新增客戶「${name}」到主檔（代號、付款條件請到主檔頁補上）`);
  };
  const addProductFromText = async (i: number, text?: string) => {
    const l = lines[i];
    const name = (text ?? l.product_text ?? "").trim();
    if (!name) return;
    const { data, error } = await supabase.from("eip_product").insert({ tenant_id: DEFAULT_TENANT_ID, name, spec: l.spec, unit: l.unit, unit_price: l.unit_price })
      .select("id,code,name,spec,unit,unit_price,is_active,aliases").maybeSingle();
    if (error || !data) { toast.error(error ? humanizeError(error, "新增品項") : "新增品項失敗：沒有權限"); return; }
    setProducts((ps) => [...ps, data as Product].sort((a, b) => a.name.localeCompare(b.name)));
    setL(i, { product_id: data.id });
    toast.success(`已新增品項「${name}」到主檔（品號、牌價請到主檔頁補上）`);
  };

  const openAttachment = async (path: string) => {
    const { data, error } = await supabase.storage.from("sales-order").createSignedUrl(path, 300);
    if (error) { toast.error(humanizeError(error, "開啟附件")); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  // 關閉：有未儲存的修改先確認；手動新增後什麼都沒填就關掉，作廢這張空單，不留在待覆核
  const requestClose = async () => {
    const dirty = !!order && snapshotOf(order, lines) !== snap.current;
    if (editable && dirty && !window.confirm("有尚未儲存的修改，確定要關閉嗎？（修改會遺失）")) return;
    if (order && blankOnLoad.current && order.status === "pending_review") {
      await supabase.from("eip_sales_order").update({ deleted_at: new Date().toISOString(), cancelled_reason: "手動新增後未填寫，自動作廢" }).eq("id", order.id);
    }
    onClose();
  };

  if (!order) {
    return <Dialog open onOpenChange={(v) => !v && onClose()}><DialogContent><div className="py-8 text-center text-muted-foreground">載入中…</div></DialogContent></Dialog>;
  }

  const cust = order.customer_id ? custMap.get(order.customer_id) : undefined;
  const sel = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60";
  const taxType = order.tax_type ?? setting.default_tax_type;
  return (
    <Dialog open onOpenChange={(v) => { if (!v) void requestClose(); }}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            訂單 <span className="font-mono">{order.order_no}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${STATUS_META[order.status].cls}`}>{STATUS_META[order.status].label}</span>
            {order.source === "line" && <Badge variant="secondary">LINE</Badge>}
          </DialogTitle>
        </DialogHeader>

        {order.ai_issues?.length > 0 && order.status !== "confirmed" && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
            <div className="flex items-center gap-1.5 font-medium text-amber-900"><AlertTriangle className="h-4 w-4" />AI 標示待確認</div>
            <ul className="list-disc pl-5 mt-1 text-amber-900 space-y-0.5">{order.ai_issues.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
        )}
        {cust?.delivery_note && order.status !== "cancelled" && (
          <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">送貨注意事項：{cust.delivery_note}</div>
        )}

        <div className="grid md:grid-cols-4 gap-3">
          <div className="md:col-span-2 space-y-1.5">
            <Label>客戶（主檔）</Label>
            <SearchSelect value={order.customer_id} options={custOpts} disabled={!editable} placeholder="— 尚未對應 —"
              onChange={(v) => void changeCustomer(v)} onCreate={editable ? (t) => void addCustomerFromText(t) : undefined} createLabel="新增客戶" />
            {order.customer_text && (
              <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-2">
                原始說法：「{order.customer_text}」
                {editable && !order.customer_id && (
                  <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => void addCustomerFromText()}><UserPlus className="h-3 w-3 mr-1" />以此名稱新增客戶</Button>
                )}
              </div>
            )}
          </div>
          <div className="space-y-1.5"><Label>訂單日期</Label><Input type="date" disabled={!editable} value={order.order_date ?? ""} onChange={(e) => setO({ order_date: e.target.value })} /></div>
          <div className="space-y-1.5">
            <Label>交貨日期{order.delivery_date && <span className="ml-1 font-normal text-muted-foreground">（週{weekdayOf(order.delivery_date)}）</span>}</Label>
            <Input type="date" disabled={!editable} value={order.delivery_date ?? ""} onChange={(e) => setO({ delivery_date: e.target.value || null })} />
            {isNoDeliveryDay(setting, order.delivery_date) && order.status !== "confirmed" && order.status !== "cancelled" && (
              <div className="text-xs text-amber-700 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />不送貨日（可在「訂單設定」調整）</div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>送貨地點</Label>
            <select className={sel} disabled={!editable || addresses.length === 0} value={order.customer_address_id ?? ""} onChange={(e) => changeAddress(e.target.value || null)}>
              <option value="">{addresses.length ? "— 自訂地址 —" : "（客戶未設分店）"}</option>
              {addresses.filter((a) => a.is_active || a.id === order.customer_address_id).map((a) => <option key={a.id} value={a.id}>{a.label}{a.is_default ? "（預設）" : ""}</option>)}
            </select>
          </div>
          <div className="md:col-span-3 space-y-1.5"><Label>交貨地址</Label><Input disabled={!editable} value={order.delivery_address ?? ""} onChange={(e) => setO({ delivery_address: e.target.value, customer_address_id: null })} /></div>
          <div className="space-y-1.5"><Label>聯絡人／收貨人</Label><Input disabled={!editable} value={order.contact_name ?? ""} onChange={(e) => setO({ contact_name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>聯絡電話</Label><Input disabled={!editable} value={order.contact_phone ?? ""} onChange={(e) => setO({ contact_phone: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>收貨時段</Label><Input disabled={!editable} value={order.delivery_time_window ?? ""} onChange={(e) => setO({ delivery_time_window: e.target.value })} /></div>
          <div className="space-y-1.5">
            <Label>付款條件</Label>
            <Input disabled={!editable} list="so-payment-terms" value={order.payment_terms ?? ""} onChange={(e) => setO({ payment_terms: e.target.value })} />
            <datalist id="so-payment-terms">{PAYMENT_TERMS_PRESETS.map((p) => <option key={p} value={p} />)}</datalist>
          </div>
          <div className="space-y-1.5">
            <Label>稅別</Label>
            <select className={sel} disabled={!editable} value={taxType} onChange={(e) => setO({ tax_type: e.target.value as TaxType })}>
              {(Object.keys(TAX_TYPE_LABEL) as TaxType[]).map((t) => <option key={t} value={t}>{TAX_TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          <div className="space-y-1.5"><Label>凌越單號（之後同步用）</Label><Input disabled={order.status === "cancelled" || !canEdit} value={order.erp_order_no ?? ""} onChange={(e) => setO({ erp_order_no: e.target.value })} /></div>
          <div className="md:col-span-2 space-y-1.5"><Label>備註</Label><Textarea rows={1} disabled={!editable} value={order.note ?? ""} onChange={(e) => setO({ note: e.target.value })} /></div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-base">品項明細</Label>
            {editable && <Button size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, { line_no: ls.length + 1, product_id: null, product_text: null, spec: null, qty: null, unit: null, unit_price: null, note: null, needs_review: true, price_source: null }])}><Plus className="h-3.5 w-3.5 mr-1" />加一項</Button>}
          </div>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead><TableHead className="min-w-[240px]">品項（主檔）</TableHead><TableHead className="min-w-[110px]">規格</TableHead>
                  <TableHead className="min-w-[88px]">數量</TableHead><TableHead className="min-w-[80px]">單位</TableHead><TableHead className="min-w-[150px]">單價</TableHead>
                  <TableHead className="min-w-[96px] text-right">金額</TableHead><TableHead className="min-w-[120px]">備註</TableHead><TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground text-sm">沒有品項</TableCell></TableRow>}
                {lines.map((l, i) => {
                  const bad = !l.product_id || !(l.qty && l.qty > 0);
                  const p = l.product_id ? prodMap.get(l.product_id) : undefined;
                  const units = p ? [p.unit, ...(p.eip_product_unit ?? []).map((u) => u.unit)].filter(Boolean) as string[] : [];
                  const ps = l.price_source ? PRICE_SOURCE_LABEL[l.price_source] : null;
                  return (
                    <TableRow key={i} className={bad && editable ? "bg-amber-50/60" : ""}>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell>
                        <SearchSelect value={l.product_id} options={prodOpts} disabled={!editable} placeholder="— 尚未對應 —"
                          onCreate={editable ? (t) => void addProductFromText(i, t) : undefined} createLabel="新增品項"
                          onChange={(v) => {
                            const np = v ? prodMap.get(v) : undefined;
                            const unit = (v ? usual.get(v)?.usual_unit : null) ?? np?.unit ?? null;
                            setL(i, { product_id: v, unit, spec: l.spec || np?.spec || null, unit_price: null, price_source: null });
                            if (v) void repriceLine(i, v, unit);
                          }} />
                        {l.product_text && (
                          <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                            原始：「{l.product_text}」
                            {editable && !l.product_id && <button className="underline text-primary inline-flex items-center" onClick={() => void addProductFromText(i)}><PackagePlus className="h-3 w-3 mr-0.5" />新增為品項</button>}
                          </div>
                        )}
                      </TableCell>
                      <TableCell><Input disabled={!editable} value={l.spec ?? ""} onChange={(e) => setL(i, { spec: e.target.value })} /></TableCell>
                      <TableCell>
                        <NumberInput disabled={!editable} value={l.qty} onValueChange={(v) => setL(i, { qty: v })} />
                        {qtyHint(l) && <div className="text-[11px] text-amber-700 mt-0.5 whitespace-nowrap">⚠ {qtyHint(l)}</div>}
                      </TableCell>
                      <TableCell>
                        <Input disabled={!editable} list={`so-units-${i}`} value={l.unit ?? ""}
                          onChange={(e) => setL(i, { unit: e.target.value })}
                          onBlur={(e) => { if (l.product_id && l.price_source !== "manual" && l.price_source !== "ai") void repriceLine(i, l.product_id, e.target.value || null); }} />
                        <datalist id={`so-units-${i}`}>{units.map((u) => <option key={u} value={u} />)}</datalist>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <NumberInput disabled={!editable} value={l.unit_price} onValueChange={(v) => setL(i, { unit_price: v, price_source: "manual" })} />
                          {ps && <span title={ps.tip} className={`shrink-0 text-[10px] px-1 py-0.5 rounded ${ps.cls}`}>{ps.label}</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{l.qty && l.unit_price != null ? money(Math.round(l.qty * l.unit_price * 100) / 100) : ""}</TableCell>
                      <TableCell><Input disabled={!editable} value={l.note ?? ""} onChange={(e) => setL(i, { note: e.target.value })} /></TableCell>
                      <TableCell>{editable && <Button size="icon" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm">
            {taxType === "inclusive" ? <>
              <span>未稅 {money(totals.subtotal)}</span><span>稅額 {money(totals.tax)}</span><span className="font-semibold">總計（含稅）{money(totals.total)}</span>
            </> : <>
              <span>小計（{TAX_TYPE_SHORT[taxType]}）{money(totals.subtotal)}</span><span>稅額 {money(totals.tax)}</span><span className="font-semibold">總計 {money(totals.total)}</span>
            </>}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div className="rounded-md border p-3 text-sm space-y-1.5">
            <div className="flex items-center gap-1.5 font-medium"><MessageSquareText className="h-4 w-4" />原始內容</div>
            <pre className="whitespace-pre-wrap text-xs text-muted-foreground max-h-48 overflow-y-auto font-sans">{order.raw_text || "（網頁手動建立）"}</pre>
            {order.attachments?.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {order.attachments.map((a) => (
                  <Button key={a.path} size="sm" variant="outline" className="h-7 text-xs" onClick={() => openAttachment(a.path)}><Paperclip className="h-3 w-3 mr-1" />{a.name}</Button>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-md border p-3 text-sm space-y-1">
            <div className="flex items-center gap-1.5 font-medium"><History className="h-4 w-4" />處理紀錄</div>
            <div className="text-xs text-muted-foreground space-y-0.5 max-h-48 overflow-y-auto">
              <div>建立：{userName.get(order.created_by ?? "") ?? "—"}｜{fmtDT(order.created_at)}</div>
              {order.owner_confirmed_at && <div>送出覆核：{fmtDT(order.owner_confirmed_at)}</div>}
              {order.reviewed_at && <div>確認：{userName.get(order.reviewed_by ?? "") ?? "—"}｜{fmtDT(order.reviewed_at)}</div>}
              {order.cancelled_reason && <div>取消原因：{order.cancelled_reason}</div>}
              {logs.map((g) => (
                <div key={g.id}>{fmtDT(g.created_at)}｜{userName.get(g.actor_id) ?? "系統"}｜{g.action === "status" ? `狀態 ${STATUS_META[g.detail?.from as Status]?.label ?? g.detail?.from} → ${STATUS_META[g.detail?.to as Status]?.label ?? g.detail?.to}` : g.action === "created" ? "建立" : g.action === "edited" ? "修改" : g.action}</div>
              ))}
            </div>
          </div>
        </div>

        {askCancel && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 space-y-2">
            <Label>取消原因</Label>
            <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="例：客戶取消、重複下單" />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAskCancel(false)}>返回</Button>
              <Button variant="destructive" disabled={busy || !cancelReason.trim()} onClick={() => setStatus("cancelled", { cancelled_reason: cancelReason.trim() })}>確定取消訂單</Button>
            </div>
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          {editable && !askCancel && <Button variant="outline" className="text-rose-700" onClick={() => setAskCancel(true)}><XCircle className="h-4 w-4 mr-1.5" />取消訂單</Button>}
          {canEdit && order.status === "confirmed" && <Button variant="outline" disabled={busy} onClick={() => setStatus("pending_review")}><RotateCcw className="h-4 w-4 mr-1.5" />退回待覆核</Button>}
          {canEdit && order.status === "confirmed" && <Button variant="outline" disabled={busy} onClick={saveErp}><Save className="h-4 w-4 mr-1.5" />儲存凌越單號</Button>}
          {editable && <Button variant="outline" disabled={busy} onClick={() => save()}><Save className="h-4 w-4 mr-1.5" />儲存</Button>}
          {editable && order.status === "draft" && <Button variant="secondary" disabled={busy} onClick={() => setStatus("pending_review")}>代老闆送出覆核</Button>}
          {editable && canEdit && order.status === "pending_review" && (
            <Button disabled={busy} onClick={() => setStatus("confirmed")}><CheckCircle2 className="h-4 w-4 mr-1.5" />覆核確認</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
