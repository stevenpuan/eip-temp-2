import { createFileRoute } from "@tanstack/react-router";
import { RequirePerm } from "@/components/RequirePerm";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
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

export const Route = createFileRoute("/dashboard/issue-reports")({ component: () => (
    <RequirePerm module="issue_reports">
      <Page />
    </RequirePerm>
  ) });

const SEVERITY: Record<string, string> = { low: "低", normal: "一般", high: "高", critical: "嚴重" };
const STATUS: Record<string, string> = { open: "待處理", processing: "處理中", resolved: "已解決", closed: "已關閉" };

function Page() {
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [severity, setSeverity] = useState("normal");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["issue_reports"],
    queryFn: async () => {
      const { data, error } = await supabase.from("issue_reports").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const create = async () => {
    if (!title) { toast.error("請輸入標題"); return; }
    const { error } = await supabase.from("issue_reports").insert({ title, description: desc || null, severity, reporter_id: user?.id ?? null });
    if (error) { toast.error(humanizeError(error, "新增回報")); return; }
    toast.success("已回報");
    setOpen(false); setTitle(""); setDesc(""); setSeverity("normal");
    qc.invalidateQueries({ queryKey: ["issue_reports"] });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="問題反饋" description="回報系統問題" actions={can("issue_reports", "create") ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button>回報問題</Button></DialogTrigger>
          <DialogContent aria-describedby={undefined}>
            <DialogHeader><DialogTitle>回報問題</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1"><Label>標題</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <div className="space-y-1"><Label>嚴重程度</Label>
                <Select value={severity} onValueChange={setSeverity}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(SEVERITY).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>說明</Label><Textarea value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
            </div>
            <DialogFooter><Button onClick={create}>送出</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      ) : undefined} />
      {isLoading ? <p className="text-muted-foreground">載入中…</p> : (
        <Card><CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>標題</TableHead><TableHead>嚴重程度</TableHead><TableHead>狀態</TableHead><TableHead>建立時間</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">尚無資料</TableCell></TableRow>}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell><Badge variant={r.severity === "critical" || r.severity === "high" ? "destructive" : "secondary"}>{SEVERITY[r.severity] ?? r.severity}</Badge></TableCell>
                  <TableCell>{STATUS[r.status] ?? r.status}</TableCell>
                  <TableCell className="text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}
    </div>
  );
}
