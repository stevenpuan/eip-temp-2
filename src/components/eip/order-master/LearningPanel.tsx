import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileSpreadsheet, Upload, RefreshCw, Plus, Trash2, Save, CheckCircle2, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { humanizeError } from "@/lib/eip-error";
import { money } from "@/lib/sales-order";
import { SearchSelect } from "@/components/eip/SearchSelect";
import { importSalesHistory, downloadHistoryTemplate, type HistoryReport } from "@/components/eip/order-master/importMaster";
import { todayTaipei } from "@/components/eip/order-master/learning";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Row = Record<string, any> & { id: string; name: string; code?: string | null; short_name?: string | null; is_active: boolean };
type Sub = "usual" | "alias" | "phrase" | "example";
const qty = (n: unknown) => (n === null || n === undefined ? "—" : money(Number(n)));

/** AI 學習資料：常訂品項（含凌越歷史匯入）、客戶專屬說法、說法對照、範例訊息 */
export function LearningPanel({ customers, products, canEdit, canImport, canSetting }: {
  customers: Row[]; products: Row[]; canEdit: boolean; canImport: boolean; canSetting: boolean;
}) {
  const [sub, setSub] = useState<Sub>("usual");
  const custOpts = useMemo(() => customers.filter((c) => c.is_active).map((c) => ({ value: c.id, label: `${c.code ? c.code + "｜" : ""}${c.name}`, keywords: [c.short_name, ...(c.aliases ?? [])] })), [customers]);
  const prodOpts = useMemo(() => products.filter((p) => p.is_active).map((p) => ({ value: p.id, label: `${p.code ? p.code + "｜" : ""}${p.name}`, keywords: p.aliases ?? [] })), [products]);
  const custName = useMemo(() => new Map(customers.map((c) => [c.id, c.short_name || c.name])), [customers]);
  const prodName = useMemo(() => new Map(products.map((p) => [p.id, `${p.code ? p.code + " " : ""}${p.name}`])), [products]);

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="text-sm text-muted-foreground space-y-1">
          <p>這裡的資料會在<b className="text-foreground">老闆用 LINE 下單時</b>一起給 AI 參考，並用來檢查數量、帶慣用單位、在有疑問時給按鈕選。資料越完整，判斷越準。</p>
        </div>
        <Tabs value={sub} onValueChange={(v) => setSub(v as Sub)}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="usual">常訂品項</TabsTrigger>
            <TabsTrigger value="alias">客戶專屬說法</TabsTrigger>
            <TabsTrigger value="phrase">說法對照</TabsTrigger>
            <TabsTrigger value="example">範例訊息</TabsTrigger>
          </TabsList>
        </Tabs>
        {sub === "usual" && <UsualTab custOpts={custOpts} canEdit={canEdit} canImport={canImport} />}
        {sub === "alias" && <AliasTab custOpts={custOpts} prodOpts={prodOpts} custName={custName} prodName={prodName} canEdit={canEdit} />}
        {sub === "phrase" && <PhraseTab canEdit={canEdit} />}
        {sub === "example" && <ExampleTab custOpts={custOpts} custName={custName} canEdit={canEdit} canSetting={canSetting} />}
      </CardContent>
    </Card>
  );
}

