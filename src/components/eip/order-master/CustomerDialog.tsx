import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Save, Trash2, Star, ArrowUpCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { DEFAULT_TENANT_ID } from "@/lib/eip-constants";
import { humanizeError } from "@/lib/eip-error";
import { useActiveUsers } from "@/hooks/useUsers";
import { CUSTOMER_TYPE_PRESETS, PAYMENT_TERMS_PRESETS, TAX_TYPE_LABEL, money, splitList, type TaxType } from "@/lib/sales-order";
import { SearchSelect } from "@/components/eip/SearchSelect";
import { NumberInput } from "@/components/eip/NumberInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type CustomerRow = Record<string, any> & { id: string; name: string; is_active: boolean };

const FIELD_GROUPS: { title: string; fields: { key: string; label: string; type?: "text" | "number" | "list" | "textarea" | "tax" | "user" | "preset"; presets?: string[]; wide?: boolean; required?: boolean; hint?: string }[] }[] = [
  { title: "基本資料", fields: [
    { key: "code", label: "客戶代號", hint: "建議與凌越客戶代號一致" },
    { key: "name", label: "客戶名稱（全名）", required: true, wide: true },
    { key: "short_name", label: "簡稱" },
    { key: "customer_type", label: "客戶類別", type: "preset", presets: CUSTOMER_TYPE_PRESETS },
    { key: "region", label: "區域" },
    { key: "sales_owner_id", label: "負責業務", type: "user" },
    { key: "aliases", label: "別名（老闆常用講法，逗號分隔）", type: "list", wide: true },
  ] },
  { title: "發票", fields: [
    { key: "tax_id", label: "統一編號" },
    { key: "invoice_title", label: "發票抬頭", wide: true },
    { key: "invoice_address", label: "發票／帳單地址", wide: true },
  ] },
  { title: "聯絡", fields: [
    { key: "contact_name", label: "聯絡人" },
    { key: "phone", label: "電話" },
    { key: "fax", label: "傳真" },
    { key: "email", label: "Email" },
  ] },
  { title: "交易條件（下單時自動帶入）", fields: [
    { key: "payment_terms", label: "付款條件", type: "preset", presets: PAYMENT_TERMS_PRESETS },
    { key: "tax_type", label: "稅別", type: "tax" },
    { key: "credit_limit", label: "信用額度", type: "number" },
    { key: "delivery_lead_days", label: "預設交期（下單後幾天）", type: "number", hint: "老闆沒講交期時自動帶入" },
  ] },
  { title: "送貨（下單時自動帶入）", fields: [
    { key: "address", label: "主要送貨地址", wide: true, hint: "沒有設定分店地址時使用" },
    { key: "delivery_time_window", label: "收貨時段" },
    { key: "delivery_route", label: "配送路線" },
    { key: "delivery_note", label: "送貨注意事項", type: "textarea", wide: true },
    { key: "note", label: "備註", type: "textarea", wide: true },
  ] },
];

