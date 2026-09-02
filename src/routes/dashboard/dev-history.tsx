import { createFileRoute } from "@tanstack/react-router";
import { RequirePerm } from "@/components/RequirePerm";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { taipeiToday } from "@/lib/eip-routine";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import { humanizeError } from "@/lib/eip-error";

export const Route = createFileRoute("/dashboard/dev-history")({ component: () => (
    <RequirePerm module="dev_history">
      <Page />
    </RequirePerm>
  ) });

function Page() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState("");
  const [type, setType] = useState("feature");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const { data: types = [] } = useQuery({
    queryKey: ["lk", "changelog_type"],
    queryFn: async () => {
      // 代碼字典有「停用」開關，這裡原本沒過濾，停用了照樣出現在下拉選單裡（設了等於沒設）
      const { data } = await supabase.from("lookups").select("code,label")
        .eq("category", "changelog_type").eq("is_active", true).order("sort_order");
      return (data ?? []) as { code: string; label: string }[];
    },
  });
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["changelogs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("changelogs").select("*").order("released_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });
  const typeLabel = (c: string) => types.find((t) => t.code === c)?.label ?? c;

  const create = async () => {
    if (!version || !title) { toast.error("請輸入版本與標題"); return; }
    const { error } = await supabase.from("changelogs").insert({ version, type, title, content: content || null, released_at: taipeiToday() });
    if (error) { toast.error(humanizeError(error, "新增版本紀錄")); return; }
    toast.success("已新增");
    setOpen(false); setVersion(""); setTitle(""); setContent("");
    qc.invalidateQueries({ queryKey: ["changelogs"] });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="開發歷程" description="版本與更新紀錄" actions={can("dev_history", "create") ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button>新增版本</Button></DialogTrigger>
          <DialogContent aria-describedby={undefined}>
            <DialogHeader><DialogTitle>新增開發歷程</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1"><Label>版本</Label><Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="v1.1" /></div>
              <div className="space-y-1"><Label>類型</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{types.map((t) => <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>標題</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <div className="space-y-1"><Label>內容</Label><Textarea value={content} onChange={(e) => setContent(e.target.value)} /></div>
            </div>
            <DialogFooter><Button onClick={create}>新增</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      ) : undefined} />
      {isLoading ? <p className="text-muted-foreground">載入中…</p> : (
        <Card><CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>版本</TableHead><TableHead>類型</TableHead><TableHead>標題</TableHead><TableHead>發布日</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">尚無紀錄</TableCell></TableRow>}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-sm">{r.version}</TableCell>
                  <TableCell><Badge variant="secondary">{typeLabel(r.type)}</Badge></TableCell>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell className="text-muted-foreground">{r.released_at ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}
    </div>
  );
}
