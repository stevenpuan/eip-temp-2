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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { humanizeError } from "@/lib/eip-error";

export const Route = createFileRoute("/dashboard/dev-todos")({ component: () => (
    <RequirePerm module="dev_todos">
      <Page />
    </RequirePerm>
  ) });

function Page() {
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["dev_todos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("dev_todos").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const create = async () => {
    if (!title) { toast.error("請輸入標題"); return; }
    const { error } = await supabase.from("dev_todos").insert({ title, description: desc || null, created_by: user?.id ?? null });
    if (error) { toast.error(humanizeError(error, "新增待辦")); return; }
    toast.success("已新增");
    setOpen(false); setTitle(""); setDesc("");
    qc.invalidateQueries({ queryKey: ["dev_todos"] });
  };

  const toggle = async (r: any) => {
    const done = r.status === "done";
    const { error } = await supabase.from("dev_todos").update({ status: done ? "todo" : "done", done_at: done ? null : new Date().toISOString() }).eq("id", r.id);
    if (error) { toast.error(humanizeError(error, "更新狀態")); return; }
    qc.invalidateQueries({ queryKey: ["dev_todos"] });
  };

  const total = rows.length;
  const doneN = rows.filter((r) => r.status === "done").length;
  const todoN = total - doneN;

  return (
    <div className="space-y-6">
      <PageHeader title="代辦事項" description="系統開發中待處理的工作項目" actions={can("dev_todos", "create") ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button>新增代辦</Button></DialogTrigger>
          <DialogContent aria-describedby={undefined}>
            <DialogHeader><DialogTitle>新增代辦</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1"><Label>標題</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <div className="space-y-1"><Label>說明</Label><Textarea value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
            </div>
            <DialogFooter><Button onClick={create}>新增</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      ) : undefined} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">全部</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{total}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">待辦中</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{todoN}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">已完成</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{doneN}</div></CardContent></Card>
      </div>
      {isLoading ? <p className="text-muted-foreground">載入中…</p> : (
        <Card><CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>標題</TableHead><TableHead>狀態</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">尚無代辦</TableCell></TableRow>}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell><Badge variant={r.status === "done" ? "default" : "secondary"}>{r.status === "done" ? "已完成" : "待辦"}</Badge></TableCell>
                  <TableCell className="text-right">
                    {can("dev_todos", "edit") && <Button size="sm" variant="outline" onClick={() => toggle(r)}>{r.status === "done" ? "還原" : "完成"}</Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}
    </div>
  );
}
