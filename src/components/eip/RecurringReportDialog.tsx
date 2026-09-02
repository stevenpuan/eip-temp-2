import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
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

export type ReportValues = Record<string, unknown>;

const FIELD_TYPES = ["text", "checkbox", "number", "date"] as const;

/** report_fields 是 jsonb，正式庫裡可能有舊格式或缺 type 的資料，一律收斂成可渲染的形狀 */
function normalizeFields(raw: unknown): ReportField[] {
  if (!Array.isArray(raw)) return [];
  const out: ReportField[] = [];
  for (const f of raw) {
    if (!f || typeof f !== "object") continue;
    const label = (f as { label?: unknown }).label;
    if (typeof label !== "string" || !label.trim()) continue;
    const t = (f as { type?: unknown }).type;
    out.push({
      label,
      type: (FIELD_TYPES as readonly unknown[]).includes(t) ? (t as ReportField["type"]) : "text",
    });
  }
  return out;
}

/**
 * 讀「常態工作規則」上設定的回報欄位。
 *
 * 舊版把查詢的 error 丟掉 —— 讀取失敗時 fields 停在空陣列，畫面顯示
 * 「此規則未設定回報欄位」，使用者以為是主管沒設定，其實是載入失敗。
 * 所以這裡把 error 一起交給呼叫端顯示。
 */
export function useReportFields(recurringRuleId: string | null | undefined, enabled = true) {
  const [fields, setFields] = useState<ReportField[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled || !recurringRuleId) return;
    let cancel = false;
    setLoading(true);
    setError(null);
    setLoaded(false);
    void (async () => {
      const { data, error: e } = await supabase
        .from("recurring_rule")
        .select("report_fields")
        .eq("id", recurringRuleId)
        .maybeSingle();
      if (cancel) return;
      setLoading(false);
      if (e) { setError(humanizeError(e, "載入回報欄位")); return; }
      setFields(normalizeFields(data?.report_fields));
      setLoaded(true);
    })();
    return () => { cancel = true; };
  }, [recurringRuleId, enabled]);

  return { fields, loading, error, loaded };
}

/**
 * 任務上已經有值、但規則裡已經被刪掉的欄位。
 * 主管改了回報欄位定義之後，舊任務填過的內容不該憑空從畫面上消失，
 * 所以另外撈出來只給檢視。
 */
export function orphanReportEntries(fields: ReportField[], values: ReportValues): [string, unknown][] {
  const known = new Set(fields.map((f) => f.label));
  return Object.entries(values ?? {}).filter(
    ([k, v]) => !known.has(k) && v !== null && v !== undefined && v !== "",
  );
}

export function formatReportValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "是" : "否";
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

/** 回報欄位的輸入區，看板的回報對話框與任務詳情共用同一份渲染 */
export function ReportFieldsForm({
  fields, values, onChange, disabled,
}: {
  fields: ReportField[];
  values: ReportValues;
  onChange: (label: string, value: unknown) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      {fields.map((f, i) => (
        <div key={`${f.label}-${i}`} className="space-y-1.5">
          <Label className="text-xs">{f.label}</Label>
          {f.type === "checkbox" ? (
            <div className="flex items-center gap-2">
              <Checkbox
                checked={!!values[f.label]}
                disabled={disabled}
                onCheckedChange={(v) => onChange(f.label, !!v)}
              />
              <span className="text-sm text-muted-foreground">是</span>
            </div>
          ) : (
            <Input
              type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
              disabled={disabled}
              value={(values[f.label] as string | number | undefined) ?? ""}
              onChange={(e) => onChange(f.label, e.target.value)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function RecurringReportDialog({
  open,
  onClose,
  taskId,
  recurringRuleId,
  initialData,
  alreadyDone,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  taskId: string;
  recurringRuleId: string;
  initialData?: Record<string, unknown> | null;
  /** 任務已經完成時預設不要再勾「標記為完成」，讓這個對話框也能單純檢視／修正內容 */
  alreadyDone?: boolean;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const { fields, loading: fieldsLoading, error: fieldsError } = useReportFields(recurringRuleId, open);
  const [values, setValues] = useState<ReportValues>({});
  const [valuesLoading, setValuesLoading] = useState(false);
  const [markDone, setMarkDone] = useState(!alreadyDone);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setMarkDone(!alreadyDone); }, [alreadyDone, open]);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    setValuesLoading(true);
    void (async () => {
      const { data } = await supabase.from("task").select("report_data").eq("id", taskId).maybeSingle();
      if (cancel) return;
      setValuesLoading(false);
      setValues(((data?.report_data as ReportValues) ?? (initialData as ReportValues)) ?? {});
    })();
    return () => { cancel = true; };
  }, [open, taskId, initialData]);

  const loading = fieldsLoading || valuesLoading;
  const orphans = orphanReportEntries(fields, values);

  const submit = async () => {
    setBusy(true);
    try {
      const patch: { report_data: ReportValues; status_id?: string; progress?: number } = {
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
      // 舊版沒有刷新任何 query：回報完（甚至標記完成）之後看板／我的工作還停在舊值，
      // 使用者以為沒存進去又按一次。
      void qc.invalidateQueries({ queryKey: ["eip", "tasks-full"] });
      void qc.invalidateQueries({ queryKey: ["eip", "my-owned"] });
      void qc.invalidateQueries({ queryKey: ["eip", "my-collab"] });
      void qc.invalidateQueries({ queryKey: ["eip", "my-created"] });
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
        ) : fieldsError ? (
          <div className="text-sm text-destructive py-4">回報欄位載入失敗：{fieldsError}</div>
        ) : fields.length === 0 && orphans.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4">此規則未設定回報欄位，可直接標記完成。</div>
        ) : (
          <div className="space-y-3">
            <ReportFieldsForm
              fields={fields}
              values={values}
              disabled={busy}
              onChange={(label, v) => setValues((s) => ({ ...s, [label]: v }))}
            />
            {orphans.length > 0 && (
              <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-1">
                <div className="text-[11px] text-muted-foreground">規則已移除的欄位（僅供檢視）</div>
                {orphans.map(([k, v]) => (
                  <div key={k} className="text-xs">
                    <span className="text-muted-foreground">{k}：</span>{formatReportValue(v)}
                  </div>
                ))}
              </div>
            )}
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
