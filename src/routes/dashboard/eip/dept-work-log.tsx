import { createFileRoute } from "@tanstack/react-router";
import { RequirePerm } from "@/components/RequirePerm";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ListChecks, Clock, Zap, RefreshCw, Check, Save, Users, Info } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { taipeiToday } from "@/lib/eip-routine";
import { humanizeError } from "@/lib/eip-error";
import { WorkLogItemText, WorkLogSourceBadge } from "@/components/eip/WorkLogSourceBadge";

// 主管檢視／編輯部屬工作日誌。
// 讀取與編輯的權限由後端 RLS 決定（work_log_read / work_log_update 已允許
// 「本人 or 部門主管 or 公司管理員」）；本頁只負責挑人、挑日期、顯示與批次儲存。
//
// 為什麼不共用工作日誌頁的「勾選即時存」RPC：eip_set_routine_item 是以 auth.uid()
// 找「自己」那天的日誌，主管拿它改部屬會改到自己頭上。所以本頁一律走 work_log
// 的整列 update（RLS 會擋非督導範圍），不打那支 RPC，也不做「附加檔案／刪除／送出」。

export const Route = createFileRoute("/dashboard/eip/dept-work-log")({
  component: () => (
    <RequirePerm module="eip_dept_work_log">
      <DeptWorkLogPage />
    </RequirePerm>
  ),
});

type Item = {
  text: string; done: boolean; note?: string;
  source?: string; ref_id?: string; link?: string; req?: boolean;
};
const arr = (v: unknown): Item[] => (Array.isArray(v) ? (v as Item[]) : []);

type Member = { user_id: string; name: string; department_id: string | null; department_name: string | null };
interface Log { id: string; morning: Item[]; afternoon: Item[]; special: Item[]; status: string; updated_at?: string | null }

