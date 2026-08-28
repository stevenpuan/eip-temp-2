import { createFileRoute } from "@tanstack/react-router";
import { RequirePerm } from "@/components/RequirePerm";
import { useEffect, useState, type ReactNode } from "react";
import { Plus, X, Check, Send, ListChecks, Clock, Zap, Inbox, Search, RefreshCw, Trash2, Paperclip, Download, UploadCloud, ChevronDown, History } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useEipUser } from "@/lib/eip-user";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { toggleRoutineItem, type RoutineSection } from "@/lib/eip-routine";
import { humanizeError } from "@/lib/eip-error";
import { WorkLogItemText, WorkLogSourceBadge } from "@/components/eip/WorkLogSourceBadge";

// 2026-08-17 依客戶要求隱藏「獨立網址／NAS 連結」欄；網址請直接貼在說明／執行內容欄。
// 既有連結資料保留於資料庫不刪，要恢復顯示只需把下方旗標改為 true。
const SHOW_URL_LINK_FIELD = false;

// 2026-08-18 工作日誌目前僅本人可見（連單位主管都看不到），「附加檔案」功能先隱藏。
// 元件（Attachments）與後端 work_log_attachment 表、storage bucket 皆保留不動，
// 之後要開放只要把下方旗標改回 true 即可。
const SHOW_ATTACHMENTS = false;

export const Route = createFileRoute("/dashboard/eip/work-log")({ component: () => (
    <RequirePerm module="eip_work_log">
      <WorkLogPage />
    </RequirePerm>
  ) });

type Item = {
  text: string; done: boolean; note?: string;
  /** 來源（由 eip_worklog_seed 帶入）：personal_routine / recurring / task / meeting_action */
  source?: string;
  /** 來源紀錄 id，與 source 合起來當去重鍵 */
  ref_id?: string;
  link?: string;
  /** 是否要求填寫執行內容（來自個人例行範本 require_content） */
  req?: boolean;
};
/** 去重鍵：有來源用 source+ref_id，手動新增的項目退回比對文字 */
const itemKey = (x: Item) => (x.source && x.ref_id ? `${x.source}:${x.ref_id}` : `text:${(x.text ?? "").trim()}`);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const arr = (v: unknown): Item[] => (Array.isArray(v) ? (v as Item[]) : []);

interface Log { id?: string; log_date: string; morning: Item[]; afternoon: Item[]; special: Item[]; status: string; }

// 建立某天的預設內容：一律走 DB 的 eip_worklog_seed，避免前後端各寫一套規則。
//   上午例行 = 個人例行範本(morning/allday) + 當日常態工作
//   下午例行 = 個人例行範本(afternoon)
//   特殊     = 我負責/協作且未完成的任務 + 今日完成的任務 + 未結案會議決議
async function fetchSeed(uid: string, date: string): Promise<{ morning: Item[]; afternoon: Item[]; special: Item[] }> {
  const { data, error } = await supabase.rpc("eip_worklog_seed", { p_user_id: uid, p_date: date });
  if (error) { toast.error(humanizeError(error, "帶入")); return { morning: [], afternoon: [], special: [] }; }
  const d = (data ?? {}) as Record<string, unknown>;
  return { morning: arr(d.morning), afternoon: arr(d.afternoon), special: arr(d.special) };
}

