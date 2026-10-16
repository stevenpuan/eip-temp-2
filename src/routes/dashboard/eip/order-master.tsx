import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Database, Plus, Search, Download, Upload, FileSpreadsheet, Pencil } from "lucide-react";

// 新資料表尚未進 src/integrations/supabase/types.ts，這裡用 any 版 client。
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
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

type Kind = "customer" | "product";
type FieldDef = { key: string; header: string; type?: "text" | "number" | "aliases" | "textarea"; required?: boolean };

// 欄位定義同時用於：表單、Excel 範本、匯入、匯出（header 即 Excel 欄名）
const FIELDS: Record<Kind, FieldDef[]> = {
  customer: [
    { key: "code", header: "客戶代號" },
    { key: "name", header: "客戶名稱", required: true },
    { key: "short_name", header: "簡稱" },
    { key: "aliases", header: "別名（逗號分隔）", type: "aliases" },
    { key: "contact_name", header: "聯絡人" },
    { key: "phone", header: "電話" },
    { key: "address", header: "送貨地址" },
    { key: "note", header: "備註", type: "textarea" },
  ],
  product: [
    { key: "code", header: "品號" },
    { key: "name", header: "品名", required: true },
    { key: "spec", header: "規格" },
    { key: "unit", header: "單位" },
    { key: "unit_price", header: "單價", type: "number" },
    { key: "aliases", header: "別名（逗號分隔）", type: "aliases" },
    { key: "note", header: "備註", type: "textarea" },
  ],
};
const TABLE: Record<Kind, string> = { customer: "eip_customer", product: "eip_product" };
const LABEL: Record<Kind, string> = { customer: "客戶", product: "品項" };

type Row = Record<string, unknown> & { id: string; is_active: boolean; aliases: string[] | null; code: string | null; name: string };

const splitAliases = (v: unknown) =>
  String(v ?? "").split(/[,，、;；\n]/).map((s) => s.trim()).filter(Boolean);

function OrderMasterPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>("customer");
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 內勤（訂單接收 edit 權限）也能新增/編輯主檔，與 RLS 一致
  const canCreate = can("eip_order_master", "create") || can("eip_sales_order", "edit");
  const canEdit = can("eip_order_master", "edit") || can("eip_sales_order", "edit");
  const canExport = can("eip_order_master", "export");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["order-master", kind],
    queryFn: async () => {
      const { data, error } = await supabase.from(TABLE[kind]).select("*").order("code", { ascending: true, nullsFirst: false }).order("name");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return rows.filter((r) => (showInactive || r.is_active) && (!kw ||
      [r.code, r.name, r.short_name, r.spec, ...(r.aliases ?? [])].some((s) => String(s ?? "").toLowerCase().includes(kw))));
  }, [rows, q, showInactive]);

  const fields = FIELDS[kind];

  const toExcelRow = (r: Row) => {
    const o: Record<string, unknown> = {};
    fields.forEach((f) => { o[f.header] = f.type === "aliases" ? (r.aliases ?? []).join(",") : (r[f.key] ?? ""); });
    o["啟用"] = r.is_active ? "Y" : "N";
    return o;
  };
  const headers = [...fields.map((f) => f.header), "啟用"];

  const exportList = () => {
    exportToExcel({ filename: `${LABEL[kind]}主檔`, sheetName: LABEL[kind], rows: filtered.map(toExcelRow), columns: headers.map((h) => ({ header: h, key: h })) });
  };

  const downloadTemplate = () => {
    const sample: Record<Kind, Record<string, unknown>> = {
      customer: { 客戶代號: "C001", 客戶名稱: "範例食品行", 簡稱: "範例", "別名（逗號分隔）": "老范,范記", 聯絡人: "王先生", 電話: "02-1234-5678", 送貨地址: "台北市…", 備註: "", 啟用: "Y" },
      product: { 品號: "P001", 品名: "範例商品", 規格: "500g×12", 單位: "箱", 單價: 1200, "別名（逗號分隔）": "原味,小包", 備註: "", 啟用: "Y" },
    };
    const ws = XLSX.utils.json_to_sheet([sample[kind]], { header: headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, LABEL[kind]);
    XLSX.writeFile(wb, `${LABEL[kind]}主檔_匯入範本.xlsx`);
  };

  // Excel 匯入：有代號 → 依代號更新或新增；無代號 → 依名稱比對更新或新增
  const onImport = async (file: File) => {
    setImporting(true);
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const nameField = fields.find((f) => f.required)!;
      const byCode = new Map(rows.filter((r) => r.code).map((r) => [String(r.code).trim(), r.id]));
      const byName = new Map(rows.map((r) => [r.name.trim(), r.id]));
      let ins = 0, upd = 0, skip = 0;
      const errors: string[] = [];
      const inserts: Record<string, unknown>[] = [];
      for (const [i, raw] of json.entries()) {
        const rec: Record<string, unknown> = {};
        for (const f of fields) {
          // 容許欄名寫成「別名」而非「別名（逗號分隔）」
          const v = raw[f.header] ?? raw[f.header.replace(/（.*）/, "")];
          if (v === undefined) continue;
          if (f.type === "aliases") rec[f.key] = splitAliases(v);
          else if (f.type === "number") rec[f.key] = String(v).trim() === "" ? null : Number(String(v).replace(/,/g, ""));
          else rec[f.key] = String(v).trim() || null;
        }
        if ("啟用" in raw) rec.is_active = !/^(n|no|否|停用|0|false)$/i.test(String(raw["啟用"]).trim());
        if (!rec[nameField.key]) { skip++; continue; }
        if (rec.unit_price !== undefined && rec.unit_price !== null && Number.isNaN(rec.unit_price)) { errors.push(`第 ${i + 2} 列單價不是數字`); continue; }
        const id = (rec.code && byCode.get(String(rec.code))) || byName.get(String(rec[nameField.key]));
        if (id) {
          const { error } = await supabase.from(TABLE[kind]).update(rec).eq("id", id);
          if (error) errors.push(`第 ${i + 2} 列：${humanizeError(error, "更新")}`); else upd++;
        } else {
          inserts.push({ ...rec, tenant_id: DEFAULT_TENANT_ID });
        }
      }
      for (let i = 0; i < inserts.length; i += 200) {
        const chunk = inserts.slice(i, i + 200);
        const { error } = await supabase.from(TABLE[kind]).insert(chunk);
        if (error) errors.push(humanizeError(error, "新增")); else ins += chunk.length;
      }
      await qc.invalidateQueries({ queryKey: ["order-master", kind] });
      toast.success(`匯入完成：新增 ${ins} 筆、更新 ${upd} 筆${skip ? `、略過空白 ${skip} 筆` : ""}`);
      if (errors.length) toast.error(errors.slice(0, 5).join("\n") + (errors.length > 5 ? `\n…共 ${errors.length} 個錯誤` : ""));
    } catch (e) {
      toast.error(`匯入失敗：${(e as Error).message}`);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="客戶／品項主檔"
        description="LINE 訂單會用這裡的名稱、簡稱與別名自動比對客戶與品項。內勤覆核確認時，老闆的講法會自動學成別名，越用越準。"
        actions={<>
          {canCreate && <Button variant="outline" onClick={downloadTemplate}><FileSpreadsheet className="h-4 w-4 mr-1.5" />下載匯入範本</Button>}
          {canCreate && canEdit && <>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
            <Button variant="outline" disabled={importing} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-1.5" />{importing ? "匯入中…" : "匯入 Excel"}</Button>
          </>}
          {canExport && <Button variant="outline" onClick={exportList}><Download className="h-4 w-4 mr-1.5" />匯出 Excel</Button>}
          {canCreate && <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4 mr-1.5" />新增{LABEL[kind]}</Button>}
        </>}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={kind} onValueChange={(v) => { setKind(v as Kind); setQ(""); }}>
          <TabsList>
            <TabsTrigger value="customer">客戶</TabsTrigger>
            <TabsTrigger value="product">品項</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="搜尋代號、名稱、別名" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={showInactive} onCheckedChange={setShowInactive} />顯示已停用
        </label>
        <span className="text-sm text-muted-foreground">共 {filtered.length} 筆</span>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {kind === "customer" ? <>
                  <TableHead className="w-24">代號</TableHead><TableHead>名稱</TableHead><TableHead>簡稱</TableHead>
                  <TableHead>別名</TableHead><TableHead>聯絡人／電話</TableHead><TableHead>送貨地址</TableHead>
                </> : <>
                  <TableHead className="w-24">品號</TableHead><TableHead>品名</TableHead><TableHead>規格</TableHead>
                  <TableHead>單位</TableHead><TableHead className="text-right">單價</TableHead><TableHead>別名</TableHead>
                </>}
                <TableHead className="w-20">狀態</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">載入中…</TableCell></TableRow>}
              {!isLoading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                  <Database className="h-8 w-8 mx-auto mb-2 opacity-40" />尚無{LABEL[kind]}資料，可用「匯入 Excel」一次匯入，或在覆核訂單時順手新增。
                </TableCell></TableRow>
              )}
              {filtered.map((r) => (
                <TableRow key={r.id} className={r.is_active ? "" : "opacity-50"}>
                  <TableCell className="font-mono text-xs">{r.code ?? "—"}</TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  {kind === "customer" ? <>
                    <TableCell>{String(r.short_name ?? "")}</TableCell>
                    <TableCell><Aliases list={r.aliases} /></TableCell>
                    <TableCell className="text-sm">{[r.contact_name, r.phone].filter(Boolean).join(" / ")}</TableCell>
                    <TableCell className="text-sm max-w-[240px] truncate">{String(r.address ?? "")}</TableCell>
                  </> : <>
                    <TableCell className="text-sm">{String(r.spec ?? "")}</TableCell>
                    <TableCell>{String(r.unit ?? "")}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.unit_price != null ? Number(r.unit_price).toLocaleString() : ""}</TableCell>
                    <TableCell><Aliases list={r.aliases} /></TableCell>
                  </>}
                  <TableCell>{r.is_active ? <Badge variant="outline" className="text-emerald-700">啟用</Badge> : <Badge variant="outline">停用</Badge>}</TableCell>
                  <TableCell>{canEdit && <Button size="icon" variant="ghost" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></Button>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editing && (
        <MasterDialog kind={kind} row={editing === "new" ? null : editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void qc.invalidateQueries({ queryKey: ["order-master", kind] }); }} />
      )}
    </div>
  );
}

function Aliases({ list }: { list: string[] | null }) {
  if (!list?.length) return <span className="text-muted-foreground text-xs">—</span>;
  return <div className="flex flex-wrap gap-1">{list.slice(0, 6).map((a) => <Badge key={a} variant="secondary" className="font-normal">{a}</Badge>)}{list.length > 6 && <span className="text-xs text-muted-foreground">+{list.length - 6}</span>}</div>;
}

function MasterDialog({ kind, row, onClose, onSaved }: { kind: Kind; row: Row | null; onClose: () => void; onSaved: () => void }) {
  const fields = FIELDS[kind];
  const [form, setForm] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    fields.forEach((f) => { o[f.key] = f.type === "aliases" ? (row?.aliases ?? []).join(", ") : row?.[f.key] == null ? "" : String(row[f.key]); });
    return o;
  });
  const [active, setActive] = useState(row?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const rec: Record<string, unknown> = { is_active: active };
    for (const f of fields) {
      const v = form[f.key]?.trim() ?? "";
      if (f.required && !v) { toast.error(`請填寫${f.header}`); return; }
      if (f.type === "aliases") rec[f.key] = splitAliases(v);
      else if (f.type === "number") {
        if (v && Number.isNaN(Number(v.replace(/,/g, "")))) { toast.error(`${f.header}必須是數字`); return; }
        rec[f.key] = v ? Number(v.replace(/,/g, "")) : null;
      } else rec[f.key] = v || null;
    }
    setSaving(true);
    const { error } = row
      ? await supabase.from(TABLE[kind]).update(rec).eq("id", row.id)
      : await supabase.from(TABLE[kind]).insert({ ...rec, tenant_id: DEFAULT_TENANT_ID });
    setSaving(false);
    if (error) { toast.error(humanizeError(error, `儲存${LABEL[kind]}`)); return; }
    toast.success(`已儲存${LABEL[kind]}`);
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{row ? `編輯${LABEL[kind]}` : `新增${LABEL[kind]}`}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {fields.map((f) => (
            <div key={f.key} className={f.type === "aliases" || f.type === "textarea" || f.key === "address" || f.key === "name" ? "col-span-2 space-y-1" : "space-y-1"}>
              <Label>{f.header}{f.required && <span className="text-destructive"> *</span>}</Label>
              {f.type === "textarea"
                ? <Textarea rows={2} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                : <Input inputMode={f.type === "number" ? "decimal" : undefined} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />}
              {f.type === "aliases" && <p className="text-xs text-muted-foreground">老闆常用的講法，例如「老王」「王記那家」，用逗號分隔。</p>}
            </div>
          ))}
          <label className="col-span-2 flex items-center gap-2 text-sm"><Switch checked={active} onCheckedChange={setActive} />啟用（停用後 LINE 訂單不會再比對到）</label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={save} disabled={saving}>{saving ? "儲存中…" : "儲存"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