export function CustomerDialog({ row, canEdit, onClose, onSaved }: { row: CustomerRow | null; canEdit: boolean; onClose: () => void; onSaved: (id: string) => void }) {
  const [id, setId] = useState<string | null>(row?.id ?? null);
  const [tab, setTab] = useState("basic");
  const [mainAddress, setMainAddress] = useState<string | null>(row?.address ?? null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto [&>*]:min-w-0">
        <DialogHeader><DialogTitle>{row ? `客戶：${row.name}` : "新增客戶"}</DialogTitle></DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="basic">基本資料與交易條件</TabsTrigger>
            <TabsTrigger value="addr" disabled={!id}>送貨地址</TabsTrigger>
            <TabsTrigger value="price" disabled={!id}>專屬價格</TabsTrigger>
            <TabsTrigger value="orders" disabled={!id}>往來訂單</TabsTrigger>
          </TabsList>
          <TabsContent value="basic"><BasicForm row={row} canEdit={canEdit} onSaved={(nid, isNew, addr) => { setId(nid); setMainAddress(addr); onSaved(nid); if (isNew) setTab("addr"); }} /></TabsContent>
          {id && <TabsContent value="addr"><AddressTab customerId={id} canEdit={canEdit} mainAddress={mainAddress} /></TabsContent>}
          {id && <TabsContent value="price"><PriceTab customerId={id} canEdit={canEdit} /></TabsContent>}
          {id && <TabsContent value="orders"><OrdersTab customerId={id} /></TabsContent>}
        </Tabs>
        <DialogFooter><Button variant="outline" onClick={onClose}>關閉</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BasicForm({ row, canEdit, onSaved }: { row: CustomerRow | null; canEdit: boolean; onSaved: (id: string, isNew: boolean, address: string | null) => void }) {
  const { data: users = [] } = useActiveUsers();
  const [form, setForm] = useState<Record<string, any>>(() => ({ ...(row ?? {}), aliases: (row?.aliases ?? []).join(", ") }));
  const [active, setActive] = useState(row?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [rowId, setRowId] = useState(row?.id ?? null);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const rec: Record<string, unknown> = { is_active: active };
    for (const g of FIELD_GROUPS) for (const f of g.fields) {
      const v = form[f.key];
      if (f.type === "list") rec[f.key] = splitList(v);
      else if (f.type === "number") {
        const s = String(v ?? "").replace(/,/g, "").trim();
        if (s && Number.isNaN(Number(s))) { toast.error(`${f.label}必須是數字`); return; }
        rec[f.key] = s ? Number(s) : null;
      } else rec[f.key] = (typeof v === "string" ? v.trim() : v) || null;
    }
    if (!rec.name) { toast.error("請填寫客戶名稱"); return; }
    if (rec.tax_id && !/^\d{8}$/.test(String(rec.tax_id))) { toast.error("統一編號應為 8 碼數字"); return; }
    if (rec.delivery_lead_days !== null && rec.delivery_lead_days !== undefined && (Number(rec.delivery_lead_days) < 0 || Number(rec.delivery_lead_days) > 60)) { toast.error("預設交期請填 0～60 天"); return; }
    setSaving(true);
    const res = rowId
      ? await supabase.from("eip_customer").update(rec).eq("id", rowId).select("id").maybeSingle()
      : await supabase.from("eip_customer").insert({ ...rec, tenant_id: DEFAULT_TENANT_ID }).select("id").maybeSingle();
    setSaving(false);
    if (res.error || !res.data) { toast.error(res.error ? humanizeError(res.error, "儲存客戶") : "儲存失敗：沒有權限"); return; }
    toast.success(rowId ? "已儲存客戶資料" : "已新增客戶，可以接著設定送貨地址與專屬價格");
    const isNew = !rowId;
    setRowId(res.data.id);
    onSaved(res.data.id, isNew, (rec.address as string | null) ?? null);
  };

  return (
    <div className="space-y-4 pt-2">
      {FIELD_GROUPS.map((g) => (
        <div key={g.title} className="rounded-md border p-3">
          <div className="text-sm font-medium mb-2">{g.title}</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {g.fields.map((f) => (
              <div key={f.key} className={f.wide ? "col-span-2 space-y-1" : "space-y-1"}>
                <Label className="text-xs">{f.label}{f.required && <span className="text-destructive"> *</span>}</Label>
                {f.type === "textarea" ? (
                  <Textarea rows={2} disabled={!canEdit} value={form[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
                ) : f.type === "tax" ? (
                  <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" disabled={!canEdit} value={form.tax_type ?? ""} onChange={(e) => set("tax_type", e.target.value || null)}>
                    <option value="">依系統預設</option>
                    {(Object.keys(TAX_TYPE_LABEL) as TaxType[]).map((t) => <option key={t} value={t}>{TAX_TYPE_LABEL[t]}</option>)}
                  </select>
                ) : f.type === "user" ? (
                  <SearchSelect value={form.sales_owner_id} disabled={!canEdit} placeholder="未指定"
                    options={(users as any[]).map((u) => ({ value: u.id, label: u.name, hint: u.employee_no }))}
                    onChange={(v) => set("sales_owner_id", v)} />
                ) : (
                  <>
                    <Input disabled={!canEdit} list={f.type === "preset" ? `dl-${f.key}` : undefined} inputMode={f.type === "number" ? "decimal" : undefined}
                      value={form[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
                    {f.type === "preset" && <datalist id={`dl-${f.key}`}>{f.presets!.map((p) => <option key={p} value={p} />)}</datalist>}
                  </>
                )}
                {f.hint && <p className="text-[11px] text-muted-foreground">{f.hint}</p>}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm"><Switch checked={active} disabled={!canEdit} onCheckedChange={setActive} />啟用（停用後 LINE 訂單不會再比對到）</label>
        {canEdit && <Button onClick={save} disabled={saving}><Save className="h-4 w-4 mr-1.5" />{saving ? "儲存中…" : "儲存"}</Button>}
      </div>
    </div>
  );
}

type Addr = { id?: string; label: string; address: string; receiver_name: string | null; receiver_phone: string | null; delivery_time_window: string | null; note: string | null; is_default: boolean; is_active: boolean };

function AddressTab({ customerId, canEdit, mainAddress }: { customerId: string; canEdit: boolean; mainAddress: string | null }) {
  const [rows, setRows] = useState<Addr[]>([]);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const load = async () => {
    const { data, error } = await supabase.from("eip_customer_address").select("*").eq("customer_id", customerId).order("is_default", { ascending: false }).order("label");
    if (error) { toast.error(humanizeError(error, "讀取地址")); return; }
    const list = (data ?? []) as Addr[];
    setRows(list);
    setSaved(Object.fromEntries(list.map((r) => [r.id!, JSON.stringify(r)])));
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [customerId]);
  const setR = (i: number, p: Partial<Addr>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const isDirty = (r: Addr) => !r.id || saved[r.id] !== JSON.stringify(r);

  const saveRow = async (i: number) => {
    const r = rows[i];
    if (!r.label.trim() || !r.address.trim()) { toast.error("地點名稱與地址都要填"); return; }
    if (rows.some((x, j) => j !== i && x.label.trim() === r.label.trim())) { toast.error(`地點名稱「${r.label.trim()}」重複了`); return; }
    const rec = { tenant_id: DEFAULT_TENANT_ID, customer_id: customerId, label: r.label.trim(), address: r.address.trim(), receiver_name: r.receiver_name?.trim() || null, receiver_phone: r.receiver_phone?.trim() || null, delivery_time_window: r.delivery_time_window?.trim() || null, note: r.note?.trim() || null, is_default: r.is_default, is_active: r.is_active };
    const { error } = r.id ? await supabase.from("eip_customer_address").update(rec).eq("id", r.id) : await supabase.from("eip_customer_address").insert(rec);
    if (error) { toast.error(humanizeError(error, "儲存地址")); return; }
    toast.success("已儲存地址"); void load();
  };
  // 預設地址：已存檔的直接更新（一次只會有一個預設），再按一次取消預設 → 沒指定分店時改用主要送貨地址
  const toggleDefault = async (i: number) => {
    const r = rows[i];
    const next = !r.is_default;
    if (!r.id) { setRows((rs) => rs.map((x, j) => ({ ...x, is_default: j === i ? next : next ? false : x.is_default }))); return; }
    const { error } = await supabase.from("eip_customer_address").update({ is_default: next }).eq("id", r.id);
    if (error) { toast.error(humanizeError(error, "設定預設地址")); return; }
    toast.success(next ? `已設「${r.label}」為預設送貨地點` : "已取消預設，沒指定分店時用主要送貨地址");
    void load();
  };
  const del = async (i: number) => {
    const r = rows[i];
    if (!r.id) { setRows((rs) => rs.filter((_, j) => j !== i)); return; }
    if (!window.confirm(`確定刪除送貨地點「${r.label}」？（已建立的訂單不受影響）`)) return;
    const { error } = await supabase.from("eip_customer_address").delete().eq("id", r.id);
    if (error) { toast.error(humanizeError(error, "刪除地址")); return; }
    void load();
  };
  const defaultRow = rows.find((r) => r.is_default && r.is_active);

  return (
    <div className="space-y-3 pt-2">
      <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground space-y-0.5">
        <div>分店／多個卸貨點。老闆在 LINE 說「送內湖店」就會帶入該地點的地址、收貨人與收貨時段。</div>
        <div>沒指定地點時：{defaultRow ? <>用預設地點 <b className="text-foreground">{defaultRow.label}</b></> : mainAddress ? <>用主要送貨地址 <b className="text-foreground">{mainAddress}</b></> : <span className="text-amber-700">沒有主要送貨地址，也沒有預設地點，訂單會帶不出地址</span>}</div>
      </div>
      {rows.length === 0 && <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">尚未設定分店地址（會使用基本資料的主要送貨地址）</div>}
      {rows.map((r, i) => (
        <div key={r.id ?? `n${i}`} className={`rounded-md border p-3 space-y-2 ${r.is_active ? "" : "opacity-60"} ${r.is_default ? "border-amber-300 bg-amber-50/40" : ""}`}>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={!canEdit} onClick={() => void toggleDefault(i)} title={r.is_default ? "取消預設" : "設為預設"} className="inline-flex items-center gap-1 text-xs rounded px-1.5 py-1 hover:bg-muted disabled:opacity-60">
              <Star className={`h-4 w-4 ${r.is_default ? "fill-amber-400 text-amber-500" : "text-muted-foreground"}`} />{r.is_default ? "預設" : "設為預設"}
            </button>
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Switch disabled={!canEdit} checked={r.is_active} onCheckedChange={(v) => setR(i, { is_active: v })} />啟用</label>
            <div className="ml-auto flex items-center gap-1">
              {canEdit && isDirty(r) && <span className="text-[11px] text-amber-700">尚未儲存</span>}
              {canEdit && <Button size="sm" variant={isDirty(r) ? "default" : "outline"} onClick={() => saveRow(i)}><Save className="h-3.5 w-3.5 mr-1" />儲存</Button>}
              {canEdit && <Button size="icon" variant="ghost" onClick={() => del(i)} title="刪除"><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            <div className="col-span-2 space-y-1"><Label className="text-xs">地點名稱 *（例：內湖店）</Label><Input disabled={!canEdit} value={r.label} onChange={(e) => setR(i, { label: e.target.value })} /></div>
            <div className="col-span-2 sm:col-span-4 space-y-1"><Label className="text-xs">地址 *</Label><Input disabled={!canEdit} value={r.address} onChange={(e) => setR(i, { address: e.target.value })} /></div>
            <div className="col-span-1 sm:col-span-2 space-y-1"><Label className="text-xs">收貨人</Label><Input disabled={!canEdit} value={r.receiver_name ?? ""} onChange={(e) => setR(i, { receiver_name: e.target.value })} /></div>
            <div className="col-span-1 sm:col-span-2 space-y-1"><Label className="text-xs">收貨電話</Label><Input disabled={!canEdit} value={r.receiver_phone ?? ""} onChange={(e) => setR(i, { receiver_phone: e.target.value })} /></div>
            <div className="col-span-2 sm:col-span-2 space-y-1"><Label className="text-xs">收貨時段</Label><Input disabled={!canEdit} placeholder="例：08:00-12:00" value={r.delivery_time_window ?? ""} onChange={(e) => setR(i, { delivery_time_window: e.target.value })} /></div>
            <div className="col-span-2 sm:col-span-6 space-y-1"><Label className="text-xs">備註</Label><Input disabled={!canEdit} value={r.note ?? ""} onChange={(e) => setR(i, { note: e.target.value })} /></div>
          </div>
        </div>
      ))}
      {canEdit && <Button size="sm" variant="outline" onClick={() => setRows((rs) => [...rs, { label: "", address: "", receiver_name: null, receiver_phone: null, delivery_time_window: null, note: null, is_default: rs.length === 0 && !mainAddress, is_active: true }])}><Plus className="h-3.5 w-3.5 mr-1" />新增地址</Button>}
    </div>
  );
}

type Price = { id?: string; product_id: string | null; unit: string | null; unit_price: number | null; source: "contract" | "last_order"; valid_from: string | null; valid_to: string | null; note: string | null; updated_at?: string; eip_product?: { name: string; code: string | null; unit: string | null } | null };

export function PriceTab({ customerId, productId, canEdit }: { customerId?: string; productId?: string; canEdit: boolean }) {
  const [rows, setRows] = useState<Price[]>([]);
  const [products, setProducts] = useState<{ id: string; code: string | null; name: string; unit: string | null; aliases: string[] | null }[]>([]);
  const [customers, setCustomers] = useState<{ id: string; code: string | null; name: string }[]>([]);
  const load = async () => {
    let q = supabase.from("eip_customer_price").select("*, eip_product(name,code,unit), eip_customer(name,code)");
    q = customerId ? q.eq("customer_id", customerId) : q.eq("product_id", productId);
    const { data, error } = await q.order("source").order("updated_at", { ascending: false });
    if (error) { toast.error(humanizeError(error, "讀取價格")); return; }
    setRows((data ?? []) as Price[]);
  };
  useEffect(() => {
    void load();
    if (customerId) void supabase.from("eip_product").select("id,code,name,unit,aliases").eq("is_active", true).order("name").limit(3000).then(({ data }) => setProducts((data ?? []) as any));
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [customerId, productId]);
  useEffect(() => { if (productId) void supabase.from("eip_customer").select("id,code,name").order("name").limit(3000).then(({ data }) => setCustomers((data ?? []) as any)); }, [productId]);
  const setR = (i: number, p: Partial<Price>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const contract = rows.map((r, i) => ({ r, i })).filter((x) => x.r.source === "contract");
  const learned = rows.filter((r) => r.source === "last_order");
  const prodOpts = useMemo(() => products.map((p) => ({ value: p.id, label: `${p.code ? p.code + "｜" : ""}${p.name}`, keywords: p.aliases ?? [] })), [products]);

  const saveRow = async (i: number) => {
    const r = rows[i];
    if (!r.product_id || r.unit_price === null || r.unit_price === undefined || Number.isNaN(Number(r.unit_price))) { toast.error("請選品項並填單價"); return; }
    if (r.valid_from && r.valid_to && r.valid_from > r.valid_to) { toast.error("到期日不能早於生效日"); return; }
    const rec = { tenant_id: DEFAULT_TENANT_ID, customer_id: customerId, product_id: r.product_id, unit: r.unit || null, unit_price: Number(r.unit_price), source: "contract", valid_from: r.valid_from || null, valid_to: r.valid_to || null, note: r.note || null };
    const { error } = r.id ? await supabase.from("eip_customer_price").update(rec).eq("id", r.id) : await supabase.from("eip_customer_price").insert(rec);
    if (error) { toast.error(humanizeError(error, "儲存價格")); return; }
    toast.success("已儲存專屬價"); void load();
  };
  const del = async (i: number) => {
    const r = rows[i];
    if (!r.id) { setRows((rs) => rs.filter((_, j) => j !== i)); return; }
    const { error } = await supabase.from("eip_customer_price").delete().eq("id", r.id);
    if (error) { toast.error(humanizeError(error, "刪除價格")); return; }
    void load();
  };
  const promote = async (r: Price) => {
    const { error } = await supabase.from("eip_customer_price").insert({ tenant_id: DEFAULT_TENANT_ID, customer_id: customerId, product_id: r.product_id, unit: r.unit, unit_price: r.unit_price, source: "contract", note: "由最近成交價轉入" });
    if (error) { toast.error(humanizeError(error, "轉為專屬價")); return; }
    toast.success("已轉為專屬價"); void load();
  };

  if (productId) {
    // 品項視角：唯讀列出各客戶價格
    return (
      <div className="pt-2 overflow-x-auto rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>客戶</TableHead><TableHead>單位</TableHead><TableHead className="text-right">單價</TableHead><TableHead>來源</TableHead><TableHead>有效期間</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">尚無客戶專屬價或成交紀錄</TableCell></TableRow>}
            {rows.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell>{r.eip_customer?.name ?? customers.find((c) => c.id === r.customer_id)?.name}</TableCell>
                <TableCell>{r.unit ?? "主單位"}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.unit_price)}</TableCell>
                <TableCell><Badge variant="outline">{r.source === "contract" ? "專屬價" : "最近成交"}</Badge></TableCell>
                <TableCell className="text-xs">{r.valid_from || r.valid_to ? `${r.valid_from ?? ""} ～ ${r.valid_to ?? ""}` : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-2">
      <p className="text-xs text-muted-foreground">帶價順序：專屬價（有效期間內）→ 最近成交價 → 品項單位價 → 品項牌價。內勤覆核確認時，系統會自動記錄「最近成交價」。</p>
      <div>
        <div className="text-sm font-medium mb-1">專屬價（合約價）</div>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="min-w-[220px]">品項</TableHead><TableHead className="min-w-[80px]">單位</TableHead><TableHead className="min-w-[110px]">單價</TableHead>
              <TableHead className="min-w-[150px]">生效日</TableHead><TableHead className="min-w-[150px]">到期日</TableHead><TableHead className="min-w-[120px]">備註</TableHead><TableHead className="w-20" />
            </TableRow></TableHeader>
            <TableBody>
              {contract.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground">尚無專屬價（沿用最近成交價或牌價）</TableCell></TableRow>}
              {contract.map(({ r, i }) => (
                <TableRow key={r.id ?? `n${i}`}>
                  <TableCell><SearchSelect value={r.product_id} options={prodOpts} disabled={!canEdit || !!r.id} allowClear={false} placeholder="選擇品項" onChange={(v) => setR(i, { product_id: v })} /></TableCell>
                  <TableCell><Input disabled={!canEdit} placeholder={products.find((p) => p.id === r.product_id)?.unit ?? r.eip_product?.unit ?? "主單位"} value={r.unit ?? ""} onChange={(e) => setR(i, { unit: e.target.value || null })} /></TableCell>
                  <TableCell><NumberInput disabled={!canEdit} value={r.unit_price} onValueChange={(v) => setR(i, { unit_price: v })} /></TableCell>
                  <TableCell><Input type="date" disabled={!canEdit} value={r.valid_from ?? ""} onChange={(e) => setR(i, { valid_from: e.target.value || null })} /></TableCell>
                  <TableCell><Input type="date" disabled={!canEdit} value={r.valid_to ?? ""} onChange={(e) => setR(i, { valid_to: e.target.value || null })} /></TableCell>
                  <TableCell><Input disabled={!canEdit} value={r.note ?? ""} onChange={(e) => setR(i, { note: e.target.value })} /></TableCell>
                  <TableCell className="whitespace-nowrap">{canEdit && <>
                    <Button size="icon" variant="ghost" onClick={() => saveRow(i)}><Save className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => del(i)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                  </>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {canEdit && <Button size="sm" variant="outline" className="mt-2" onClick={() => setRows((rs) => [...rs, { product_id: null, unit: null, unit_price: null, source: "contract", valid_from: null, valid_to: null, note: null }])}><Plus className="h-3.5 w-3.5 mr-1" />新增專屬價</Button>}
      </div>
      <div>
        <div className="text-sm font-medium mb-1">最近成交價（系統自動學習）</div>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead>品項</TableHead><TableHead>單位</TableHead><TableHead className="text-right">單價</TableHead><TableHead>更新時間</TableHead><TableHead className="w-28" /></TableRow></TableHeader>
            <TableBody>
              {learned.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">尚無成交紀錄</TableCell></TableRow>}
              {learned.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.eip_product?.name}</TableCell>
                  <TableCell>{r.unit ?? r.eip_product?.unit}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.unit_price)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.updated_at ? new Date(r.updated_at).toLocaleString("zh-TW", { hour12: false }) : ""}</TableCell>
                  <TableCell>{canEdit && <Button size="sm" variant="ghost" onClick={() => promote(r)}><ArrowUpCircle className="h-3.5 w-3.5 mr-1" />轉專屬價</Button>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = { draft: "草稿", pending_review: "待覆核", confirmed: "已確認", cancelled: "已取消" };

function OrdersTab({ customerId }: { customerId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    void supabase.from("eip_sales_order").select("id,order_no,status,order_date,delivery_date,total_amount,source")
      .eq("customer_id", customerId).is("deleted_at", null).order("created_at", { ascending: false }).limit(30)
      .then(({ data }) => setRows(data ?? []));
  }, [customerId]);
  const total = rows.filter((r) => r.status === "confirmed").reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
  return (
    <div className="pt-2 space-y-2">
      <div className="text-sm text-muted-foreground">近 30 張訂單；已確認合計 <span className="font-semibold text-foreground">{money(total)}</span></div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>單號</TableHead><TableHead>訂單日</TableHead><TableHead>交貨日</TableHead><TableHead>狀態</TableHead><TableHead>來源</TableHead><TableHead className="text-right">總計</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">尚無訂單</TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.order_no}</TableCell><TableCell>{r.order_date}</TableCell><TableCell>{r.delivery_date ?? "—"}</TableCell>
                <TableCell>{STATUS_LABEL[r.status] ?? r.status}</TableCell><TableCell>{r.source === "line" ? "LINE" : "網頁"}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.total_amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
