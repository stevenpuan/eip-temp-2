import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { humanizeError } from "@/lib/eip-error";

export type ReportField = {
  label: string;
  type: "text" | "checkbox" | "number" | "date";
};

export function RecurringReportDialog({
  open,
  onClose,
  taskId,
  recurringRuleId,
  initialData,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  taskId: string;
  recurringRuleId: string;
  initialData?: Record<string, unknown> | null;
  onDone?: () => void;
}) {
  const [fields, setFields] = useState<ReportField[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [markDone, setMarkDone] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      const [rrRes, tkRes] = await Promise.all([
        supabase.from("recurring_rule").select("report_fields").eq("id", recurringRuleId).maybeSingle(),
        supabase.from("task").select("report_data").eq("id", taskId).maybeSingle(),
      ]);
      if (cancel) return;
      const raw = (rrRes.data?.report_fields as ReportField[] | null) ?? [];
      setFields(Array.isArray(raw) ? raw : []);
      setValues(((tkRes.data?.report_data as Record<string, unknown>) ?? (initialData as Record<string, unknown>)) ?? {});
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [open, recurringRuleId, taskId, initialData]);

  const submit = async () => {
    setBusy(true);
    try {
      const patch: { report_data: Record<string, unknown>; status_id?: string; progress?: number } = {
        report_data: values,
      };
      if (markDone) {
        const { data: doneStatus, error: stErr } = await supabase
          .from("task_status")
          .select("id")
          .eq("is_done_state", true)
          .order("sort_order")
          .limit(1)
          .maybeSingle();
        // 原本 error 被丟掉：查詢失敗時 doneStatus 是 null，程式靜靜地跳過完成狀態，
        // 只寫 report_data 就跳「已回報」。使用者以為結案了，任務其實還在算逾期。
        if (stErr) throw stErr;
        if (!doneStatus?.id) throw new Error("找不到「已完成」的任務狀態，無法標記完成，請聯絡管理員");
        patch.status_id = doneStatus.id;
        patch.progress = 100;
      }
      const { data, error } = await supabase
        .from("task").update(patch as never).eq("id", taskId).select("id");
      if (error) throw error;
      // 被 RLS 擋掉時回 0 列而 error 是 null
      if (!data?.length) throw new Error("回報失敗：沒有權限更新這筆任務，內容未寫入");
      toast.success("已回報");
      onDone?.();
      onClose();
    } catch (e) {
      toast.error(humanizeError(e, "回報"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>週期工作回報</DialogTitle></DialogHeader>
        {loading ? (
          <div className="text-sm text-muted-foreground py-6 text-center">載入中…</div>
        ) : fields.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4">此規則未設定回報欄位，可直接標記完成。</div>
        ) : (
          <div className="space-y-3">
            {fields.map((f, i) => (
              <div key={i} className="space-y-1.5">
                <Label>{f.label}</Label>
                {f.type === "checkbox" ? (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={!!values[f.label]}
                      onCheckedChange={(v) => setValues((s) => ({ ...s, [f.label]: !!v }))}
                    />
                    <span className="text-sm text-muted-foreground">是</span>
                  </div>
                ) : (
                  <Input
                    type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                    value={(values[f.label] as string | number | undefined) ?? ""}
                    onChange={(e) => setValues((s) => ({ ...s, [f.label]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 pt-2 border-t mt-2">
          <Checkbox id="rrd-done" checked={markDone} onCheckedChange={(v) => setMarkDone(!!v)} />
          <Label htmlFor="rrd-done" className="cursor-pointer">送出後標記為完成</Label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "送出中…" : "送出回報"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