function DeptWorkLogPage() {
  const { can } = useAuth();
  const canEdit = can("eip_dept_work_log", "edit");

  const [userId, setUserId] = useState<string>("");
  const [date, setDate] = useState<string>(taipeiToday());
  const [log, setLog] = useState<Log | null>(null);
  const [noLog, setNoLog] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 我可督導（可看日誌）的成員清單。走 SECURITY DEFINER RPC，內部用與 RLS 相同的
  // eip_is_dept_supervisor 判斷，確保「挑得到的人」＝「RLS 讓我讀得到的人」。
  const membersQ = useQuery({
    queryKey: ["eip", "worklog_supervised_members"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("eip_worklog_supervised_members");
      if (error) throw error;
      return (data ?? []) as Member[];
    },
  });
  const members = membersQ.data ?? [];

  // 預設選第一位成員
  useEffect(() => {
    if (!userId && members.length) setUserId(members[0].user_id);
  }, [members, userId]);

  const selected = members.find((m) => m.user_id === userId) ?? null;

  const load = async () => {
    if (!userId) { setLog(null); setNoLog(false); return; }
    setLoading(true);
    setLoadError(null);
    setNoLog(false);
    const { data, error } = await supabase.from("work_log").select("*")
      .eq("user_id", userId).eq("log_date", date).maybeSingle();
    if (error) { setLog(null); setLoadError(humanizeError(error)); setLoading(false); return; }
    if (data) {
      setLog({
        id: data.id,
        morning: arr(data.routine_morning),
        afternoon: arr(data.routine_afternoon),
        special: arr(data.special_items),
        status: data.status,
        updated_at: data.updated_at,
      });
    } else {
      setLog(null);
      setNoLog(true);
    }
    setLoading(false);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [userId, date]);

  const save = async () => {
    if (!log) return;
    setSaving(true);
    const { data, error } = await supabase.from("work_log")
      .update({
        routine_morning: log.morning,
        routine_afternoon: log.afternoon,
        special_items: log.special,
        updated_at: new Date().toISOString(),
      })
      .eq("id", log.id).select("*").maybeSingle();
    setSaving(false);
    if (error) { toast.error(humanizeError(error, "儲存")); return; }
    if (data) {
      setLog((l) => (l ? { ...l, updated_at: data.updated_at, status: data.status } : l));
    }
    toast.success("已儲存修改");
  };

  const editable = canEdit && !!log;

  return (
    <div className="space-y-5">
      <PageHeader title="部門日誌"
        description="檢視並可代為編輯所屬部門成員的工作日誌。變更後按「儲存修改」寫入；不提供刪除。"
        actions={
          <div className="flex items-center gap-2">
            <input type="date" value={date} max={taipeiToday()} onChange={(e) => setDate(e.target.value)}
              className="h-9 rounded-md border bg-card px-2 text-sm" />
            {date !== taipeiToday() && <Button variant="outline" size="sm" onClick={() => setDate(taipeiToday())}>今天</Button>}
          </div>
        } />

      {/* 成員挑選 */}
      <div className="rounded-2xl border bg-card p-4 shadow-sm flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Users className="w-4 h-4" /> 成員
        </span>
        {membersQ.isLoading ? (
          <span className="text-sm text-muted-foreground">載入成員中…</span>
        ) : members.length === 0 ? (
          <span className="text-sm text-muted-foreground">目前沒有可檢視的部屬（你尚未被設為任何部門的主管，或該部門沒有成員）。</span>
        ) : (
          <select value={userId} onChange={(e) => setUserId(e.target.value)}
            className="h-9 min-w-[220px] rounded-md border bg-card px-2 text-sm">
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name}{m.department_name ? `（${m.department_name}）` : ""}
              </option>
            ))}
          </select>
        )}
        {selected && <StatusBadge status={log?.status} />}
      </div>

      {membersQ.isError && (
        <ErrorBox msg={humanizeError(membersQ.error, "載入成員")} />
      )}

      {loadError && <ErrorBox msg={`${loadError}（請重新載入；若持續發生請重新登入）`} />}

      {selected && !loadError && (
        loading ? (
          <div className="h-40 rounded-2xl bg-muted/50 animate-pulse" />
        ) : noLog ? (
          <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">
            {selected.name} 在 {date} 尚未建立工作日誌。
            <div className="mt-1 text-xs">（日誌只能由本人建立，主管無法代為新增；可改看其他日期。）</div>
          </div>
        ) : log ? (
          <>
            {editable && (
              <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                <Info className="w-3.5 h-3.5 shrink-0" />
                你正在以主管身分編輯 {selected.name} 的日誌，變更會直接覆寫其內容，請謹慎修改。
              </div>
            )}
            <div className="grid gap-5 md:grid-cols-2 items-start">
              <Section title="上午例行" Icon={ListChecks} tone="primary" items={log.morning} editable={editable}
                onChange={(v) => setLog((l) => (l ? { ...l, morning: v } : l))} />
              <Section title="下午例行" Icon={Clock} tone="primary" items={log.afternoon} editable={editable}
                onChange={(v) => setLog((l) => (l ? { ...l, afternoon: v } : l))} />
              <div className="md:col-span-2">
                <Section title="特殊（突發）工作" Icon={Zap} tone="accent" items={log.special} editable={editable}
                  onChange={(v) => setLog((l) => (l ? { ...l, special: v } : l))} />
              </div>
            </div>
            {editable && (
              <div className="flex justify-end gap-2 rounded-2xl border bg-card/60 p-4 shadow-sm">
                <Button variant="outline" onClick={() => load()} disabled={saving}><RefreshCw className="w-4 h-4 mr-1.5" /> 還原</Button>
                <Button onClick={save} disabled={saving}><Save className="w-4 h-4 mr-1.5" /> 儲存修改</Button>
              </div>
            )}
            {!canEdit && (
              <p className="text-xs text-muted-foreground pl-1">你目前為唯讀檢視權限，如需編輯請聯絡系統管理者調整角色。</p>
            )}
          </>
        ) : null
      )}
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{msg}</div>
  );
}

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const map: Record<string, { t: string; c: string }> = {
    draft: { t: "草稿", c: "bg-muted text-muted-foreground" },
    submitted: { t: "已送出", c: "bg-accent/15 text-accent" },
  };
  const s = map[status] ?? map.draft;
  return <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${s.c}`}>{s.t}</span>;
}

function Section({ title, Icon, tone, items, editable, onChange }: {
  title: string; Icon: typeof Zap; tone: "primary" | "accent"; items: Item[]; editable: boolean;
  onChange: (v: Item[]) => void;
}) {
  const [text, setText] = useState("");
  const add = () => { const t = text.trim(); if (!t) return; onChange([...items, { text: t, done: false, note: "" }]); setText(""); };
  const setItem = (i: number, patch: Partial<Item>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const toneCls = tone === "accent" ? "bg-accent/15 text-accent" : "bg-primary/10 text-primary";
  return (
    <div className="h-full rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2.5 mb-4 pb-3 border-b border-border/70">
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${toneCls}`}><Icon className="w-4.5 h-4.5" /></span>
        <span className="text-base font-semibold tracking-tight">{title}</span>
        <span className="ml-auto text-xs font-semibold text-muted-foreground bg-muted rounded-full px-2.5 py-1 tabular">{items.length}</span>
      </div>
      {items.length === 0 && <div className="text-sm text-muted-foreground mb-3 pl-1">尚無項目</div>}
      <ul className="space-y-1 mb-3">
        {items.map((it, i) => (
          <li key={i} className="group rounded-lg hover:bg-muted/40 px-2 py-1.5">
            <div className="flex items-center gap-2 text-sm">
              <button type="button" disabled={!editable}
                title={editable ? (it.done ? "取消勾選" : "勾選＝當天有做") : undefined}
                onClick={() => editable && setItem(i, { done: !it.done })}
                className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${it.done ? "bg-primary border-primary text-primary-foreground" : "bg-card"} ${editable ? "" : "opacity-70"}`}>
                {it.done && <Check className="w-3 h-3" />}
              </button>
              {editable ? (
                <input value={it.text} onChange={(e) => setItem(i, { text: e.target.value })}
                  className={`flex-1 bg-transparent outline-none border-b border-transparent focus:border-border ${it.done ? "line-through text-muted-foreground" : ""}`} />
              ) : (
                <WorkLogItemText text={it.text} done={it.done} source={it.source} refId={it.ref_id} />
              )}
              <WorkLogSourceBadge source={it.source} refId={it.ref_id} />
              {it.req && <span className="text-[11.5px] px-1 text-amber-600 shrink-0" title="需填執行內容">需填</span>}
            </div>
            {editable ? (
              <textarea value={it.note ?? ""} rows={1} placeholder="執行內容…"
                onChange={(e) => setItem(i, { note: e.target.value })}
                className="mt-1 ml-6 block w-[calc(100%-1.75rem)] resize-y rounded-md bg-transparent px-1 py-0.5 text-xs text-muted-foreground outline-none border border-transparent hover:border-border/60 focus:border-border" />
            ) : (
              it.note ? <p className="mt-0.5 ml-6 text-xs text-muted-foreground whitespace-pre-wrap">{it.note}</p> : null
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <div className="flex gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="新增項目…"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} className="h-8 text-sm" />
          <Button variant="outline" size="sm" onClick={add} className="h-8">新增</Button>
        </div>
      )}
    </div>
  );
}
