import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Save, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { DEFAULT_TENANT_ID } from "@/lib/eip-constants";
import { humanizeError } from "@/lib/eip-error";
import { money, splitList } from "@/lib/sales-order";
import { PriceTab } from "./CustomerDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type ProductRow = Record<string, any> & { id: string; name: string; is_active: boolean };

const FIELDS: { key: string; label: string; type?: "number" | "list" | "textarea"; wide?: boolean; required?: boolean; hint?: string }[] = [
  { key: "code", label: "品號", hint: "建議與凌越品號一致" },
  { key: "name", label: "品名", required: true, wide: true },
  { key: "spec", label: "規格" },
  { key: "unit", label: "主單位（例：箱）" },
  { key: "unit_price", label: "牌價（主單位）", type: "number" },
  { key: "category", label: "類別" },
  { key: "pack_desc", label: "包裝說明（例：12包/箱）" },
  { key: "barcode", label: "條碼" },
  { key: "min_order_qty", label: "最小訂量（主單位）", type: "number" },
  { key: "aliases", label: "別名（老闆常用講法，逗號分隔）", type: "list", wide: true },
  { key: "note", label: "備註", type: "textarea", wide: true },
];

export function ProductDialog({ row, canEdit, onClose, onSaved }: { row: ProductRow | null; canEdit: boolean; onClose: () => void; onSaved: (id: string) => void }) {
  const [id, setId] = useState<string | null>(row?.id ?? null);
  const [mainUnit, setMainUnit] = useState<string | null>(row?.unit ?? null);
  const [mainPrice, setMainPrice] = useState<number | null>(row?.unit_price ?? null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{row ? `品項：${row.name}` : "新增品項"}</DialogTitle></DialogHeader>
        <Tabs defaultValue="basic">
          <TabsList>
            <TabsTrigger value="basic">基本資料</TabsTrigger>
            <TabsTrigger value="unit" disabled={!id}>單位換算</TabsTrigger>
            <TabsTrigger value="price" disabled={!id}>客戶價格</TabsTrigger>
          </TabsList>
          <TabsContent value="basic">
            <BasicForm row={row} canEdit={canEdit} onSaved={(nid, u, p) => { setId(nid); setMainUnit(u); setMainPrice(p); onSaved(nid); }} />
          </TabsContent>
          {id && <TabsContent value="unit"><UnitTab productId={id} canEdit={canEdit} mainUnit={mainUnit} mainPrice={mainPrice} /></TabsContent>}
          {id && <TabsContent value="price"><PriceTab productId={id} canEdit={false} /></TabsContent>}
        </Tabs>
        <DialogFooter><Button variant="outline" onClick={onClose}>關閉</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BasicForm({ row, canEdit, onSaved }: { row: ProductRow | null; canEdit: boolean; onSaved: (id: string, unit: string | null, price: number | null) => void }) {
  const [form, setForm] = useState<Record<string, any>>(() => ({ ...(row ?? {}), aliases: (row?.aliases ?? []).join(", ") }));
  const [active, setActive] = useState(row?.is_active ?? true);
  const [rowId, setRowId] = useState(row?.id ?? null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const rec: Record<string, unknown> = { is_active: active };
    for (const f of FIELDS) {
      const v = form[f.key];
      if (f.type === "list") rec[f.key] = splitList(v);
      else if (f.type === "number") {
        const s = String(v ?? "").replace(/,/g, "").trim();
        if (s && Number.isNaN(Number(s))) { toast.error(`${f.label}必須是數字`); return; }
        rec[f.key] = s ? Number(s) : null;
      } else rec[f.key] = (typeof v === "string" ? v.trim() : v) || null;
    }
    if (!rec.name) { toast.error("請填寫品名"); return; }
    setSaving(true);
    const res = rowId
      ? await supabase.from("eip_product").update(rec).eq("id", rowId).select("id").maybeSingle()
      : await supabase.from("eip_product").insert({ ...rec, tenant_id: DEFAULT_TENANT_ID }).select("id").maybeSingle();
    setSaving(false);
    if (res.error || !res.data) { toast.error(res.error ? humanizeError(res.error, "儲存品項") : "儲存失敗：沒有權限"); return; }
    toast.success("已儲存品項");
    setRowId(res.data.id);
    onSaved(res.data.id, (rec.unit as string) ?? null, (rec.unit_price as number) ?? null);
  };
  return (
    <div className="space-y-3 pt-2">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {FIELDS.map((f) => (
          <div key={f.key} className={f.wide ? "col-span-2 md:col-span-3 space-y-1" : "space-y-1"}>
            <Label className="text-xs">{f.label}{f.required && <span className="text-destructive"> *</span>}</Label>
            {f.type === "textarea"
              ? <Textarea rows={2} disabled={!canEdit} value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              : <Input disabled={!canEdit} inputMode={f.type === "number" ? "decimal" : undefined} value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />}
            {f.hint && <p className="text-[11px] text-muted-foreground">{f.hint}</p>}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm"><Switch checked={active} disabled={!canEdit} onCheckedChange={setActive} />啟用（停用後 LINE 訂單不會再比對到）</label>
        {canEdit && <Button onClick={save} disabled={saving}><Save className="h-4 w-4 mr-1.5" />{saving ? "儲存中…" : "儲存"}</Button>}
      </div>
    </div>
  );
}

type Unit = { id?: string; unit: string; ratio: number | null; unit_price: number | null; barcode: string | null };

function UnitTab({ productId, canEdit, mainUnit, mainPrice }: { productId: string; canEdit: boolean; mainUnit: string | null; mainPrice: number | null }) {
  const [rows, setRows] = useState<Unit[]>([]);
  const load = async () => {
    const { data, error } = await supabase.from("eip_product_unit").select("*").eq("product_id", productId).order("ratio");
    if (error) { toast.error(humanizeError(error, "讀取單位")); return; }
    setRows((data ?? []) as Unit[]);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [productId]);
  const setR = (i: number, p: Partial<Unit>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const saveRow = async (i: number) => {
    const r = rows[i];
    if (!r.unit.trim() || !r.ratio || r.ratio <= 0) { toast.error("請填單位與換算率（大於 0）"); return; }
    if (mainUnit && r.unit.trim() === mainUnit) { toast.error("這是主單位，不需要另外設定"); return; }
    const rec = { tenant_id: DEFAULT_TENANT_ID, product_id: productId, unit: r.unit.trim(), ratio: r.ratio, unit_price: r.unit_price, barcode: r.barcode || null };
    const { error } = r.id ? await supabase.from("eip_product_unit").update(rec).eq("id", r.id) : await supabase.from("eip_product_unit").insert(rec);
    if (error) { toast.error(humanizeError(error, "儲存單位")); return; }
    toast.success("已儲存單位"); void load();
  };
  const del = async (i: number) => {
    const r = rows[i];
    if (!r.id) { setRows((rs) => rs.filter((_, j) => j !== i)); return; }
    const { error } = await supabase.from("eip_product_unit").delete().eq("id", r.id);
    if (error) { toast.error(humanizeError(error, "刪除單位")); return; }
    void load();
  };
  return (
    <div className="space-y-2 pt-2">
      <p className="text-xs text-muted-foreground">主單位：<b>{mainUnit ?? "（未設定）"}</b>，牌價 {money(mainPrice) || "未設定"}。其他銷售單位請填「1 個這種單位 = 幾個主單位」，例：主單位箱、一箱 12 包，則「包」的換算率填 0.0833。單價留空時，系統以「換算率 × 牌價」計算。</p>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead className="w-28">單位</TableHead><TableHead className="w-32">換算率</TableHead><TableHead className="w-32">單價</TableHead><TableHead>換算後參考價</TableHead><TableHead className="w-36">條碼</TableHead><TableHead className="w-20" /></TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">只賣主單位就不用設定</TableCell></TableRow>}
            {rows.map((r, i) => (
              <TableRow key={r.id ?? `n${i}`}>
                <TableCell><Input disabled={!canEdit} value={r.unit} onChange={(e) => setR(i, { unit: e.target.value })} /></TableCell>
                <TableCell><Input disabled={!canEdit} inputMode="decimal" value={r.ratio ?? ""} onChange={(e) => setR(i, { ratio: e.target.value === "" ? null : Number(e.target.value) })} /></TableCell>
                <TableCell><Input disabled={!canEdit} inputMode="decimal" placeholder="自動" value={r.unit_price ?? ""} onChange={(e) => setR(i, { unit_price: e.target.value === "" ? null : Number(e.target.value) })} /></TableCell>
                <TableCell className="text-sm text-muted-foreground">{r.unit_price ?? (r.ratio && mainPrice ? money(Math.round(r.ratio * mainPrice * 100) / 100) : "—")}</TableCell>
                <TableCell><Input disabled={!canEdit} value={r.barcode ?? ""} onChange={(e) => setR(i, { barcode: e.target.value })} /></TableCell>
                <TableCell className="whitespace-nowrap">{canEdit && <>
                  <Button size="icon" variant="ghost" onClick={() => saveRow(i)}><Save className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => del(i)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                </>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {canEdit && <Button size="sm" variant="outline" onClick={() => setRows((rs) => [...rs, { unit: "", ratio: null, unit_price: null, barcode: null }])}><Plus className="h-3.5 w-3.5 mr-1" />新增單位</Button>}
    </div>
  );
}