function WorkLogPage() {
  const { appUser } = useEipUser();
  const { can } = useAuth();
  const canCreate = can("eip_work_log", "create");
  const canEdit = can("eip_work_log", "edit");
  const canExport = can("eip_work_log", "export");
  const [date, setDate] = useState(today());
  const [log, setLog] = useState<Log | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    if (!appUser?.id) return;
    setLoading(true);
    setLoadError(null);
    // 先確實檢查 error：token 過期(PGRST301)、RLS、斷線時 data 會是 null，
    // 若不分辨錯誤就落到 fetchSeed，會顯示一張空白草稿讓使用者誤以為日誌不見了。
    const { data, error } = await supabase.from("work_log").select("*").eq("user_id", appUser.id).eq("log_date", date).maybeSingle();
    if (error) {
      setLog(null);
      setLoadError(humanizeError(error));
      setLoading(false);
      return;
    }
    if (data) {
      // 舊資料（改造前）全部塞在 routine_morning、routine_afternoon 為空；
      // 照原欄位讀進來顯示結果與改造前一致，不需要資料遷移。
      setLog({ id: data.id, log_date: date, morning: arr(data.routine_morning), afternoon: arr(data.routine_afternoon), special: arr(data.special_items), status: data.status });
    } else {
      // 確認查詢成功、只是今天還沒有日誌，才給空白 seed 草稿。
      const seed = await fetchSeed(appUser.id, date);
      setLog({ log_date: date, morning: seed.morning, afternoon: seed.afternoon, special: seed.special, status: "draft" });
    }
    setLoading(false);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [appUser?.id, date, refreshKey]);

  // override：明確指定要落地的三區內容。勾選是即時的，但 setLog 是非同步的，
  // 若 persist 直接讀 log.*（closure 內是勾選前的舊值）就會把剛勾的狀態存錯，
  // 所以 toggleDone 會把「勾選後」的三區算好傳進來。其餘呼叫者不帶＝沿用現有 state。
  const persist = async (
    patch: { status?: string; submitted_at?: string },
    msg?: string,
    override?: { morning: Item[]; afternoon: Item[]; special: Item[] },
  ) => {
    if (!appUser?.id || !log) return undefined;
    const morning = override?.morning ?? log.morning;
    const afternoon = override?.afternoon ?? log.afternoon;
    const special = override?.special ?? log.special;
    // 送出前擋下「需填執行內容」且已勾選、卻沒寫說明的項目
    if (patch.status === "submitted") {
      const missing = [...morning, ...afternoon, ...special]
        .filter((x) => x.req && x.done && !(x.note ?? "").trim()).map((x) => x.text);
      if (missing.length) { toast.error(`這些項目需填執行內容：${missing.join("、")}`); return undefined; }
      if (SHOW_URL_LINK_FIELD) {
        const badLink = [...morning, ...afternoon, ...special]
          .filter((x) => (x.link ?? "").trim() && !/^(https?:\/\/|file:\/\/|\\\\)/.test((x.link ?? "").trim()))
          .map((x) => x.text);
        if (badLink.length) {
          toast.error(`這些項目的連結格式不對（請用 http(s)://、file:// 或 \\伺服器\分享資料夾）：${badLink.join("、")}`);
          return undefined;
        }
      }
    }
    setSaving(true);
    const body: any = {
      user_id: appUser.id, department_id: appUser.department_id, log_date: date,
      routine_morning: morning, routine_afternoon: afternoon, special_items: special,
      status: log.status, ...patch, updated_at: new Date().toISOString(),
    };
    // 這一天可能已被別的路徑（我的工作區勾選、eip_set_routine_item）建立過，
    // 前端 state 沒有 id 就直接 insert 會撞 work_log_tenant_id_user_id_log_date_key。
    let targetId = log.id;
    if (!targetId) {
      const { data: exist } = await supabase.from("work_log").select("id")
        .eq("user_id", appUser.id).eq("log_date", date).maybeSingle();
      targetId = exist?.id;
    }
    let res;
    if (targetId) res = await supabase.from("work_log").update(body).eq("id", targetId).select("*").maybeSingle();
    else res = await supabase.from("work_log").insert(body).select("*").maybeSingle();
    setSaving(false);
    if (res.error) { toast.error(humanizeError(res.error, "儲存日誌")); return undefined; }

    if (res.data) setLog((l) => (l ? { ...l, id: res.data.id, status: res.data.status } : l));
    setRefreshKey((k) => k + 1);
    if (msg) toast.success(msg);
    return res.data?.id as string | undefined;
  };

  /**
   * 勾選「今天有做」——立即寫進 DB。
   *
   * 原本勾選只改前端 state，要按「儲存草稿」才進 DB：使用者勾完直接關掉，
   * 資料就沒了，部門例行彙總與績效也讀不到。現在走 eip_toggle_routine_item，
   * 跟「我的工作區」共用同一份寫入實作（見 src/lib/eip-routine.ts）。
   *
   * 兩種情況不能走 RPC、要改用整份 persist 落地（RPC 是照 source+ref_id／text
   * 去 DB 現有 jsonb 裡找那一項，找不到會拋「在『…』找不到這個項目」）：
   *   1. 今天還沒有 DB 列（!log.id）——整份建草稿。
   *   2. 這一項是剛用「同步今日任務」帶進來、或手動新增、還沒按儲存的項目——
   *      DB 的 special_items 裡根本沒有它，RPC 一定找不到。改抓 RPC 的錯回退整份存。
   */
  const toggleDone = async (section: RoutineSection, idx: number) => {
    if (!log) return;
    const list = section === "morning" ? log.morning : section === "afternoon" ? log.afternoon : log.special;
    const it = list[idx];
    if (!it) return;
    const next = !it.done;
    const setDone = (v: boolean) =>
      setLog((l) => {
        if (!l) return l;
        const patch = (xs: Item[]) => xs.map((x, j) => (j === idx ? { ...x, done: v } : x));
        if (section === "morning") return { ...l, morning: patch(l.morning) };
        if (section === "afternoon") return { ...l, afternoon: patch(l.afternoon) };
        return { ...l, special: patch(l.special) };
      });
    // 明確算出「勾選後」的三區，交給 persist 落地——不能等 setDone 後再讓 persist 讀 log.*，
    // setLog 是非同步的，closure 裡還是勾選前的舊值，會把剛勾的狀態存回去（存錯）。
    const withDone = (v: boolean) => {
      const patch = (xs: Item[]) => xs.map((x, j) => (j === idx ? { ...x, done: v } : x));
      return {
        morning: section === "morning" ? patch(log.morning) : log.morning,
        afternoon: section === "afternoon" ? patch(log.afternoon) : log.afternoon,
        special: section === "special" ? patch(log.special) : log.special,
      };
    };
    const toggled = withDone(next);

    setDone(next);
    if (!log.id) {
      // persist 會把整份（含這次勾選）寫進去，不需要再打 RPC
      const newId = await persist({}, undefined, toggled);
      if (!newId) setDone(it.done);
      return;
    }
    try {
      await toggleRoutineItem({
        date, section, done: next,
        source: it.source, refId: it.ref_id, text: it.text,
      });
    } catch (e) {
      // DB 有這一天的日誌、但找不到這一項＝畫面上是還沒存進 DB 的新項目
      //（剛「同步今日任務」帶入或手動新增）。改用整份 persist 落地（已含這次勾選）；
      // persist 也失敗才還原勾選並顯示錯誤。
      const newId = await persist({}, undefined, toggled);
      if (!newId) { setDone(it.done); toast.error(humanizeError(e, "更新")); }
    }
  };

  const deleteLog = async (id?: string, d?: string) => {
    const targetId = id ?? log?.id;
    if (!targetId) { toast.info("此日誌尚未儲存，無需刪除"); return; }
    if (!window.confirm("確定刪除這篇日誌？此動作無法復原。")) return;
    setSaving(true);
    const { error } = await supabase.from("work_log").delete().eq("id", targetId);
    setSaving(false);
    if (error) { toast.error(humanizeError(error, "刪除日誌")); return; }
    toast.success("已刪除日誌");
    setRefreshKey((k) => k + 1);
    if (d && d !== date) setRefreshKey((k) => k + 1);
  };

  const syncToday = async () => {
    if (!appUser?.id || !log) return;
    const seed = await fetchSeed(appUser.id, date);
    // 跨三區一起比對，避免例行項目換了時段後在兩區各出現一次
    const seen = new Set([...log.morning, ...log.afternoon, ...log.special].map(itemKey));
    const take = (list: Item[]) => {
      const out: Item[] = [];
      list.forEach((x) => { const k = itemKey(x); if (!seen.has(k)) { seen.add(k); out.push(x); } });
      return out;
    };
    const addM = take(seed.morning), addA = take(seed.afternoon), addS = take(seed.special);
    const n = addM.length + addA.length + addS.length;
    if (!n) { toast.info("沒有可帶入的新項目"); return; }
    setLog((l) => (l ? { ...l, morning: [...l.morning, ...addM], afternoon: [...l.afternoon, ...addA], special: [...l.special, ...addS] } : l));
    toast.success(`已帶入 ${n} 筆，記得按儲存或送出`);
  };

  if (loadError) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-sm">
          <div className="font-medium text-destructive mb-1">工作日誌載入失敗</div>
          <div className="text-muted-foreground mb-3">{loadError}（資料並未遺失，請重新載入；若持續發生請重新登入）</div>
          <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)}>
            <RefreshCw className="mr-1 h-4 w-4" />重新載入
          </Button>
        </div>
      </div>
    );
  }
  if (loading || !log) {
    return <div className="space-y-3"><div className="h-9 w-40 rounded-md bg-muted/50 animate-pulse" /><div className="h-56 rounded-2xl bg-muted/50 animate-pulse" /></div>;
  }
  const editable = log.id ? canEdit : canCreate; // 具對應權限即可編輯（2026-07-28 起取消鎖定機制）
  const submitted = log.status === "submitted";

  return (
    <div className="space-y-6">
      <PageHeader title="工作日誌" description="勾選「今天有做」會立即存檔；項目文字與執行內容要按儲存才會寫入。送出後仍可撤回修改，不需主管簽核。"
        actions={
          <div className="flex items-center gap-2">
            <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className="h-9 rounded-md border bg-card px-2 text-sm" />
            {date !== today() && <Button variant="outline" size="sm" onClick={() => setDate(today())}>今天</Button>}
            <StatusBadge status={log.status} />
          </div>
        } />

      <div className="grid gap-5 md:grid-cols-2 items-start">
        <Section title="上午例行" Icon={ListChecks} tone="primary" items={log.morning} editable={editable} onChange={(v) => setLog((l) => (l ? { ...l, morning: v } : l))} onToggleDone={(i) => void toggleDone("morning", i)} />
        <Section title="下午例行" Icon={Clock} tone="primary" items={log.afternoon} editable={editable} onChange={(v) => setLog((l) => (l ? { ...l, afternoon: v } : l))} onToggleDone={(i) => void toggleDone("afternoon", i)} />
        <div className="md:col-span-2">
          <Section title="特殊（突發）工作" Icon={Zap} tone="accent" items={log.special} editable={editable} onChange={(v) => setLog((l) => (l ? { ...l, special: v } : l))} onToggleDone={(i) => void toggleDone("special", i)} />
        </div>
      </div>

      {editable && (
        <div className="flex justify-between gap-3 flex-wrap rounded-2xl border bg-card/60 p-4 shadow-sm">
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={syncToday} disabled={saving}><RefreshCw className="w-4 h-4 mr-1.5" /> 同步今日任務</Button>
            {log.id && <Button variant="outline" onClick={() => deleteLog()} disabled={saving} className="text-destructive hover:text-destructive"><Trash2 className="w-4 h-4 mr-1.5" /> 刪除</Button>}
          </div>
          <div className="flex gap-2">
            {submitted ? (
              <>
                <Button variant="outline" onClick={() => persist({ status: "draft" }, "已撤回為草稿")} disabled={saving}>撤回為草稿</Button>
                <Button onClick={() => persist({}, "已儲存修改")} disabled={saving}><Check className="w-4 h-4 mr-1.5" /> 儲存修改</Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => persist({}, "已儲存草稿")} disabled={saving}>儲存草稿</Button>
                <Button onClick={() => persist({ status: "submitted", submitted_at: new Date().toISOString() }, "已送出")} disabled={saving}><Send className="w-4 h-4 mr-1.5" /> 送出</Button>
              </>
            )}
          </div>
        </div>
      )}

      {/* 附加檔案（2026-08-18 先隱藏，見檔頭 SHOW_ATTACHMENTS） */}
      {SHOW_ATTACHMENTS && (log.id ? (
        <Collapsible title="附加檔案" Icon={Paperclip} defaultOpen={false}>
          <Attachments workLogId={log.id} canEdit={editable} />
        </Collapsible>
      ) : (
        <p className="text-xs text-muted-foreground pl-1">附加檔案：請先按「儲存草稿」後即可上傳 PDF／Word／Excel／圖片。</p>
      ))}

      <Collapsible title="我的日誌記錄" Icon={History} defaultOpen={false}>
        <MyHistory meId={appUser!.id} activeDate={date} onPick={(d) => setDate(d)} onDelete={(id, d) => deleteLog(id, d)} refreshKey={refreshKey} />
      </Collapsible>

    </div>
  );
}

