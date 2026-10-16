import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Database, Plus, Search, Download, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2 } from "lucide-react";

// 新資料表尚未進 src/integrations/supabase/types.ts，這裡用 any 版 client。
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useAllUsers } from "@/hooks/useUsers";
import { TAX_TYPE_SHORT, money, type TaxType } from "@/lib/sales-order";
import { RequirePerm } from "@/components/RequirePerm";
import { PageHeader } from "@/components/layout/PageHeader";
import { CustomerDialog, type CustomerRow } from "@/components/eip/order-master/CustomerDialog";
import { ProductDialog, type ProductRow } from "@/components/eip/order-master/ProductDialog";
import { OrderSettingsPanel } from "@/components/eip/order-master/OrderSettingsPanel";
import { LineTestPanel } from "@/components/eip/order-master/LineTestPanel";
import { importWorkbook, downloadTemplate, kindLabel, type ImportReport } from "@/components/eip/order-master/importMaster";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/dashboard/eip/order-master")({
  component: () => (
    <RequirePerm module="eip_order_master">
      <OrderMasterPage />
    </RequirePerm>
  ),
});

type Kind = "customer" | "product" | "setting" | "line";
const isList = (k: Kind) => k === "customer" || k === "product";

function OrderMasterPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { data: users = [] } = useAllUsers();
  const userName = useMemo(() => new Map((users as any[]).map((u) => [u.id, u.name])), [users]);
  const [kind, setKind] = useState<Kind>("customer");
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<{ kind: "customer" | "product"; row: any | null } | null>(null);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 內勤（訂單接收 edit 權限）也能新增/編輯主檔，與 RLS 一致
  const canCreate = can("eip_order_master", "create") || can("eip_sales_order", "edit");
  const canEdit = can("eip_order_master", "edit") || can("eip_sales_order", "edit");
  const canExport = can("eip_order_master", "export");
  const canSetting = can("eip_order_master", "edit");

  const { data: customers = [], isLoading: lc } = useQuery({
    queryKey: ["order-master", "customer"],
    queryFn: async () => {
      const { data, error } = await supabase.from("eip_customer").select("*, eip_customer_address(id), eip_customer_price(id,source)").order("code", { ascending: true, nullsFirst: false }).order("name").limit(5000);
      if (error) throw error;
      return (data ?? []) as CustomerRow[];
    },
  });
  const { data: products = [], isLoading: lp } = useQuery({
    queryKey: ["order-master", "product"],
    queryFn: async () => {
      const { data, error } = await supabase.from("eip_product").select("*, eip_product_unit(unit,ratio)").order("code", { ascending: true, nullsFirst: false }).order("name").limit(5000);
      if (error) throw error;
      return (data ?? []) as ProductRow[];
    },
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["order-master"] });

  const match = (r: any, keys: string[]) => {
    const kw = q.trim().toLowerCase();
    return (showInactive || r.is_active) && (!kw || [...keys.map((k) => r[k]), ...(r.aliases ?? [])].some((s) => String(s ?? "").toLowerCase().includes(kw)));
  };
  const fc = useMemo(() => customers.filter((r) => match(r, ["code", "name", "short_name", "tax_id", "contact_name", "phone", "region"])), [customers, q, showInactive]); // eslint-disable-line react-hooks/exhaustive-deps
  const fp = useMemo(() => products.filter((r) => match(r, ["code", "name", "spec", "category", "barcode"])), [products, q, showInactive]); // eslint-disable-line react-hooks/exhaustive-deps

  // 完整度：缺交易條件的客戶，下單時預設值會帶不全
  const incomplete = useMemo(() => customers.filter((c) => c.is_active && (!c.payment_terms || !(c.address || c.eip_customer_address?.length))).length, [customers]);
  const noPrice = useMemo(() => products.filter((p) => p.is_active && p.unit_price == null).length, [products]);

  const onImport = async (file: File) => {
    setImporting(true);
    try {
      const rep = await importWorkbook(file, { onlyKind: kind === "product" ? "product" : "customer", users: users as any[] });
      setReport(rep);
      refresh();
    } catch (e) {
      toast.error(`匯入失敗：${(e as Error).message}`);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const exportAll = async () => {
    const wb = XLSX.utils.book_new();
    const sheet = (name: string, rows: Record<string, unknown>[]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{}]), name);
    sheet("客戶", customers.map((c) => ({
      客戶代號: c.code ?? "", 客戶名稱: c.name, 簡稱: c.short_name ?? "", 別名: (c.aliases ?? []).join(","), 統一編號: c.tax_id ?? "", 發票抬頭: c.invoice_title ?? "",
      發票地址: c.invoice_address ?? "", 聯絡人: c.contact_name ?? "", 電話: c.phone ?? "", 傳真: c.fax ?? "", Email: c.email ?? "", 送貨地址: c.address ?? "",
      付款條件: c.payment_terms ?? "", 稅別: c.tax_type ? TAX_TYPE_SHORT[c.tax_type as TaxType] : "", 客戶類別: c.customer_type ?? "", 區域: c.region ?? "",
      配送路線: c.delivery_route ?? "", 信用額度: c.credit_limit ?? "", 交期天數: c.delivery_lead_days ?? "", 收貨時段: c.delivery_time_window ?? "",
      送貨注意事項: c.delivery_note ?? "", 業務: userName.get(c.sales_owner_id) ?? "", 備註: c.note ?? "", 啟用: c.is_active ? "Y" : "N",
    })));
    const { data: addrs } = await supabase.from("eip_customer_address").select("*, eip_customer(code,name)").order("customer_id");
    sheet("送貨地址", (addrs ?? []).map((a: any) => ({ 客戶代號: a.eip_customer?.code || a.eip_customer?.name, 地點名稱: a.label, 地址: a.address, 收貨人: a.receiver_name ?? "", 收貨電話: a.receiver_phone ?? "", 收貨時段: a.delivery_time_window ?? "", 預設: a.is_default ? "Y" : "N", 備註: a.note ?? "" })));
    sheet("品項", products.map((p) => ({ 品號: p.code ?? "", 品名: p.name, 規格: p.spec ?? "", 單位: p.unit ?? "", 單價: p.unit_price ?? "", 類別: p.category ?? "", 條碼: p.barcode ?? "", 包裝: p.pack_desc ?? "", 最小訂量: p.min_order_qty ?? "", 別名: (p.aliases ?? []).join(","), 備註: p.note ?? "", 啟用: p.is_active ? "Y" : "N" })));
    const { data: units } = await supabase.from("eip_product_unit").select("*, eip_product(code,name)");
    sheet("品項單位", (units ?? []).map((u: any) => ({ 品號: u.eip_product?.code || u.eip_product?.name, 單位: u.unit, 換算率: u.ratio, 單價: u.unit_price ?? "", 條碼: u.barcode ?? "" })));
    const { data: prices } = await supabase.from("eip_customer_price").select("*, eip_customer(code,name), eip_product(code,name)").eq("source", "contract");
    sheet("客戶價格", (prices ?? []).map((p: any) => ({ 客戶代號: p.eip_customer?.code || p.eip_customer?.name, 品號: p.eip_product?.code || p.eip_product?.name, 單位: p.unit ?? "", 單價: p.unit_price, 生效日: p.valid_from ?? "", 到期日: p.valid_to ?? "", 備註: p.note ?? "" })));
    const d = new Date();
    XLSX.writeFile(wb, `客戶品項主檔_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.xlsx`);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="客戶／品項主檔"
        description="下單時的預設值都從這裡帶：客戶的送貨地址、聯絡人、付款條件、稅別、交期，以及專屬價／最近成交價／牌價。LINE 訂單也用這裡的名稱、簡稱、別名與分店比對。"
        actions={<>
          {canCreate && <Button variant="outline" onClick={downloadTemplate}><FileSpreadsheet className="h-4 w-4 mr-1.5" />下載匯入範本</Button>}
          {canCreate && canEdit && <>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
            <Button variant="outline" disabled={importing} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-1.5" />{importing ? "匯入中…" : "匯入 Excel"}</Button>
          </>}
          {canExport && <Button variant="outline" onClick={exportAll}><Download className="h-4 w-4 mr-1.5" />匯出全部</Button>}
          {canCreate && isList(kind) && <Button onClick={() => setEditing({ kind: kind as "customer" | "product", row: null })}><Plus className="h-4 w-4 mr-1.5" />新增{kind === "customer" ? "客戶" : "品項"}</Button>}
        </>}
      />

      {(incomplete > 0 || noPrice > 0) && isList(kind) && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          資料完整度：{incomplete > 0 && <>{incomplete} 家客戶缺付款條件或送貨地址；</>}{noPrice > 0 && <>{noPrice} 個品項沒有牌價；</>}下單時這些預設值會帶不出來。
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={kind} onValueChange={(v) => { setKind(v as Kind); setQ(""); }}>
          <TabsList>
            <TabsTrigger value="customer">客戶 {customers.filter((c) => c.is_active).length}</TabsTrigger>
            <TabsTrigger value="product">品項 {products.filter((p) => p.is_active).length}</TabsTrigger>
            {canSetting && <TabsTrigger value="setting">訂單設定</TabsTrigger>}
            {canSetting && <TabsTrigger value="line">LINE 測試</TabsTrigger>}
          </TabsList>
        </Tabs>
        {isList(kind) && <>
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="搜尋代號、名稱、別名、統編、電話" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground"><Switch checked={showInactive} onCheckedChange={setShowInactive} />顯示已停用</label>
        </>}
      </div>

      {kind === "setting" ? <OrderSettingsPanel canEdit={canSetting} /> : kind === "line" ? <LineTestPanel /> : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {kind === "customer" ? <>
                    <TableHead className="w-24">代號</TableHead><TableHead>名稱</TableHead><TableHead className="hidden lg:table-cell">統編</TableHead><TableHead>付款條件</TableHead>
                    <TableHead>稅別</TableHead><TableHead className="hidden lg:table-cell">聯絡人／電話</TableHead><TableHead className="text-center">地址</TableHead><TableHead className="text-center hidden lg:table-cell">專屬價</TableHead><TableHead className="hidden lg:table-cell">業務</TableHead>
                  </> : <>
                    <TableHead className="w-24">品號</TableHead><TableHead>品名</TableHead><TableHead>規格</TableHead><TableHead className="hidden lg:table-cell">類別</TableHead>
                    <TableHead>單位</TableHead><TableHead className="text-right">牌價</TableHead><TableHead className="hidden lg:table-cell">其他單位</TableHead><TableHead className="hidden lg:table-cell">別名</TableHead>
                  </>}
                  <TableHead className="w-16">狀態</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(kind === "customer" ? lc : lp) && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">載入中…</TableCell></TableRow>}
                {!(kind === "customer" ? lc : lp) && (kind === "customer" ? fc : fp).length === 0 && (
                  <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-10">
                    <Database className="h-8 w-8 mx-auto mb-2 opacity-40" />尚無資料。建議先「下載匯入範本」，把凌越匯出的客戶／品項資料貼進去後一次匯入。
                  </TableCell></TableRow>
                )}
                {kind === "customer" && fc.map((r) => {
                  const nContract = (r.eip_customer_price ?? []).filter((p: any) => p.source === "contract").length;
                  return (
                    <TableRow key={r.id} className={`cursor-pointer ${r.is_active ? "" : "opacity-50"}`} onClick={() => setEditing({ kind: "customer", row: r })}>
                      <TableCell className="font-mono text-xs">{r.code ?? "—"}</TableCell>
                      <TableCell><div className="font-medium">{r.name}</div>{r.short_name && <div className="text-xs text-muted-foreground">{r.short_name}</div>}</TableCell>
                      <TableCell className="text-xs hidden lg:table-cell">{r.tax_id ?? ""}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{r.payment_terms ?? <span className="text-amber-700 text-xs">未設定</span>}</TableCell>
                      <TableCell className="text-sm">{r.tax_type ? TAX_TYPE_SHORT[r.tax_type as TaxType] : <span className="text-muted-foreground text-xs">預設</span>}</TableCell>
                      <TableCell className="text-sm hidden lg:table-cell">{[r.contact_name, r.phone].filter(Boolean).join(" / ")}</TableCell>
                      <TableCell className="text-center text-sm">{(r.eip_customer_address ?? []).length || (r.address ? 1 : <span className="text-amber-700 text-xs">無</span>)}</TableCell>
                      <TableCell className="text-center text-sm hidden lg:table-cell">{nContract || ""}</TableCell>
                      <TableCell className="text-sm hidden lg:table-cell">{userName.get(r.sales_owner_id) ?? ""}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.is_active ? <Badge variant="outline" className="text-emerald-700">啟用</Badge> : <Badge variant="outline">停用</Badge>}</TableCell>
                    </TableRow>
                  );
                })}
                {kind === "product" && fp.map((r) => (
                  <TableRow key={r.id} className={`cursor-pointer ${r.is_active ? "" : "opacity-50"}`} onClick={() => setEditing({ kind: "product", row: r })}>
                    <TableCell className="font-mono text-xs">{r.code ?? "—"}</TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-sm">{r.spec ?? ""}</TableCell>
                    <TableCell className="text-sm hidden lg:table-cell">{r.category ?? ""}</TableCell>
                    <TableCell>{r.unit ?? ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.unit_price != null ? money(r.unit_price) : <span className="text-amber-700 text-xs">未設定</span>}</TableCell>
                    <TableCell className="text-sm hidden lg:table-cell">{(r.eip_product_unit ?? []).map((u: any) => u.unit).join("、")}</TableCell>
                    <TableCell className="hidden lg:table-cell"><div className="flex flex-wrap gap-1">{(r.aliases ?? []).slice(0, 4).map((a: string) => <Badge key={a} variant="secondary" className="font-normal">{a}</Badge>)}</div></TableCell>
                    <TableCell className="whitespace-nowrap">{r.is_active ? <Badge variant="outline" className="text-emerald-700">啟用</Badge> : <Badge variant="outline">停用</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {editing?.kind === "customer" && <CustomerDialog row={editing.row} canEdit={editing.row ? canEdit : canCreate} onClose={() => { setEditing(null); refresh(); }} onSaved={() => refresh()} />}
      {editing?.kind === "product" && <ProductDialog row={editing.row} canEdit={editing.row ? canEdit : canCreate} onClose={() => { setEditing(null); refresh(); }} onSaved={() => refresh()} />}

      {report && (
        <Dialog open onOpenChange={(o) => !o && setReport(null)}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>匯入結果</DialogTitle></DialogHeader>
            <div className="space-y-3">
              {report.map((r) => (
                <div key={r.sheet} className="rounded-md border p-3 text-sm">
                  <div className="flex items-center gap-2 font-medium">
                    {r.errors.length ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                    工作表「{r.sheet}」→ {kindLabel(r.kind)}
                  </div>
                  <div className="text-muted-foreground mt-1">新增 {r.inserted}、更新 {r.updated}{r.skipped ? `、略過空白 ${r.skipped}` : ""}{r.errors.length ? `、需注意 ${r.errors.length}` : ""}</div>
                  {r.errors.length > 0 && <ul className="mt-1 list-disc pl-5 text-amber-800 text-xs space-y-0.5 max-h-40 overflow-y-auto">{r.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
                </div>
              ))}
            </div>
            <DialogFooter><Button onClick={() => setReport(null)}>完成</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
