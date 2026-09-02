import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { humanizeError } from "@/lib/eip-error";

/** 常態工作規則（recurring_rule.report_fields）設定的結構化回報欄位 */
export type ReportField = {
  label: string;
  type: "text" | "checkbox" | "number" | "date";
};

/** 任務上的回報內容（task.report_data），key = 欄位名稱 */
export type ReportValues = Record<string, unknown>;

const FIELD_TYPES = ["text", "checkbox", "number", "date"] as const;

/** report_fields 是 jsonb，正式庫可能有舊格式或缺 type 的資料，一律收斂成可渲染的形狀 */
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
      if (e) {
        setError(humanizeError(e, "載入回報欄位"));
        return;
      }
      setFields(normalizeFields(data?.report_fields));
      setLoaded(true);
    })();
    return () => {
      cancel = true;
    };
  }, [recurringRuleId, enabled]);

  return { fields, loading, error, loaded };
}

/**
 * 任務上已經有值、但規則裡已經被刪掉的欄位。
 * 主管改了回報欄位定義之後，舊任務填過的內容不該憑空從畫面上消失，
 * 所以另外撈出來只給檢視。
 */
export function orphanReportEntries(
  fields: ReportField[],
  values: ReportValues,
): [string, unknown][] {
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