// 可收合區塊
function Collapsible({ title, Icon, children, defaultOpen = false, tone, badge }: {
  title: string; Icon?: typeof Zap; children: ReactNode; defaultOpen?: boolean; tone?: "primary" | "accent"; badge?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const iconCls = tone === "primary" ? "text-primary" : tone === "accent" ? "text-accent" : "text-muted-foreground";
  return (
    <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-5 py-4 hover:bg-muted/40 transition-colors text-left">
        {Icon && <Icon className={`w-4 h-4 shrink-0 ${iconCls}`} />}
        <span className="text-base font-semibold flex-1 tracking-tight">{title}</span>
        {badge}
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-5 pb-5 pt-4 border-t">{children}</div>}
    </div>
  );
}

function Section({ title, Icon, tone, items, editable, onChange, onToggleDone }: {
  title: string; Icon: typeof Zap; tone: "primary" | "accent"; items: Item[]; editable: boolean;
  onChange: (v: Item[]) => void;
  /** 勾選走 DB 的唯一寫入實作（立即存），不經 onChange 的批次儲存 */
  onToggleDone: (index: number) => void;
}) {
  const [text, setText] = useState("");
  const add = () => { const t = text.trim(); if (!t) return; onChange([...items, { text: t, done: false, note: "" }]); setText(""); };
  const setItem = (i: number, patch: Partial<Item>) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const toneCls = tone === "accent" ? "bg-accent/15 text-accent" : "bg-primary/10 text-primary";
  return (
    <div className="h-full rounded-2xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md">
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
                title={it.done ? "取消勾選（立即儲存）" : "勾選＝今天有做（立即儲存）"}
                onClick={() => onToggleDone(i)}
                className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${it.done ? "bg-primary border-primary text-primary-foreground" : "bg-card"}`}>
                {it.done && <Check className="w-3 h-3" />}
              </button>
              {editable ? (
                <input value={it.text}
                  onChange={(e) => setItem(i, { text: e.target.value })}
                  className={`flex-1 bg-transparent outline-none border-b border-transparent focus:border-border ${it.done ? "line-through text-muted-foreground" : ""}`} />
              ) : (
                <WorkLogItemText text={it.text} done={it.done} source={it.source} refId={it.ref_id} />
              )}
              <WorkLogSourceBadge source={it.source} refId={it.ref_id} />
              {it.req && <span className="text-[11.5px] px-1 text-amber-600 shrink-0" title="需填執行內容">需填</span>}
              {editable && (
                <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-muted-foreground/50 hover:text-destructive opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0"><X className="w-3.5 h-3.5" /></button>
              )}
            </div>
            {editable ? (
              <>
                <textarea value={it.note ?? ""} rows={1} placeholder={it.req ? "執行內容（送出前必填）…" : "執行內容（選填）…"}
                  onChange={(e) => setItem(i, { note: e.target.value })}
                  className="mt-1 ml-6 block w-[calc(100%-1.75rem)] resize-y rounded-md bg-transparent px-1 py-0.5 text-xs text-muted-foreground outline-none border border-transparent hover:border-border/60 focus:border-border" />
                {/* 相關檔案連結（訪談定案第 5 條）。與項目文字一樣走「儲存」批次寫入，
                    不即時打 API —— 一邊打字一邊送出會很吵。 */}
                {SHOW_URL_LINK_FIELD && (
                  <input value={it.link ?? ""} placeholder="相關連結（選填）：\\NAS\… 或 https://…"
                    onChange={(e) => setItem(i, { link: e.target.value })}
                    className="mt-0.5 ml-6 block w-[calc(100%-1.75rem)] rounded-md bg-transparent px-1 py-0.5 text-[12.5px] font-mono text-muted-foreground outline-none border border-transparent hover:border-border/60 focus:border-border" />
                )}
              </>
            ) : (
              <>
                {it.note ? <p className="mt-0.5 ml-6 text-xs text-muted-foreground whitespace-pre-wrap">{it.note}</p> : null}
                {SHOW_URL_LINK_FIELD && it.link ? (
                  it.link.startsWith("\\\\") ? (
                    <p className="mt-0.5 ml-6 text-[12.5px] font-mono text-muted-foreground break-all">{it.link}</p>
                  ) : (
                    <a href={it.link} target="_blank" rel="noopener noreferrer"
                      className="mt-0.5 ml-6 block text-[12.5px] text-primary hover:underline break-all">{it.link}</a>
                  )
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <div className="flex gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="新增項目…"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} className="h-8 text-sm" />
          <Button variant="outline" size="sm" onClick={add} className="h-8"><Plus className="w-4 h-4" /></Button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { t: string; c: string }> = {
    draft: { t: "草稿", c: "bg-muted text-muted-foreground" },
    submitted: { t: "已送出", c: "bg-accent/15 text-accent" },
  };
  const s = map[status] ?? map.draft;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${s.c}`}>{s.t}</span>
    </span>
  );
}

