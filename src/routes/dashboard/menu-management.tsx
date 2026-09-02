import { createFileRoute } from "@tanstack/react-router";
import { RequirePerm } from "@/components/RequirePerm";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import { humanizeError } from "@/lib/eip-error";

export const Route = createFileRoute("/dashboard/menu-management")({ component: () => (
    <RequirePerm module="menu_management">
      <Page />
    </RequirePerm>
  ) });

interface MenuRow {
  id: string;
  menu_key: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  route: string | null;
  module_key: string | null;
  page_key: string | null;
  sort_order: number;
  is_active: boolean;
}

const blank = (): Partial<MenuRow> => ({ menu_key: "", title: "", parent_id: null, route: "", icon: "", module_key: "", page_key: "", sort_order: 10, is_active: true });

function Page() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const canCreate = can("menu_management", "create");
  const canEdit = can("menu_management", "edit");
  const canDelete = can("menu_management", "delete");

  const { data: menus = [] } = useQuery({
    queryKey: ["menus_all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("menus").select("*").order("sort_order");
      if (error) throw error;
      return data as MenuRow[];
    },
  });
  const reload = () => { qc.invalidateQueries({ queryKey: ["menus_all"] }); qc.invalidateQueries({ queryKey: ["menus"] }); };

  const groups = menus.filter((m) => !m.parent_id);
  const childrenOf = (id: string) => menus.filter((m) => m.parent_id === id);
  const parentOptions = menus.filter((m) => !m.parent_id && !m.route);

  const [form, setForm] = useState<Partial<MenuRow> | null>(null);
  const isNew = form && !form.id;

  const save = async () => {
    if (!form) return;
    if (!form.menu_key || !form.title) { toast.error("請填寫鍵值與名稱"); return; }
    const payload = {
      menu_key: form.menu_key, title: form.title, parent_id: form.parent_id || null,
      route: form.route || null, icon: form.icon || null,
      module_key: form.module_key || null, page_key: form.page_key || null,
      sort_order: form.sort_order ?? 10, is_active: form.is_active ?? true,
    };
    const res = form.id
      ? await supabase.from("menus").update(payload).eq("id", form.id)
      : await supabase.from("menus").insert(payload);
    if (res.error) { toast.error(humanizeError(res.error, "儲存")); return; }
    toast.success("已儲存"); setForm(null); reload();
  };
  const del = async (m: MenuRow) => {
    const isGroup = !m.route && childrenOf(m.id).length > 0;
    if (!confirm(isGroup ? `「${m.title}」是群組,刪除會一併移除其子選單,確定?` : `確定刪除「${m.title}」?`)) return;
    const { error } = await supabase.from("menus").delete().eq("id", m.id);
    if (error) { toast.error(humanizeError(error, "刪除")); return; }
    toast.success("已刪除"); reload();
  };
  const toggle = async (m: MenuRow) => {
    const { error } = await supabase.from("menus").update({ is_active: !m.is_active }).eq("id", m.id);
    if (error) { toast.error(humanizeError(error, "切換啟用狀態")); return; }
    reload();
  };

  const Row = ({ m, child }: { m: MenuRow; child?: boolean }) => (
    <div className={"flex items-center justify-between gap-2 rounded-md border px-3 py-2 " + (child ? "ml-6" : "")}>
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-xs text-muted-foreground w-8">{m.sort_order}</span>
        <span className="font-medium truncate">{m.title}</span>
        {m.route && <span className="text-xs font-mono text-muted-foreground truncate">{m.route}</span>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {m.module_key && <Badge variant="outline" className="text-[11.5px]">{m.module_key}</Badge>}
        <Badge variant={m.is_active ? "default" : "outline"}>{m.is_active ? "啟用" : "停用"}</Badge>
        {canEdit && <Button size="sm" variant="outline" onClick={() => toggle(m)}>{m.is_active ? "停用" : "啟用"}</Button>}
        {canEdit && <Button size="sm" variant="outline" onClick={() => setForm({ ...m })}>編輯</Button>}
        {canDelete && <Button size="sm" variant="outline" onClick={() => del(m)}>刪除</Button>}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="選單管理" description="動態選單結構（資料驅動）" actions={canCreate ? <Button onClick={() => setForm(blank())}>新增選單</Button> : undefined} />
      <Card><CardContent className="space-y-2 py-4">
        {groups.map((g) => (
          <div key={g.id} className="space-y-2">
            <Row m={g} />
            {childrenOf(g.id).map((c) => <Row key={c.id} m={c} child />)}
          </div>
        ))}
      </CardContent></Card>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>{isNew ? "新增選單" : "編輯選單"}</DialogTitle></DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="space-y-1"><Label>鍵值 menu_key（唯一）</Label><Input value={form.menu_key ?? ""} disabled={!isNew} onChange={(e) => setForm({ ...form, menu_key: e.target.value })} /></div>
              <div className="space-y-1"><Label>名稱</Label><Input value={form.title ?? ""} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
              <div className="space-y-1"><Label>上層</Label>
                <Select value={form.parent_id ?? "none"} onValueChange={(v) => setForm({ ...form, parent_id: v === "none" ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">（頂層）</SelectItem>
                    {parentOptions.map((g) => <SelectItem key={g.id} value={g.id}>{g.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>路由 route（群組可空）</Label><Input value={form.route ?? ""} onChange={(e) => setForm({ ...form, route: e.target.value })} placeholder="/dashboard/xxx" /></div>
              <div className="space-y-1"><Label>圖示 icon（lucide 名）</Label><Input value={form.icon ?? ""} onChange={(e) => setForm({ ...form, icon: e.target.value })} placeholder="Home" /></div>
              <div className="space-y-1"><Label>權限模組 module_key</Label><Input value={form.module_key ?? ""} onChange={(e) => setForm({ ...form, module_key: e.target.value })} /></div>
              <div className="space-y-1"><Label>頁面鍵 page_key</Label><Input value={form.page_key ?? ""} onChange={(e) => setForm({ ...form, page_key: e.target.value })} /></div>
              <div className="space-y-1"><Label>排序</Label><Input type="number" value={form.sort_order ?? 10} onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value || "0", 10) })} /></div>
              <div className="flex items-center gap-2"><Switch checked={form.is_active ?? true} onCheckedChange={(v) => setForm({ ...form, is_active: v })} /><Label>啟用</Label></div>
            </div>
          )}
          <DialogFooter><Button onClick={save}>儲存</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