// ───────────────────────── 常訂品項 ─────────────────────────
function UsualTab({ custOpts, canEdit, canImport }: { custOpts: { value: string; label: string }[]; canEdit: boolean; canImport: boolean }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"" | "import" | "refresh">("");
  const [rep, setRep] = useState<HistoryReport | null>(null);
  const [cust, setCust] = useState<string | null>(null);

  const { data: stats } = useQuery({
    queryKey: ["learn", "stats"],
    queryFn: async () => {
      const [first, last, prof] = await Promise.all([
        supabase.from("eip_sales_history").select("sale_date", { count: "exact" }).order("sale_date", { ascending: true }).limit(1),
        supabase.from("eip_sales_history").select("sale_date").order("sale_date", { ascending: false }).limit(1),
        supabase.from("eip_customer_product_profile").select("customer_id", { count: "exact" }).gt("order_count", 0).limit(5000),
      ]);
      return {
        rows: first.count ?? 0, from: first.data?.[0]?.sale_date ?? null, to: last.data?.[0]?.sale_date ?? null,
        items: prof.count ?? 0, customers: new Set((prof.data ?? []).map((x: any) => x.customer_id)).size,
      };
    },
  });
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["learn", "usual", cust],
    enabled: !!cust,
    queryFn: async () => {
      const { data, error } = await supabase.from("eip_customer_product_profile")
        .select("*, eip_product(code,name,unit)").eq("customer_id", cust!).gt("order_count", 0).order("order_count", { ascending: false }).limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });
  const refreshAll = () => void qc.invalidateQueries({ queryKey: ["learn"] });

  const onImport = async (file: File) => {
    setBusy("import"); setRep(null);
    try {
      const r = await importSalesHistory(file);
      setRep(r);
      toast.success(`已匯入 ${r.inserted} 列歷史銷貨`);
      refreshAll();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const recompute = async () => {
    setBusy("refresh");
    const { data, error } = await supabase.rpc("eip_refresh_customer_profiles");
    setBusy("");
    if (error) return toast.error(humanizeError(error, "重新計算"));
    toast.success(`已重新計算，共 ${data ?? 0} 筆常訂品項`);
    refreshAll();
  };
  const setHidden = async (id: string, hidden: boolean) => {
    const { error } = await supabase.from("eip_customer_product_profile").update({ is_hidden: hidden }).eq("id", id);
    if (error) return toast.error(humanizeError(error, "更新"));
    void qc.invalidateQueries({ queryKey: ["learn", "usual", cust] });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        由<b className="text-foreground">凌越的歷史銷貨</b>加上<b className="text-foreground">覆核確認過的訂單</b>（近 365 天）自動計算：每個客戶常叫哪些品項、慣用單位、平均和最多叫多少、上次價格。
        匯入後上線第一天就能檢查數量是否異常、支援「照舊」下單、帶入最近成交價。之後每次覆核確認會自動更新。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={downloadHistoryTemplate}><FileSpreadsheet className="h-4 w-4 mr-1.5" />下載歷史銷貨範本</Button>
        {canImport && <>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          <Button disabled={!!busy} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-1.5" />{busy === "import" ? "匯入中…" : "匯入歷史銷貨"}</Button>
        </>}
        {canEdit && <Button variant="ghost" disabled={!!busy} onClick={recompute}><RefreshCw className={`h-4 w-4 mr-1.5 ${busy === "refresh" ? "animate-spin" : ""}`} />重新計算</Button>}
      </div>
      <div className="text-sm rounded-md border bg-muted/30 px-3 py-2">
        歷史銷貨：{stats?.rows ? <><b>{stats.rows.toLocaleString()}</b> 列（{stats.from} ～ {stats.to}）</> : <span className="text-amber-700">尚未匯入</span>}
        <span className="mx-2 text-muted-foreground">｜</span>
        常訂品項：<b>{(stats?.items ?? 0).toLocaleString()}</b> 筆，涵蓋 <b>{stats?.customers ?? 0}</b> 家客戶
      </div>
      <p className="text-xs text-muted-foreground">
        從凌越匯出近 6～12 個月的銷貨明細（Excel）直接匯入即可：需要「銷貨日期、客戶代號、產品代號（品號）、數量」，有「單位、單價、銷貨單號」更好，常見的凌越欄名都認得。
        重新匯入會<b>取代上次匯入的歷史銷貨</b>，不影響訂單與主檔；數量小於等於 0 的銷退會略過。
      </p>
      {rep && (
        <div className="rounded-md border p-3 text-sm space-y-1">
          <div className="flex items-center gap-2 font-medium">
            {rep.errors.length ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
            匯入完成：{rep.rows} 列中匯入 {rep.inserted} 列{rep.returns ? `、銷退 ${rep.returns} 列略過` : ""}{rep.skipped - rep.returns > 0 ? `、其他略過 ${rep.skipped - rep.returns} 列` : ""}
          </div>
          <div className="text-muted-foreground">已重算常訂品項 {rep.profile_items} 筆；補上最近成交價 {rep.prices} 筆（不會蓋掉合約價和訂單學到的價格）。</div>
          {rep.errors.length > 0 && <ul className="list-disc pl-5 text-amber-800 text-xs space-y-0.5">{rep.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        </div>
      )}
      <div className="max-w-md"><SearchSelect value={cust} options={custOpts} onChange={setCust} placeholder="選一個客戶，看他的常訂品項" /></div>
      {cust && (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader><TableRow>
              <TableHead>品項</TableHead><TableHead className="text-right">叫過</TableHead><TableHead>慣用單位</TableHead>
              <TableHead className="text-right">平均／最多</TableHead><TableHead>上次</TableHead><TableHead className="text-right">上次單價</TableHead>
              <TableHead className="w-28">LINE 建議</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">載入中…</TableCell></TableRow>}
              {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">這個客戶還沒有歷史資料</TableCell></TableRow>}
              {rows.map((r: any) => (
                <TableRow key={r.id} className={r.is_hidden ? "opacity-50" : ""}>
                  <TableCell><span className="font-mono text-xs mr-1.5">{r.eip_product?.code}</span>{r.eip_product?.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.order_count} 次</TableCell>
                  <TableCell>{r.usual_unit ?? r.base_unit ?? ""}</TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">{qty(r.avg_base_qty)}／{qty(r.max_base_qty)} {r.base_unit ?? ""}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{r.last_date ? `${String(r.last_date).slice(5).replace("-", "/")} ${qty(r.last_qty)}${r.last_unit ?? ""}` : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.last_price != null ? money(r.last_price) : ""}</TableCell>
                  <TableCell>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Switch disabled={!canEdit} checked={!r.is_hidden} onCheckedChange={(v) => void setHidden(r.id, !v)} />{r.is_hidden ? "不建議" : "會建議"}
                    </label>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── 客戶專屬說法 ─────────────────────────
function AliasTab({ custOpts, prodOpts, custName, prodName, canEdit }: {
  custOpts: { value: string; label: string }[]; prodOpts: { value: string; label: string }[];
  custName: Map<string, string>; prodName: Map<string, string>; canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string | null>(null);
  const [form, setForm] = useState<{ customer_id: string | null; alias: string; product_id: string | null }>({ customer_id: null, alias: "", product_id: null });
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["learn", "alias", filter],
    queryFn: async () => {
      let q = supabase.from("eip_customer_product_alias").select("*").order("updated_at", { ascending: false }).limit(500);
      if (filter) q = q.eq("customer_id", filter);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
  const reload = () => void qc.invalidateQueries({ queryKey: ["learn", "alias"] });
  const add = async () => {
    if (!form.customer_id || !form.alias.trim() || !form.product_id) return toast.error("請選客戶、輸入說法、選品項");
    const { error } = await supabase.from("eip_customer_product_alias").insert({ customer_id: form.customer_id, alias: form.alias.trim(), product_id: form.product_id, source: "manual" });
    if (error) return toast.error(humanizeError(error, "新增說法"));
    toast.success("已新增");
    setForm({ customer_id: form.customer_id, alias: "", product_id: null });
    reload();
  };
  const remove = async (id: string, alias: string) => {
    if (!window.confirm(`刪除說法「${alias}」？`)) return;
    const { error } = await supabase.from("eip_customer_product_alias").delete().eq("id", id);
    if (error) return toast.error(humanizeError(error, "刪除"));
    reload();
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        同一句話在不同客戶代表不同品項時用，例如王記說「白的」是原味豆乾。<b className="text-foreground">內勤覆核時把 LINE 訂單的品項改對，系統會自動記在這個客戶底下</b>（來源「學到」），
        不會影響其他客戶。也可以在這裡手動新增；手動的不會被自動學習蓋掉。
      </p>
      {canEdit && (
        <div className="grid gap-2 md:grid-cols-[1fr_160px_1fr_auto] items-center rounded-md border p-3 bg-muted/20">
          <SearchSelect value={form.customer_id} options={custOpts} onChange={(v) => setForm((f) => ({ ...f, customer_id: v }))} placeholder="客戶" />
          <Input placeholder="說法（例：白的）" value={form.alias} onChange={(e) => setForm((f) => ({ ...f, alias: e.target.value }))} />
          <SearchSelect value={form.product_id} options={prodOpts} onChange={(v) => setForm((f) => ({ ...f, product_id: v }))} placeholder="代表的品項" />
          <Button onClick={add}><Plus className="h-4 w-4 mr-1" />新增</Button>
        </div>
      )}
      <div className="max-w-md"><SearchSelect value={filter} options={custOpts} onChange={setFilter} placeholder="全部客戶（可選一家篩選）" /></div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>客戶</TableHead><TableHead>說法</TableHead><TableHead>代表的品項</TableHead><TableHead>來源</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">載入中…</TableCell></TableRow>}
            {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">還沒有專屬說法。內勤覆核 LINE 訂單時改對的品項會自動出現在這裡。</TableCell></TableRow>}
            {rows.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell>{custName.get(r.customer_id) ?? "—"}</TableCell>
                <TableCell className="font-medium">「{r.alias}」</TableCell>
                <TableCell>{prodName.get(r.product_id) ?? "—"}</TableCell>
                <TableCell>{r.source === "learned" ? <Badge variant="secondary">學到</Badge> : <Badge variant="outline">手動</Badge>}</TableCell>
                <TableCell>{canEdit && <Button size="icon" variant="ghost" onClick={() => void remove(r.id, r.alias)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ───────────────────────── 說法對照 ─────────────────────────
function PhraseTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["learn", "phrase"],
    queryFn: async () => {
      const { data, error } = await supabase.from("eip_order_phrase").select("*").order("sort_order").order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
  const [draft, setDraft] = useState<Record<string, { phrase: string; meaning: string }>>({});
  const [nw, setNw] = useState({ phrase: "", meaning: "" });
  useEffect(() => { setDraft({}); }, [rows]);
  const reload = () => void qc.invalidateQueries({ queryKey: ["learn", "phrase"] });
  const save = async (r: any) => {
    const d = draft[r.id];
    if (!d) return;
    if (!d.phrase.trim() || !d.meaning.trim()) return toast.error("說法和意思都要填");
    const { error } = await supabase.from("eip_order_phrase").update({ phrase: d.phrase.trim(), meaning: d.meaning.trim() }).eq("id", r.id);
    if (error) return toast.error(humanizeError(error, "儲存"));
    toast.success("已儲存");
    reload();
  };
  const toggle = async (id: string, v: boolean) => {
    const { error } = await supabase.from("eip_order_phrase").update({ is_active: v }).eq("id", id);
    if (error) return toast.error(humanizeError(error, "更新"));
    reload();
  };
  const remove = async (r: any) => {
    if (!window.confirm(`刪除說法「${r.phrase}」？`)) return;
    const { error } = await supabase.from("eip_order_phrase").delete().eq("id", r.id);
    if (error) return toast.error(humanizeError(error, "刪除"));
    reload();
  };
  const add = async () => {
    if (!nw.phrase.trim() || !nw.meaning.trim()) return toast.error("說法和意思都要填");
    const { error } = await supabase.from("eip_order_phrase").insert({ phrase: nw.phrase.trim(), meaning: nw.meaning.trim(), sort_order: 200 });
    if (error) return toast.error(humanizeError(error, "新增"));
    setNw({ phrase: "", meaning: "" });
    reload();
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        全公司共用的口語說法與換算，例如「一板＝40 箱」「白的＝原味豆乾」「老地方＝主要送貨地址」。系統已先放一批常見的，請依艾士的實際用語增修；停用的不會給 AI。
      </p>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead className="w-48">說法</TableHead><TableHead>意思</TableHead><TableHead className="w-20">啟用</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">載入中…</TableCell></TableRow>}
            {rows.map((r: any) => {
              const d = draft[r.id] ?? { phrase: r.phrase, meaning: r.meaning };
              const dirty = d.phrase !== r.phrase || d.meaning !== r.meaning;
              return (
                <TableRow key={r.id} className={r.is_active ? "" : "opacity-60"}>
                  <TableCell><Input disabled={!canEdit} value={d.phrase} onChange={(e) => setDraft((x) => ({ ...x, [r.id]: { ...d, phrase: e.target.value } }))} /></TableCell>
                  <TableCell><Input disabled={!canEdit} value={d.meaning} onChange={(e) => setDraft((x) => ({ ...x, [r.id]: { ...d, meaning: e.target.value } }))} /></TableCell>
                  <TableCell><Switch disabled={!canEdit} checked={r.is_active} onCheckedChange={(v) => void toggle(r.id, v)} /></TableCell>
                  <TableCell className="whitespace-nowrap">
                    {canEdit && dirty && <Button size="icon" variant="ghost" title="儲存" onClick={() => void save(r)}><Save className="h-4 w-4 text-primary" /></Button>}
                    {canEdit && <Button size="icon" variant="ghost" title="刪除" onClick={() => void remove(r)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>}
                  </TableCell>
                </TableRow>
              );
            })}
            {canEdit && (
              <TableRow>
                <TableCell><Input placeholder="新說法（例：一板）" value={nw.phrase} onChange={(e) => setNw((x) => ({ ...x, phrase: e.target.value }))} /></TableCell>
                <TableCell><Input placeholder="意思（例：40 箱）" value={nw.meaning} onChange={(e) => setNw((x) => ({ ...x, meaning: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void add(); }} /></TableCell>
                <TableCell colSpan={2}><Button size="sm" onClick={add}><Plus className="h-4 w-4 mr-1" />新增</Button></TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ───────────────────────── 範例訊息 ─────────────────────────
const SRC: Record<string, string> = { order: "覆核確認", manual: "手動", test: "測試台" };

function ExampleTab({ custOpts, custName, canEdit, canSetting }: {
  custOpts: { value: string; label: string }[]; custName: Map<string, string>; canEdit: boolean; canSetting: boolean;
}) {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["learn", "example"],
    queryFn: async () => {
      const { data, error } = await supabase.from("eip_order_example").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: auto } = useQuery({
    queryKey: ["learn", "example-setting"],
    queryFn: async () => (await supabase.from("eip_sales_order_setting").select("learn_examples").maybeSingle()).data?.learn_examples ?? true,
  });
  const [draft, setDraft] = useState<Record<string, { input_text: string; expected_text: string }>>({});
  const [nw, setNw] = useState<{ input_text: string; expected_text: string; customer_id: string | null; message_date: string }>({ input_text: "", expected_text: "", customer_id: null, message_date: todayTaipei() });
  useEffect(() => { setDraft({}); }, [rows]);
  const reload = () => void qc.invalidateQueries({ queryKey: ["learn", "example"] });

  const setAuto = async (v: boolean) => {
    const { error } = await supabase.from("eip_sales_order_setting").update({ learn_examples: v }).not("tenant_id", "is", null);
    if (error) return toast.error(humanizeError(error, "更新設定"));
    void qc.invalidateQueries({ queryKey: ["learn", "example-setting"] });
  };
  const save = async (r: any) => {
    const d = draft[r.id];
    if (!d || !d.input_text.trim() || !d.expected_text.trim()) return toast.error("訊息和正確結果都要填");
    const { error } = await supabase.from("eip_order_example").update({ input_text: d.input_text.trim(), expected_text: d.expected_text.trim() }).eq("id", r.id);
    if (error) return toast.error(humanizeError(error, "儲存"));
    toast.success("已儲存");
    reload();
  };
  const toggle = async (id: string, v: boolean) => {
    const { error } = await supabase.from("eip_order_example").update({ is_active: v }).eq("id", id);
    if (error) return toast.error(humanizeError(error, "更新"));
    reload();
  };
  const remove = async (id: string) => {
    if (!window.confirm("刪除這則範例？")) return;
    const { error } = await supabase.from("eip_order_example").delete().eq("id", id);
    if (error) return toast.error(humanizeError(error, "刪除"));
    reload();
  };
  const add = async () => {
    if (!nw.input_text.trim() || !nw.expected_text.trim()) return toast.error("訊息和正確結果都要填");
    const { error } = await supabase.from("eip_order_example").insert({
      input_text: nw.input_text.trim(), expected_text: nw.expected_text.trim(), customer_id: nw.customer_id, message_date: nw.message_date || null, source: "manual",
    });
    if (error) return toast.error(humanizeError(error, "新增範例"));
    toast.success("已新增範例");
    setNw({ input_text: "", expected_text: "", customer_id: null, message_date: todayTaipei() });
    reload();
  };
  const active = rows.filter((r: any) => r.is_active).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        老闆過去傳的 LINE 訂單原文，以及正確的整理結果。AI 解析新訊息時會參考最相關的 5 則（同一個客戶的優先），用來理解老闆的寫法和簡稱；不會把範例的品項帶進新訂單。
        建議收集 10～20 則真實訊息，在「LINE 測試」試過、改對後存成範例。
      </p>
      <label className="flex items-center gap-2 text-sm">
        <Switch disabled={!canSetting} checked={auto !== false} onCheckedChange={(v) => void setAuto(v)} />
        覆核確認的 LINE 文字訂單，自動存成範例（之後可在這裡修改或停用）
      </label>
      {canEdit && (
        <div className="rounded-md border p-3 bg-muted/20 space-y-2">
          <div className="text-sm font-medium">新增範例</div>
          <div className="grid gap-2 md:grid-cols-2">
            <Textarea rows={5} placeholder={"老闆的原文，例：\n王記 白的10 五香5 禮拜一送"} value={nw.input_text} onChange={(e) => setNw((x) => ({ ...x, input_text: e.target.value }))} />
            <Textarea rows={5} placeholder={"正確結果，例：\n客戶：C001 王記食品行\n交期：下週一\n1. P001 原味豆乾 10箱\n2. P002 五香豆乾 5箱"} value={nw.expected_text} onChange={(e) => setNw((x) => ({ ...x, expected_text: e.target.value }))} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-64"><SearchSelect value={nw.customer_id} options={custOpts} onChange={(v) => setNw((x) => ({ ...x, customer_id: v }))} placeholder="客戶（選填）" /></div>
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground">訊息日期<Input type="date" className="w-40" value={nw.message_date} onChange={(e) => setNw((x) => ({ ...x, message_date: e.target.value }))} /></label>
            <Button onClick={add}><Plus className="h-4 w-4 mr-1" />新增</Button>
          </div>
        </div>
      )}
      <div className="text-sm text-muted-foreground">共 {rows.length} 則，啟用 {active} 則</div>
      {isLoading && <div className="text-center text-muted-foreground py-6 text-sm">載入中…</div>}
      {!isLoading && rows.length === 0 && <div className="text-center text-muted-foreground py-6 text-sm rounded-md border">還沒有範例。覆核確認 LINE 訂單後會自動出現，也可以手動新增或從「LINE 測試」存。</div>}
      <div className="space-y-3">
        {rows.map((r: any) => {
          const d = draft[r.id] ?? { input_text: r.input_text, expected_text: r.expected_text };
          const dirty = d.input_text !== r.input_text || d.expected_text !== r.expected_text;
          return (
            <div key={r.id} className={`rounded-md border p-3 space-y-2 ${r.is_active ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{r.customer_id ? custName.get(r.customer_id) ?? "（客戶）" : "（未指定客戶）"}</span>
                <Badge variant="outline">{SRC[r.source] ?? r.source}</Badge>
                {r.message_date && <span className="text-muted-foreground text-xs">{r.message_date}</span>}
                <span className="flex-1" />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Switch disabled={!canEdit} checked={r.is_active} onCheckedChange={(v) => void toggle(r.id, v)} />{r.is_active ? "使用中" : "停用"}</label>
                {canEdit && dirty && <Button size="sm" variant="outline" onClick={() => void save(r)}><Save className="h-3.5 w-3.5 mr-1" />儲存</Button>}
                {canEdit && <Button size="icon" variant="ghost" onClick={() => void remove(r.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>}
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <div><div className="text-xs text-muted-foreground mb-1">老闆的訊息</div>
                  <Textarea rows={4} disabled={!canEdit} value={d.input_text} onChange={(e) => setDraft((x) => ({ ...x, [r.id]: { ...d, input_text: e.target.value } }))} /></div>
                <div><div className="text-xs text-muted-foreground mb-1">正確結果</div>
                  <Textarea rows={4} disabled={!canEdit} value={d.expected_text} onChange={(e) => setDraft((x) => ({ ...x, [r.id]: { ...d, expected_text: e.target.value } }))} /></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