const txtOf = (r: any) => [...arr(r.routine_morning), ...arr(r.routine_afternoon), ...arr(r.special_items)].map((x) => `${x.text} ${x.note ?? ""}`).join(" ");
const cntOf = (r: any) => arr(r.routine_morning).length + arr(r.routine_afternoon).length + arr(r.special_items).length;

// 我的日誌記錄：預設本月，可切月份、篩狀態、搜尋
function MyHistory({ meId, activeDate, onPick, onDelete, refreshKey }: { meId: string; activeDate: string; onPick: (d: string) => void; onDelete: (id: string, d: string) => void; refreshKey: number }) {
  const [month, setMonth] = useState(today().slice(0, 7));
  const [q, setQ] = useState("");
  const [st, setSt] = useState("all");
  const [rows, setRows] = useState<any[]>([]);
  // loadErr：原本沒有接 error，token 過期或 RLS 變動時 data 是 null → rows=[] →
  // 畫面顯示「此月份沒有任何日誌」，使用者會以為自己的日誌被刪光了。
  const [loadErr, setLoadErr] = useState<string | null>(null);
  useEffect(() => {
    // alive：快速切換月份時，先發後到的舊回應不可以蓋掉新月份的結果
    let alive = true;
    (async () => {
      const [y, m] = month.split("-").map(Number);
      const start = `${month}-01`;
      // eslint-disable-next-line no-restricted-syntax -- Date.UTC 與 toISOString 皆為 UTC、彼此一致，用來算「次月一號」當獨佔上界，不受時區影響
      const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
      const { data, error } = await supabase.from("work_log")
        .select("id,log_date,status,routine_morning,routine_afternoon,special_items")
        .eq("user_id", meId).gte("log_date", start).lt("log_date", end).order("log_date", { ascending: false });
      if (!alive) return;
      if (error) { setLoadErr(humanizeError(error, "載入日誌記錄")); setRows([]); return; }
      setLoadErr(null);
      setRows(data ?? []);
    })();
    return () => { alive = false; };
  }, [meId, month, refreshKey]);
  const filtered = rows.filter((r) => (st === "all" || r.status === st) && (!q || txtOf(r).toLowerCase().includes(q.toLowerCase())));
  const hasFilter = st !== "all" || !!q;
  const stLabel = st === "draft" ? "草稿" : st === "submitted" ? "已送出" : "";
  return (
    <div className="space-y-2 pt-2">
      <div className="flex items-center gap-2 flex-wrap">
        <input type="month" value={month} max={today().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} className="h-8 rounded-md border bg-card px-2 text-xs" />
        <select value={st} onChange={(e) => setSt(e.target.value)} className="h-8 rounded-md border bg-card px-2 text-xs">
          <option value="all">全部狀態</option><option value="draft">草稿</option><option value="submitted">已送出</option>
        </select>
        <div className="relative flex-1 min-w-[140px]">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋內容…" className="h-8 w-full rounded-md border bg-card pl-7 pr-2 text-xs" />
        </div>
        {hasFilter && (
          <button onClick={() => { setSt("all"); setQ(""); }} className="text-xs text-primary hover:underline">清除篩選</button>
        )}
      </div>
      {loadErr ? (
        <p className="text-xs text-destructive px-1">載入失敗：{loadErr}（這不代表日誌不存在，請重新整理後再試）</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground px-1">
          {rows.length === 0
            ? "此月份沒有任何日誌。"
            : hasFilter
              ? <>此月份共 {rows.length} 筆日誌，但沒有符合目前篩選條件（{stLabel && `狀態：${stLabel}`}{stLabel && q ? "、" : ""}{q && `關鍵字：「${q}」`}）的資料。</>
              : "此月份沒有符合的日誌。"}
        </p>
      ) : (
        <div className="rounded-2xl border overflow-hidden bg-card">
          {filtered.map((r) => (
            <div key={r.id} className={`group flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 text-sm hover:bg-accent/40 transition-colors ${r.log_date === activeDate ? "bg-primary/5" : ""}`}>
              <button onClick={() => onPick(r.log_date)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                <span className="font-medium tabular-nums shrink-0">{r.log_date}</span>
                <span className="text-xs text-muted-foreground flex-1 text-left truncate">{cntOf(r)} 個項目</span>
              </button>
              <StatusBadge status={r.status} />
              <button onClick={() => onDelete(r.id, r.log_date)} title="刪除此日誌"
                className="text-muted-foreground/40 hover:text-destructive opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 工作日誌附加檔案（PDF／Word／Excel／圖片；本人可上傳/刪除、部門主管可檢視下載）
function Attachments({ workLogId, canEdit }: { workLogId: string; canEdit: boolean }) {
  const [files, setFiles] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const { data } = await supabase.from("work_log_attachment").select("*").eq("work_log_id", workLogId).order("created_at");
    setFiles(data ?? []);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [workLogId]);

  const onPick = async (e: any) => {
    const list: FileList | null = e.target.files;
    if (!list || !list.length) return;
    setBusy(true);
    let ok = 0;
    for (const f of Array.from(list)) {
      if (f.size > 10 * 1024 * 1024) { toast.error(`${f.name} 超過 10MB`); continue; }
      const path = `${workLogId}/${crypto.randomUUID()}`;
      const up = await supabase.storage.from("worklog").upload(path, f, { contentType: f.type || undefined, upsert: false });
      if (up.error) { toast.error(`${f.name}：${humanizeError(up.error, "上傳")}`); continue; }
      const ins = await supabase.from("work_log_attachment").insert({
        work_log_id: workLogId, file_name: f.name, storage_path: path, mime_type: f.type || null, file_size: f.size,
      });
      if (ins.error) { toast.error(`${f.name}：${humanizeError(ins.error, "登錄附件")}`); await supabase.storage.from("worklog").remove([path]); continue; }
      ok += 1;
    }
    setBusy(false); e.target.value = "";
    if (ok) toast.success(`已上傳 ${ok} 個檔案`);
    void load();
  };

  const download = async (a: any) => {
    const { data, error } = await supabase.storage.from("worklog").createSignedUrl(a.storage_path, 60);
    if (error) { toast.error(humanizeError(error, "下載")); return; }
    // 同分頁開啟：避免手機在 await 後攔截 window.open 彈窗
    if (data?.signedUrl) window.location.href = data.signedUrl;
  };
  const remove = async (a: any) => {
    if (!window.confirm(`刪除附件「${a.file_name}」？`)) return;
    await supabase.storage.from("worklog").remove([a.storage_path]);
    const { error } = await supabase.from("work_log_attachment").delete().eq("id", a.id);
    if (error) { toast.error(humanizeError(error, "刪除附件")); return; }
    void load();
  };
  const fmtSize = (n?: number) => !n ? "" : n < 1024 ? `${n}B` : n < 1048576 ? `${(n / 1024).toFixed(0)}KB` : `${(n / 1048576).toFixed(1)}MB`;

  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Paperclip className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-semibold">附加檔案</span>
        <span className="text-xs text-muted-foreground">（PDF／Word／Excel／圖片，單檔 ≤10MB）</span>
        {canEdit && (
          <label className="ml-auto">
            <input type="file" multiple className="hidden" disabled={busy}
              accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" onChange={onPick} />
            <span className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border cursor-pointer hover:bg-accent/50 ${busy ? "opacity-50 pointer-events-none" : ""}`}>
              <UploadCloud className="w-4 h-4" /> {busy ? "上傳中…" : "上傳檔案"}
            </span>
          </label>
        )}
      </div>
      {files.length === 0 ? (
        <p className="text-xs text-muted-foreground pl-1">尚無附件</p>
      ) : (
        <ul className="space-y-1">
          {files.map((a) => (
            <li key={a.id} className="group flex items-center gap-2 text-sm rounded-lg hover:bg-muted/40 px-2 py-1">
              <button type="button" onClick={() => download(a)} className="flex items-center gap-2 flex-1 min-w-0 text-left text-primary hover:underline">
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{a.file_name}</span>
              </button>
              <span className="text-[12.5px] text-muted-foreground shrink-0">{fmtSize(a.file_size)}</span>
              {canEdit && (
                <button type="button" onClick={() => remove(a)} className="text-muted-foreground/50 hover:text-destructive opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
