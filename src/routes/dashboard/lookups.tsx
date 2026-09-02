import { createFileRoute } from "@tanstack/react-router";
import { RequirePerm } from "@/components/RequirePerm";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { humanizeError } from "@/lib/eip-error";

export const Route = createFileRoute("/dashboard/lookups")({ component: () => (
    <RequirePerm module="lookups">
      <Page />
    </RequirePerm>
  ) });

interface Lookup { id: string; category: string; code: string; label: string; sort_order: number; is_active: boolean; }

// 這張表只是「集中維護下拉選項」，但實際上只有一個類別真的被程式讀取。
// 另外兩個類別的選項是寫死在畫面程式裡的，在這裡改不會有任何效果 ——
// 不標出來的話，改了以為生效才是最麻煩的。查證日 2026-08-30。
const CATEGORY_NOTE: Record<string, { used: boolean; note: string }> = {
  changelog_type: { used: true, note: "開發歷程頁的「類型」下拉選單讀這裡（停用的不會出現）" },
  issue_severity: { used: false, note: "問題反饋頁的嚴重度是寫死在程式裡的，改這裡不會生效" },
  feature_request_status: { used: false, note: "許願池狀態是寫死在程式裡的，改這裡不會生效" },
};

function Page() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const canEdit = can("lookups", "edit");
  const canDelete = can("lookups", "delete");
  const canCreate = can("lookups", "create");

  const { data: rows = [] } = useQuery({
    queryKey: ["lookups_all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("lookups").select("*").order("category").order("sort_order");
      if (error) throw error;
      return data as Lookup[];
    },
  });
  const reload = () => qc.invalidateQueries({ queryKey: ["lookups_all"] });

  const [addOpen, setAddOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const create = async () => {
    if (!category || !code || !label) { toast.error("請填寫類別、代碼、標籤"); return; }
    const { data, error } = await supabase.from("lookups").insert({ category, code, label }).select("id");
    if (error) { toast.error(humanizeError(error, "新增")); return; }
    if (!data?.length) { toast.error("新增失敗：沒有權限寫入，請重新整理後再試"); return; }
    toast.success("已新增"); setAddOpen(false); setCode(""); setLabel(""); reload();
  };

  const [edit, setEdit] = useState<Lookup | null>(null);
  const saveEdit = async () => {
    if (!edit) return;
    const { data, error } = await supabase.from("lookups")
      .update({ label: edit.label, sort_order: edit.sort_order, is_active: edit.is_active })
      .eq("id", edit.id).select("id");
    if (error) { toast.error(humanizeError(error, "更新")); return; }
    if (!data?.length) { toast.error("更新失敗：沒有寫入任何資料，請重新整理後再試"); return; }
    toast.success("已更新"); setEdit(null); reload();
  };
  const del = async (r: Lookup) => {
    if (!confirm(`確定刪除「${r.label}」？`)) return;
    const { data, error } = await supabase.from("lookups").delete().eq("id", r.id).select("id");
    if (error) { toast.error(humanizeError(error, "刪除")); return; }
    if (!data?.length) { toast.error("刪除失敗：沒有權限刪除這筆，請重新整理後確認"); return; }
    toast.success("已刪除"); reload();
  };

  const categories = Array.from(new Set(rows.map((r) => r.category)));

  return (
    <div className="space-y-6">
      <PageHeader title="代碼字典" description="集中維護各種下拉選項" actions={canCreate ? (
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild><Button>新增代碼</Button></DialogTrigger>
          <DialogContent aria-describedby={undefined}>
            <DialogHeader><DialogTitle>新增代碼</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1"><Label>類別 category</Label><Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="如 issue_severity" /></div>
              <div className="space-y-1"><Label>代碼 code</Label><Input value={code} onChange={(e) => setCode(e.target.value)} /></div>
              <div className="space-y-1"><Label>標籤 label</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} /></div>
            </div>
            <DialogFooter><Button onClick={create}>新增</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      ) : undefined} />

      {categories.map((cat) => (
        <Card key={cat}>
          <CardHeader className="space-y-1">
            <CardTitle className="text-base font-mono">{cat}</CardTitle>
            {CATEGORY_NOTE[cat] && (
              <p className={CATEGORY_NOTE[cat].used ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
                {CATEGORY_NOTE[cat].used ? "" : "⚠ "}{CATEGORY_NOTE[cat].note}
              </p>
            )}
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>代碼</TableHead><TableHead>標籤</TableHead><TableHead>排序</TableHead><TableHead>狀態</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.filter((r) => r.category === cat).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm">{r.code}</TableCell>
                    <TableCell>{r.label}</TableCell>
                    <TableCell>{r.sort_order}</TableCell>
                    <TableCell><Badge variant={r.is_active ? "default" : "outline"}>{r.is_active ? "啟用" : "停用"}</Badge></TableCell>
                    <TableCell className="text-right space-x-2">
                      {canEdit && <Button size="sm" variant="outline" onClick={() => setEdit({ ...r })}>編輯</Button>}
                      {canDelete && <Button size="sm" variant="outline" onClick={() => del(r)}>刪除</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader><DialogTitle>編輯代碼</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-3">
              <div className="space-y-1"><Label>代碼 code</Label><Input value={edit.code} disabled /></div>
              <div className="space-y-1"><Label>標籤 label</Label><Input value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} /></div>
              <div className="space-y-1"><Label>排序</Label><Input type="number" value={edit.sort_order} onChange={(e) => setEdit({ ...edit, sort_order: parseInt(e.target.value || "0", 10) })} /></div>
              <div className="flex items-center gap-2"><Switch checked={edit.is_active} onCheckedChange={(v) => setEdit({ ...edit, is_active: v })} /><Label>啟用</Label></div>
            </div>
          )}
          <DialogFooter><Button onClick={saveEdit}>儲存</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
