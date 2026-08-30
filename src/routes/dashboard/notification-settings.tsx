import { createFileRoute } from "@tanstack/react-router";
import { RequirePerm } from "@/components/RequirePerm";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { BellRing, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { humanizeError } from "@/lib/eip-error";

export const Route = createFileRoute("/dashboard/notification-settings")({ component: () => (
    <RequirePerm module="eip_notification_settings">
      <Page />
    </RequirePerm>
  ) });

interface Setting {
  id: string;
  event_code: string;
  recipient_scopes: string[];
  in_app_enabled: boolean;
  line_enabled: boolean;
  is_active: boolean;
  department_id: string | null;
}
interface Dept { id: string; name: string; }
interface UserLite { id: string; name: string; department_id: string | null; }

const EVENT_LABEL: Record<string, string> = {
  task_assigned: "任務指派給我",
  task_status_changed: "任務狀態變更",
  recurring_due_soon: "常態工作即將到期",
  recurring_overdue: "常態工作逾期",
  announcement_published: "公告發布",
  meeting_invited: "會議邀請",
  worklog_submitted: "工作日誌送出",
  worklog_nudge: "催填工作日誌",
  quick_report_submitted: "請假 / 遲到 / 事件回報",
  leave_handover_created: "請假代辦建立",
  leave_handover_completed: "請假代辦完成",
  anomaly_opened: "異常缺失開立",
  anomaly_filled: "異常缺失已填報",
  anomaly_confirmed: "異常缺失已確認",
  anomaly_closed: "異常缺失結案",
  anomaly_overdue: "異常缺失逾期未填",
  direct_notify: "系統直接通知",
};

// direct_notify 的收件人由各功能程式自行指定，設部門覆寫沒有意義，故排除
const EVENT_CODES = Object.keys(EVENT_LABEL).filter((c) => c !== "direct_notify");

const SCOPES: { key: string; label: string }[] = [
  { key: "owner", label: "本人（負責人）" },
  { key: "deputy", label: "職務代理人" },
  { key: "dept_manager", label: "部門主管" },
  { key: "parent_dept_manager", label: "上層部門主管" },
  { key: "role:company_admin", label: "系統管理者" },
  { key: "all_company", label: "全公司" },
];

// 這三個事件的收件人是由呼叫端當場指定（eip_notification_recipients 的 p_extra_user_ids）：
// 公告＝發布對象、系統直接通知＝程式指定、會議邀請＝與會者。
// 它們的 recipient_scopes 本來就是空的，是正常設計，不可以被下面的檢查擋下來。
const SCOPELESS_BY_DESIGN = new Set(["announcement_published", "direct_notify", "meeting_invited"]);

const EMPTY_SETTINGS: Setting[] = [];

function Page() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const editable = can("eip_notification_settings", "edit");

  const { data: rowsData } = useQuery({
    queryKey: ["notification_setting_all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("notification_setting").select("*").order("event_code");
      if (error) throw error;
      return data as Setting[];
    },
  });
  const { data: depts = [] } = useQuery({
    queryKey: ["departments_min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("department").select("id,name").order("sort_order");
      if (error) throw error;
      return data as Dept[];
    },
  });
  const { data: users = [] } = useQuery({
    queryKey: ["appusers_min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_user").select("id,name,department_id").eq("status", "active").order("name");
      if (error) throw error;
      return data as UserLite[];
    },
  });
  // 注意：rows 必須是穩定參考，否則下方的 useEffect 會無限重跑（Maximum update depth exceeded）
  const rows = rowsData ?? EMPTY_SETTINGS;
  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? "未知人員";

  const defaults = useMemo(() => rows.filter((r) => !r.department_id), [rows]);
  const overrides = useMemo(() => rows.filter((r) => r.department_id), [rows]);
  const deptName = (id: string | null) => depts.find((d) => d.id === id)?.name ?? "—";

  const [draft, setDraft] = useState<Record<string, Setting>>({});
  useEffect(() => {
    const m: Record<string, Setting> = {};
    rows.forEach((r) => (m[r.id] = { ...r, recipient_scopes: [...(r.recipient_scopes ?? [])] }));
    setDraft(m);
  }, [rows]);

  const toggleScope = (id: string, scope: string) =>
    setDraft((d) => {
      const cur = d[id]; if (!cur) return d;
      const has = cur.recipient_scopes.includes(scope);
      return { ...d, [id]: { ...cur, recipient_scopes: has ? cur.recipient_scopes.filter((s) => s !== scope) : [...cur.recipient_scopes, scope] } };
    });
  const addUserScope = (id: string, uid: string) =>
    setDraft((d) => {
      const cur = d[id]; if (!cur) return d;
      const tok = `user:${uid}`;
      if (cur.recipient_scopes.includes(tok)) return d;
      return { ...d, [id]: { ...cur, recipient_scopes: [...cur.recipient_scopes, tok] } };
    });
  const removeScope = (id: string, tok: string) =>
    setDraft((d) => {
      const cur = d[id]; if (!cur) return d;
      return { ...d, [id]: { ...cur, recipient_scopes: cur.recipient_scopes.filter((s) => s !== tok) } };
    });
  const setFlag = (id: string, key: "in_app_enabled" | "line_enabled" | "is_active", v: boolean) =>
    setDraft((d) => (d[id] ? { ...d, [id]: { ...d[id], [key]: v } } : d));

  const save = async () => {
    const changed = rows.filter((r) => JSON.stringify(draft[r.id]) !== JSON.stringify({ ...r, recipient_scopes: [...(r.recipient_scopes ?? [])] }));
    if (changed.length === 0) { toast.info("沒有變更"); return; }

    // 收件範圍清空又還開著通知＝這個事件從此不會通知任何人，而且畫面上看不出來。
    // 三個「收件人由呼叫端指定」的事件除外（見 SCOPELESS_BY_DESIGN）。
    const emptied = changed.filter((r) => {
      const d = draft[r.id];
      return d.is_active && (d.in_app_enabled || d.line_enabled)
        && (d.recipient_scopes?.length ?? 0) === 0
        && !SCOPELESS_BY_DESIGN.has(r.event_code);
    });
    if (emptied.length > 0) {
      toast.error(
        `「${emptied.map((r) => EVENT_LABEL[r.event_code] ?? r.event_code).join("、")}」`
        + "沒有選任何收件範圍，這樣就不會通知到任何人。請至少選一個，或把該事件關掉。",
      );
      return;
    }

    const results = await Promise.all(changed.map((r) => {
      const d = draft[r.id];
      return supabase.from("notification_setting").update({
        recipient_scopes: d.recipient_scopes, in_app_enabled: d.in_app_enabled,
        line_enabled: d.line_enabled, is_active: d.is_active, updated_at: new Date().toISOString(),
      }).eq("id", r.id).select("id");
    }));
    const err = results.find((x) => x.error);
    if (err?.error) { toast.error(humanizeError(err.error, "儲存通知設定")); return; }
    // RLS 擋下時 PostgREST 回 0 列而不是錯誤，不驗筆數會把失敗說成成功
    const blocked = results.filter((x) => !x.data?.length).length;
    if (blocked > 0) {
      toast.error(`有 ${blocked} 筆沒有寫入（可能是權限不足），請重新整理後確認`);
      qc.invalidateQueries({ queryKey: ["notification_setting_all"] });
      return;
    }
    toast.success("已儲存"); qc.invalidateQueries({ queryKey: ["notification_setting_all"] });
  };

  // 新增部門覆寫
  const [ovEvent, setOvEvent] = useState(EVENT_CODES[0]);
  const [ovDept, setOvDept] = useState("");
  const addOverride = async () => {
    if (!ovDept) { toast.error("請選擇部門"); return; }
    const base = defaults.find((d) => d.event_code === ovEvent);
    const { error } = await supabase.from("notification_setting").insert({
      event_code: ovEvent, department_id: ovDept,
      recipient_scopes: base?.recipient_scopes ?? ["dept_manager"],
      in_app_enabled: base?.in_app_enabled ?? true,
      line_enabled: base?.line_enabled ?? false, is_active: true,
    });
    if (error) { toast.error(error.code === "23505" ? "此部門＋事件的覆寫已存在，請直接編輯那一筆" : humanizeError(error, "新增覆寫")); return; }
    toast.success("已新增覆寫"); qc.invalidateQueries({ queryKey: ["notification_setting_all"] });
  };
  const removeOverride = async (id: string) => {
    const { error } = await supabase.from("notification_setting").delete().eq("id", id);
    if (error) { toast.error(humanizeError(error, "移除覆寫")); return; }
    toast.success("已刪除"); qc.invalidateQueries({ queryKey: ["notification_setting_all"] });
  };

  const Row = ({ r, prefix }: { r: Setting; prefix?: string }) => {
    const d = draft[r.id] ?? r;
    const userTokens = d.recipient_scopes.filter((s) => s.startsWith("user:"));
    const inactive = !d.is_active;
    const canInteract = editable && !inactive;
    return (
      <div className={`grid grid-cols-[1fr_80px_80px_64px_40px] items-start gap-2 px-4 py-3 border-b last:border-b-0 transition-colors ${inactive ? "bg-muted/30" : ""}`}>
        <div className={`min-w-0 transition-opacity ${inactive ? "opacity-50" : ""}`}>
          <div className="text-sm font-medium mb-2 flex items-center gap-2">
            <BellRing className="w-3.5 h-3.5 text-muted-foreground" />
            {prefix && <span className="text-primary">{prefix}</span>}
            {EVENT_LABEL[r.event_code] ?? r.event_code}
            {inactive && <span className="text-[11.5px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border">已停用</span>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SCOPES.map((s) => {
              const on = d.recipient_scopes.includes(s.key);
              return (
                <button key={s.key} disabled={!canInteract} onClick={() => toggleScope(r.id, s.key)}
                  className={`text-[12.5px] px-2.5 py-1 rounded-full border transition-colors ${on ? "bg-primary/10 text-primary border-primary/40" : "bg-card text-muted-foreground hover:bg-accent/50"} ${canInteract ? "" : "opacity-70 cursor-not-allowed"}`}>
                  {s.label}
                </button>
              );
            })}
          </div>
          {/* 指定人員（除層級外，額外指定特定同仁也會收到） */}
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span className="text-[12.5px] text-muted-foreground shrink-0">指定人員：</span>
            {userTokens.length === 0 && <span className="text-[12.5px] text-muted-foreground/50">（無）</span>}
            {userTokens.map((tok) => (
              <span key={tok} className="inline-flex items-center gap-1 text-[12.5px] px-2 py-1 rounded-full border border-accent/50 bg-accent/20 text-foreground">
                {userName(tok.slice(5))}
                {canInteract && (
                  <button onClick={() => removeScope(r.id, tok)} className="text-muted-foreground hover:text-destructive" aria-label="移除">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            ))}
            {canInteract && (
              <select value="" onChange={(e) => { if (e.target.value) { addUserScope(r.id, e.target.value); } }}
                className="h-6 rounded-md border bg-card px-1 text-[12.5px] text-muted-foreground">
                <option value="">＋加入人員…</option>
                {users.filter((u) => !d.recipient_scopes.includes(`user:${u.id}`)).map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>
        <div className={`flex justify-center pt-1 ${inactive ? "opacity-50" : ""}`}><Toggle on={d.in_app_enabled} disabled={!canInteract} onClick={() => setFlag(r.id, "in_app_enabled", !d.in_app_enabled)} /></div>
        <div className={`flex justify-center pt-1 ${inactive ? "opacity-50" : ""}`}><Toggle on={d.line_enabled} disabled={!canInteract} onClick={() => setFlag(r.id, "line_enabled", !d.line_enabled)} /></div>
        <div className="flex justify-center pt-1"><Toggle on={d.is_active} disabled={!editable} onClick={() => setFlag(r.id, "is_active", !d.is_active)} /></div>
        <div className="flex justify-center pt-1">
          {r.department_id && editable ? (
            <button onClick={() => removeOverride(r.id)} className="text-muted-foreground hover:text-destructive" aria-label="刪除覆寫"><Trash2 className="w-4 h-4" /></button>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader title="通知設定" description="設定每個事件要通知哪些對象（依角色與部門層級，或指定特定人員），以及走站內或 LINE。"
        actions={editable ? <Button onClick={save}>儲存</Button> : undefined} />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground px-1">全公司預設</h2>
        <div className="rounded-xl border overflow-hidden">
          <div className="grid grid-cols-[1fr_80px_80px_64px_40px] items-center gap-2 px-4 py-2.5 bg-muted/50 text-xs text-muted-foreground border-b">
            <span>通知事件 / 接收對象</span><span className="text-center">站內</span><span className="text-center">LINE</span><span className="text-center">啟用</span><span />
          </div>
          {defaults.map((r) => <Row key={r.id} r={r} />)}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground px-1">部門覆寫（優先於全公司預設）</h2>
        {editable && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed p-3">
            <select value={ovEvent} onChange={(e) => setOvEvent(e.target.value)} className="h-9 rounded-md border bg-card px-2 text-sm">
              {EVENT_CODES.map((c) => <option key={c} value={c}>{EVENT_LABEL[c]}</option>)}
            </select>
            <select value={ovDept} onChange={(e) => setOvDept(e.target.value)} className="h-9 rounded-md border bg-card px-2 text-sm min-w-[140px]">
              <option value="">選擇部門…</option>
              {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <Button variant="outline" size="sm" onClick={addOverride}><Plus className="w-4 h-4 mr-1" /> 新增覆寫</Button>
          </div>
        )}
        {overrides.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1">尚無部門覆寫。未設定的部門一律套用全公司預設。</p>
        ) : (
          <div className="rounded-xl border overflow-hidden">
            <div className="grid grid-cols-[1fr_80px_80px_64px_40px] items-center gap-2 px-4 py-2.5 bg-muted/50 text-xs text-muted-foreground border-b">
              <span>部門 · 事件 / 接收對象</span><span className="text-center">站內</span><span className="text-center">LINE</span><span className="text-center">啟用</span><span />
            </div>
            {overrides.map((r) => <Row key={r.id} r={r} prefix={`[${deptName(r.department_id)}] `} />)}
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        「上層部門主管」依部門樹往上一層解析；「指定人員」可額外把特定同仁（不限直線主管）加入接收名單。LINE 已改為每天早上 08:00 彙整推播（每人一則）。編輯後記得按右上「儲存」。
      </p>
    </div>
  );
}

function Toggle({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} aria-pressed={on}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${on ? "bg-primary" : "bg-muted-foreground/30"} ${disabled ? "opacity-60 cursor-default" : ""}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
}
