import { EipUserPending } from "@/components/eip/EipUserPending";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  UserMinus,
  ArrowRight,
  Check,
  Inbox,
  CalendarOff,
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  FolderOpen,
  GripVertical,
} from "lucide-react";

// eip_handover_item、eip_leave_handover_item 與 eip_quick_report.deputy_id
// 都尚未進 src/integrations/supabase/types.ts，
// 這裡用寬鬆型別的 client，型別在本檔自行宣告。
import { supabase } from "@/lib/supabase";
import { LEAVE_DONE_STATUSES, LEAVE_TYPE_LABEL } from "@/lib/eip-constants";
import { useEipUser } from "@/lib/eip-user";
import { useAuth } from "@/lib/auth";
import { useActiveUsers, useAllUsers } from "@/hooks/useUsers";
import { isLocalPath, validateExternalUrl, copyPath } from "@/lib/eip-url";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { humanizeError } from "@/lib/eip-error";
// 日期顯示與起訖工具共用同一支（見 lib/eip-datetime-range.ts）
import { fmtDate } from "@/lib/eip-datetime-range";

export const Route = createFileRoute("/dashboard/eip/handover")({
  component: HandoverPage,
});

/* ---------- 型別與文案 ---------- */

type EntityType =
  "task" | "task_collaborator" | "project" | "recurring_rule" | "meeting_action_item" | "deputy";

type HandoverItem = {
  id: string;
  leaver_id: string;
  entity_type: EntityType | string;
  entity_id: string;
  entity_title: string | null;
  assignee_id: string | null;
  assignee_reason: string | null;
  department_id: string | null;
  status: "pending" | "resolved" | "void" | string;
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  escalated_level: number;
  created_at: string;
};

const ENTITY_LABEL: Record<string, string> = {
  task: "任務",
  task_collaborator: "任務協作",
  project: "專案",
  recurring_rule: "常態工作",
  meeting_action_item: "會議決議",
  deputy: "職務代理人",
};

const REASON_LABEL: Record<string, string> = {
  creator: "（您是建立者）",
  dept_manager: "（原建立者已離職，轉由您這位部門主管處理）",
  parent_dept_manager: "（轉由上層主管處理）",
  company_admin: "（查無適合處理人，轉由管理者處理）",
};

const STATUS_TABS = [
  { value: "pending", label: "待處理" },
  { value: "resolved", label: "已完成" },
  { value: "void", label: "已取消" },
] as const;

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/* ---------- 主頁面 ---------- */

function HandoverPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { appUser } = useEipUser();
  const { can, permsLoaded } = useAuth();

  // 權限一律讀角色權限設定，不寫死角色字串
  const allowed = can("eip_handover", "view");
  const canResolve = can("eip_handover", "edit");

  const [tab, setTab] = useState<string>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);

  // 離職者一定是已停用帳號，姓名對照必須用「含停用」的版本
  const usersQ = useAllUsers();
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    (usersQ.data ?? []).forEach((u) => m.set(u.id, u.name ?? "—"));
    return (id: string | null) => (id ? (m.get(id) ?? "—") : "—");
  }, [usersQ.data]);

  // RLS 已限定可見範圍（指派給我／我是離職者／我管轄部門／管理者看全部），前端不再過濾
  const listQ = useQuery({
    queryKey: ["eip", "handover", tab],
    // 沒有交接待辦檢視權的人只看得到自己的請假交接，不要白打這支查詢
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eip_handover_item")
        .select("*")
        .eq("status", tab)
        .order("escalated_level", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as HandoverItem[];
    },
  });

  const rows = useMemo(() => listQ.data ?? [], [listQ.data]);

  // 會議決議要導到「所屬會議」，需要先換出 meeting_id
  const actionIds = useMemo(
    () => rows.filter((r) => r.entity_type === "meeting_action_item").map((r) => r.entity_id),
    [rows],
  );
  const meetingOfQ = useQuery({
    queryKey: ["eip", "handover", "action-meetings", actionIds.join(",")],
    enabled: actionIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meeting_action_item")
        .select("id,meeting_id")
        .in("id", actionIds);
      if (error) throw error;
      const m = new Map<string, string>();
      ((data ?? []) as { id: string; meeting_id: string }[]).forEach((x) =>
        m.set(x.id, x.meeting_id),
      );
      return m;
    },
  });

  const goHandle = (r: HandoverItem) => {
    switch (r.entity_type) {
      case "task":
      case "task_collaborator":
        void navigate({ to: "/dashboard/eip/tasks", search: { openTask: r.entity_id } });
        break;
      case "project":
        void navigate({ to: "/dashboard/eip/projects/$id", params: { id: r.entity_id } });
        break;
      case "recurring_rule":
        void navigate({ to: "/dashboard/eip/recurring" });
        break;
      case "meeting_action_item": {
        if (meetingOfQ.isLoading) {
          toast.info("會議資料還在載入，請稍候再按");
          return;
        }
        const mid = meetingOfQ.data?.get(r.entity_id);
        if (!mid) {
          toast.error("找不到該行動項所屬的會議");
          return;
        }
        void navigate({ to: "/dashboard/eip/meetings/$id", params: { id: mid } });
        break;
      }
      case "deputy":
        void navigate({ to: "/dashboard/users" });
        break;
      default:
        toast.error(`未知的項目類別：${r.entity_type}`);
    }
  };

  // 只允許標記完成，不提供刪除；也不從前端 insert（RLS 已禁止）
  const resolve = async (r: HandoverItem) => {
    if (!appUser?.id || busyId) return;
    setBusyId(r.id);
    // eip_handover_item 的 UPDATE 政策只給建立者／主管／管理者：被指派的成員讀得到
    // 卻改不到，PostgREST 那時是 0 列 ＋ error 為 null。只看 error 會跳「已標記完成」，
    // 重讀後那一列原封不動回到「待處理」，使用者只會一直重按。
    // （這張表沒有軟刪除 guard，是純 UPDATE，所以筆數是可信的。）
    const { data, error } = await supabase
      .from("eip_handover_item")
      .update({
        status: "resolved",
        resolution: "使用者手動確認",
        resolved_by: appUser.id,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", r.id)
      .select("id");
    setBusyId(null);
    if (error) {
      toast.error(humanizeError(error, "標記完成"));
      return;
    }
    if (!(data as { id: string }[] | null)?.length) {
      toast.error("沒有權限標記這筆交接完成，請聯絡建立者或部門主管");
      // 別人可能已經處理掉了，重讀一次讓畫面回到真實狀態
      void qc.invalidateQueries({ queryKey: ["eip", "handover"] });
      void qc.invalidateQueries({ queryKey: ["eip", "handover-pending-count"] });
      return;
    }
    toast.success("已標記完成");
    void qc.invalidateQueries({ queryKey: ["eip", "handover"] });
    void qc.invalidateQueries({ queryKey: ["eip", "handover-pending-count"] });
  };

  if (!appUser) return <EipUserPending />;
  // 權限還沒載入完就判斷 allowed 會把有權限的人踢走（重新整理／書籤必中）
  if (!permsLoaded) return <div className="text-muted-foreground py-8">載入中…</div>;
  // 這頁原本沒有「交接待辦」檢視權就整頁導走。現在最上面那塊是「自己送出的請假」，
  // 那是每個人都該能補登的東西（RLS 也只會回自己的單），所以不再整頁踢人，
  // 只把離職／異動佇列那一段藏起來。

  return (
    <div>
      <PageHeader
        title="交接待辦"
        description="上半部是你自己請假期間要交接的事：代理人與代辦事項都可以事後在這裡補登。下半部是同仁停用（離職）後仍指向他、尚未結案的項目，由建立者或主管重新指派。"
      />

      <MyLeaveHandoverSection meId={appUser.id} />

      {!allowed ? (
        <p className="text-xs text-muted-foreground mt-4">
          離職／異動的交接佇列需要「交接待辦」模組的檢視權限，你這個角色沒有開，所以只顯示上面自己的請假交接。
        </p>
      ) : (
        <>
      <div className="text-sm font-semibold mt-5 flex items-center gap-2">
        <UserMinus className="w-4 h-4 text-muted-foreground" />
        離職／異動交接
      </div>
      <Tabs value={tab} onValueChange={setTab} className="mt-2">
        <TabsList>
          {STATUS_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
              {t.value === tab && rows.length > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground">{rows.length}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className="mt-3">
        <CardContent className="p-0 overflow-x-auto">
          {listQ.isLoading ? (
            <div className="text-sm text-muted-foreground text-center py-8">載入中…</div>
          ) : listQ.isError ? (
            <div className="text-sm text-center py-8">
              <div className="text-destructive mb-2">載入失敗</div>
              <Button size="sm" variant="outline" onClick={() => listQ.refetch()}>
                重試
              </Button>
            </div>
          ) : !rows.length ? (
            <EmptyState tab={tab} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">類別</TableHead>
                  <TableHead>項目</TableHead>
                  <TableHead className="min-w-[16rem]">原因</TableHead>
                  <TableHead className="w-36">產生時間</TableHead>
                  <TableHead className="w-24">逾期</TableHead>
                  <TableHead className="w-52 text-right">動作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Badge variant="secondary">
                        {ENTITY_LABEL[r.entity_type] ?? r.entity_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{r.entity_title ?? "（無標題）"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      因 {nameOf(r.leaver_id)} 停用
                      {r.assignee_reason && REASON_LABEL[r.assignee_reason] && (
                        <span className="block">{REASON_LABEL[r.assignee_reason]}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmt(r.created_at)}
                    </TableCell>
                    <TableCell>
                      <OverdueBadge level={r.escalated_level} />
                    </TableCell>
                    <TableCell className="text-right">
                      {r.status === "pending" ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => goHandle(r)}>
                            前往處理
                            <ArrowRight className="w-3.5 h-3.5 ml-1" />
                          </Button>
                          {canResolve && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busyId === r.id}
                              onClick={() => void resolve(r)}
                              title="立即標記完成，不用等隔天自動結案"
                            >
                              <Check className="w-3.5 h-3.5 mr-1" />
                              已處理
                            </Button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {r.status === "resolved"
                            ? `${r.resolution ?? "已完成"}${r.resolved_at ? `・${fmt(r.resolved_at)}` : ""}`
                            : "已取消（帳號重新啟用）"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {tab === "pending" && rows.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          任務類的項目可以在「任務」頁開啟「待重新指派」篩選，用批次改負責人一次處理多筆。
        </p>
      )}
        </>
      )}
    </div>
  );
}

/* ---------- 小元件 ---------- */

function OverdueBadge({ level }: { level: number }) {
  if (level >= 2) {
    return (
      <Badge
        variant="secondary"
        className="bg-destructive/10 text-destructive hover:bg-destructive/10"
      >
        逾期 7 天
      </Badge>
    );
  }
  if (level >= 1) {
    return (
      <Badge variant="secondary" className="bg-amber-100 text-amber-700 hover:bg-amber-100">
        逾期 3 天
      </Badge>
    );
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}

function EmptyState({ tab }: { tab: string }) {
  const msg =
    tab === "pending"
      ? "目前沒有待處理的交接項目。"
      : tab === "resolved"
        ? "還沒有已完成的交接項目。"
        : "沒有已取消的交接項目。帳號被重新啟用時，未處理的項目會自動移到這裡。";
  const Icon = tab === "pending" ? UserMinus : Inbox;
  return (
    <div className="text-center py-12 px-6">
      <Icon className="w-8 h-8 mx-auto text-muted-foreground/50 mb-3" />
      <div className="text-sm text-muted-foreground max-w-md mx-auto">{msg}</div>
    </div>
  );
}

/* ==================== 我的請假交接 ==================== */

/**
 * 「我自己送出的請假單」的交接補登區。
 *
 * 為什麼在這裡而不是在請假表單裡：臨時請假的人常常在外面、趕時間，
 * 當場登打不完整份交接清單。請假送出只要區間（LeaveRequestDialog），
 * **代理人與代辦事項一律事後在這一區補**。
 *
 * 三條硬規則：
 *  ・**不寫 status**：請假單的 status 由 DB trigger 依代辦完成度推導
 *    （全部完成 → done，任一項取消完成 → 退回 open）。這裡只寫
 *    deputy_id 與代辦內容，勾完成是代理人在工作區做的。
 *  ・**每個 UPDATE / DELETE 都看筆數**：PostgREST 被 RLS 擋住時是
 *    0 筆 ＋ error 為 null，只看 error 會跳假成功。
 *  ・已完成（done_at 不是 null）的項目不給改標題也不給刪 ——
 *    那是代理人做完的紀錄，改掉等於把別人的完成紀錄改掉。
 */

/** eip_quick_report 中的請假單（deputy_id 尚未進 types.ts） */
type MyLeaveReport = {
  id: string;
  status: string;
  /** 假別代碼（leave_type 字典表）；合併卡要顯示各段是什麼假 */
  leave_type: string | null;
  report_date: string | null;
  leave_from: string | null;
  leave_to: string | null;
  deputy_id: string | null;
  created_at: string;
};

/** eip_leave_handover_item：一張請假單底下的逐項代辦 */
type LeaveItem = {
  id: string;
  quick_report_id: string;
  title: string;
  assignee_id: string | null;
  url: string | null;
  sort_order: number | null;
  done_at: string | null;
  done_by: string | null;
  created_at: string;
};

type UserOpt = { id: string; name: string };

/** shadcn Select 不接受空字串當值，「未指派」用 sentinel */
const NO_ASSIGNEE = "__none__";

const pad2 = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
/** 本地（台北）日期字串；toISOString() 在 UTC+8 會退回前一天，不能用 */
const localDate = (iso: string) => new Date(iso).toLocaleDateString("sv-SE");

/** 請假區間：同一天顯示時段並標「全天／N 小時」，跨日標天數 */
function leaveSpan(from: string | null, to: string | null, fallbackDate: string | null) {
  if (!from || !to) {
    return { text: fallbackDate ?? "未填區間", tag: null as string | null };
  }
  const a = new Date(from);
  const b = new Date(to);
  const da = localDate(from);
  const db = localDate(to);
  if (da === db) {
    const hours = (b.getTime() - a.getTime()) / 3600000;
    return {
      text: `${da} ${hhmm(a)}～${hhmm(b)}`,
      // 8:00–17:30 這種整日班算全天，其餘照實顯示時數，半天請假才看得出來
      tag: hours >= 7 ? "全天" : `${Math.round(hours * 10) / 10} 小時`,
    };
  }
  const days =
    Math.round((Date.parse(`${db}T00:00:00`) - Date.parse(`${da}T00:00:00`)) / 86400000) + 1;
  return { text: `${da} ${hhmm(a)} ～ ${db} ${hhmm(b)}`, tag: `${days} 天` };
}

/**
 * 目前掛著的人若不在選單清單裡（已停用，或是自己 —— 選單刻意排除自己），
 * 要把他補進選項，否則 shadcn Select 會顯示一片空白，看起來像沒指派。
 * 只有真的不在「在職名單」裡才標（已停用）。
 */
function withCurrent(
  list: UserOpt[],
  current: string | null,
  nameOf: (id: string | null) => string,
  activeIds: Set<string>,
): UserOpt[] {
  if (!current || list.some((u) => u.id === current)) return list;
  const suffix = activeIds.has(current) ? "" : "（已停用）";
  return [{ id: current, name: `${nameOf(current)}${suffix}` }, ...list];
}

/* ---------- 合併連續請假：判斷兩段假算不算「同一次不在」 ---------- */

/** 台北日期字串 ± 天數（純字串運算，不碰 toISOString，見 AGENTS.md） */
function shiftDate(date: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 兩個日期相差幾天（含頭含尾） */
function daysInclusive(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

/** 週六日？系統沒有國定假日表，連假只能靠「空隙含週末」認 */
function isWeekendDate(date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  const wd = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return wd === 0 || wd === 6;
}

/**
 * 兩段請假算不算「同一次不在」，決定要不要併成一張交接卡。
 *
 * 客戶情境（2026-08-25）：連續請假但假別不同必須開兩張請假單
 * （例 9/16 事假 ＋ 9/17~9/27 婚假），交接卡因此變兩張、代辦被切開；
 * 但對代理人來說那是同一段「人不在」的日子，只需要一張交接清單。
 *
 * 規則（與客戶確認）：
 *  ・日期相連或重疊 → 同一段
 *  ・中間空隙 ≤ 3 天且含週末 → 同一段（週五請假、下週一再請，中間是六日；連假同理）
 *  ・空隙全是平日 → 不同段（9/1 與 9/3 是兩次不相干的請假，不能亂併）
 */
function sameLeaveSpan(prevEnd: string, nextStart: string): boolean {
  if (!prevEnd || !nextStart) return false;
  if (nextStart <= prevEnd) return true;
  const gap: string[] = [];
  for (let d = shiftDate(prevEnd, 1); d < nextStart; d = shiftDate(d, 1)) {
    gap.push(d);
    if (gap.length > 3) return false;
  }
  if (gap.length === 0) return true;
  return gap.some(isWeekendDate);
}

/** 一張交接卡＝一段連續不在，底下可能有多張請假單（假別不同） */
type LeaveGroup = {
  /** 主段 id，同時當 React key 與拖拉排序的暫存 key */
  key: string;
  /** 這一段底下的請假單，依起日升冪 */
  reports: MyLeaveReport[];
  /**
   * 主段＝區間最長的那一張（一樣長取最早）。
   * 新增的代辦掛在它底下，代理人下拉也以它的值顯示（改動會套用到整段）。
   */
  primary: MyLeaveReport;
  start: string;
  end: string;
  closed: boolean;
};

const reportStart = (r: MyLeaveReport) =>
  r.leave_from ? localDate(r.leave_from) : (r.report_date ?? "");
const reportEnd = (r: MyLeaveReport) =>
  r.leave_to ? localDate(r.leave_to) : reportStart(r);

/** 假別代碼 → 中文；沒填就說沒填，不要顯示代碼 */
const leaveTypeName = (code: string | null) =>
  code ? (LEAVE_TYPE_LABEL[code] ?? code) : "未填假別";

/** 這一段裡某一張假單的簡短標示：「9/16(三) 事假」／「9/17(四)～9/27(日) 婚假」 */
function segmentLabel(r: MyLeaveReport): string {
  const s = reportStart(r);
  const e = reportEnd(r);
  const range = s === e ? fmtDate(s) : `${fmtDate(s)}～${fmtDate(e)}`;
  return `${range} ${leaveTypeName(r.leave_type)}`;
}

/** 把請假單依「同一次不在」併成群組。已結案與未結案不會併在一起。 */
function groupLeaveReports(list: MyLeaveReport[]): LeaveGroup[] {
  const sorted = [...list].sort((a, b) => {
    const sa = reportStart(a);
    const sb = reportStart(b);
    if (sa !== sb) return sa < sb ? -1 : 1;
    return a.created_at.localeCompare(b.created_at);
  });

  const groups: LeaveGroup[] = [];
  let cur: MyLeaveReport[] = [];
  let curEnd = "";
  let curClosed = false;

  const flush = () => {
    if (!cur.length) return;
    const start = reportStart(cur[0]);
    const end = cur.reduce((m, r) => (reportEnd(r) > m ? reportEnd(r) : m), reportEnd(cur[0]));
    const primary = cur.reduce(
      (best, r) =>
        daysInclusive(reportStart(r), reportEnd(r)) >
        daysInclusive(reportStart(best), reportEnd(best))
          ? r
          : best,
      cur[0],
    );
    groups.push({ key: primary.id, reports: [...cur], primary, start, end, closed: curClosed });
    cur = [];
  };

  for (const r of sorted) {
    const closed = LEAVE_DONE_STATUSES.has(r.status);
    if (cur.length && closed === curClosed && sameLeaveSpan(curEnd, reportStart(r))) {
      cur.push(r);
      if (reportEnd(r) > curEnd) curEnd = reportEnd(r);
    } else {
      flush();
      cur = [r];
      curEnd = reportEnd(r);
      curClosed = closed;
    }
  }
  flush();

  // 新的在上面（與原本 order by leave_from desc 的觀感一致）
  return groups.sort((a, b) => (a.start === b.start ? 0 : a.start < b.start ? 1 : -1));
}

function MyLeaveHandoverSection({ meId }: { meId: string }) {
  const qc = useQueryClient();
  const [showClosed, setShowClosed] = useState(false);
  const [deputyBusy, setDeputyBusy] = useState<Set<string>>(new Set());
  // 拖拉排序：dragItemId＝正在拖的項目；pendingOrder＝送出後、refetch 回來前的暫時順序
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [pendingOrder, setPendingOrder] = useState<Record<string, string[]>>({});

  // 選人一律只給在職同仁（避免指派給離職帳號）；顯示姓名要用含停用的對照
  const activeUsersQ = useActiveUsers();
  const allUsersQ = useAllUsers();
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    (allUsersQ.data ?? []).forEach((u) => m.set(u.id, u.name ?? u.id));
    return (id: string | null) => (id ? (m.get(id) ?? id) : "未指派");
  }, [allUsersQ.data]);
  const others = useMemo<UserOpt[]>(
    () =>
      (activeUsersQ.data ?? [])
        .filter((u) => u.id !== meId)
        .map((u) => ({ id: u.id, name: u.name ?? u.id })),
    [activeUsersQ.data, meId],
  );
  const activeIds = useMemo(
    () => new Set((activeUsersQ.data ?? []).map((u) => u.id)),
    [activeUsersQ.data],
  );

  // 只抓自己送出的請假單。已結案的也一起抓回來，「顯示已結案」只是前端切換，
  // 不必為了一個開關再打一次 API。
  const reportsQ = useQuery({
    queryKey: ["eip", "my-leave-handover", "reports", meId],
    enabled: !!meId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eip_quick_report")
        .select("id,status,leave_type,report_date,leave_from,leave_to,deputy_id,created_at")
        .eq("type", "leave")
        .eq("submitter_id", meId)
        .is("deleted_at", null)
        .order("leave_from", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as MyLeaveReport[];
    },
  });

  // 每一層都 useMemo：reports 若每次 render 都是新陣列，下面的 groups 就白算一次
  const allReports = useMemo(() => reportsQ.data ?? [], [reportsQ.data]);
  const openReports = useMemo(
    () => allReports.filter((r) => !LEAVE_DONE_STATUSES.has(r.status)),
    [allReports],
  );
  const closedCount = allReports.length - openReports.length;
  const reports = useMemo(
    () => (showClosed ? allReports : openReports),
    [showClosed, allReports, openReports],
  );
  // 連續請假（例：9/16 事假 ＋ 9/17~9/27 婚假）併成一張卡，代辦一起列
  const groups = useMemo(() => groupLeaveReports(reports), [reports]);
  // 切成「未結案」與「已結案」兩段，已結案置頂讓使用者切換時一眼看到
  const openGroups = useMemo(() => groups.filter((g) => !g.closed), [groups]);
  const closedGroups = useMemo(() => groups.filter((g) => g.closed), [groups]);

  // 代辦一次撈完（含已結案的單），列表要顯示 x/y；用 id 集合當 key，切換開關不重打
  const reportIds = useMemo(() => allReports.map((r) => r.id).sort(), [allReports]);
  const itemsKey = useMemo(
    () => ["eip", "my-leave-handover", "items", reportIds.join(",")] as const,
    [reportIds],
  );
  const itemsQ = useQuery({
    queryKey: itemsKey,
    enabled: reportIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eip_leave_handover_item")
        .select("id,quick_report_id,title,assignee_id,url,sort_order,done_at,done_by,created_at")
        .in("quick_report_id", reportIds)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as LeaveItem[];
    },
  });
  const itemsByReport = useMemo(() => {
    const m = new Map<string, LeaveItem[]>();
    (itemsQ.data ?? []).forEach((it) => {
      const arr = m.get(it.quick_report_id);
      if (arr) arr.push(it);
      else m.set(it.quick_report_id, [it]);
    });
    return m;
  }, [itemsQ.data]);

  /**
   * 一張卡要顯示的代辦：把這一段所有假單的代辦合起來，依 sort_order 排。
   * 拖拉送出後 server 還沒回來的空檔用 pendingOrder 撐住，畫面才不會跳回舊順序。
   */
  const orderedItems = (g: LeaveGroup): LeaveItem[] => {
    const pool = g.reports.flatMap((r) => itemsByReport.get(r.id) ?? []);
    const base = [...pool].sort(
      (a, b) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.created_at.localeCompare(b.created_at),
    );
    const pend = pendingOrder[g.key];
    if (!pend) return base;
    const idx = new Map(pend.map((id, i) => [id, i]));
    return [...base].sort(
      (a, b) => (idx.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (idx.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  };

  /** 寫入成功後：本區、臨時回報頁、代理人的工作區代辦卡都要重讀 */
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["eip", "my-leave-handover"] });
    void qc.invalidateQueries({ queryKey: ["eip", "quick-reports"] });
    void qc.invalidateQueries({ queryKey: ["eip", "leave-handover-items"] });
    void qc.invalidateQueries({ queryKey: ["eip", "leave-handover-inbox"] });
  };

  /**
   * 指定／清除代理人。合併卡只有一個下拉，一次套用到這一段的所有請假單
   * （客戶決定：整段一起改）。只寫 deputy_id，status 一律交給 DB trigger。
   */
  const setDeputy = async (g: LeaveGroup, next: string | null) => {
    if (deputyBusy.has(g.key)) return;
    const ids = g.reports.map((r) => r.id);
    setDeputyBusy((p) => new Set(p).add(g.key));
    const { data, error } = await supabase
      .from("eip_quick_report")
      .update({ deputy_id: next })
      .in("id", ids)
      .select("id");
    setDeputyBusy((p) => {
      const n = new Set(p);
      n.delete(g.key);
      return n;
    });
    if (error) {
      toast.error(humanizeError(error, "代理人更新"));
      return;
    }
    if (!data?.length) {
      // 0 筆 ＋ error 為 null＝被 RLS 擋掉（例如這張單已結案）或資料已被改過
      toast.error("代理人更新失敗：沒有權限或資料已變更（單已結案時不能再改），畫面已重新整理");
      refresh();
      return;
    }
    if (data.length < ids.length) {
      toast.error(
        `這一段有 ${ids.length} 張請假單，只更新了 ${data.length} 張（其餘可能已結案），畫面已重新整理`,
      );
      refresh();
      return;
    }
    toast.success(next ? "已指定代理人" : "已清除代理人");
    refresh();
  };

  /**
   * 新增代辦。掛在主段（區間最長那張）底下，sort_order 取「整段」現有最大值 +1，
   * 才不會因為 DB 預設值是「同一張假單的 max+1」而插到合併清單的中間。
   */
  const addItem = async (
    g: LeaveGroup,
    input: { title: string; assigneeId: string | null; url: string | null },
  ) => {
    const title = input.title.trim();
    if (!title) {
      toast.error("請填寫代辦事項");
      return false;
    }
    if (input.url) {
      const bad = validateExternalUrl(input.url);
      if (bad) {
        toast.error(bad);
        return false;
      }
    }
    const existing = orderedItems(g);
    const nextSort = existing.reduce((m, x) => Math.max(m, x.sort_order ?? 0), 0) + 1;
    // INSERT 被 RLS 擋掉是真的回 error（42501），不像 UPDATE/DELETE 靜默 0 筆
    const { error } = await supabase.from("eip_leave_handover_item").insert({
      quick_report_id: g.primary.id,
      title,
      // 呼叫端（AddLeaveItemRow）選「同代理人」時已經把 deputy_id 填進來了；
      // 真的沒有代理人才會是 null（未指派），這是允許的狀態
      assignee_id: input.assigneeId,
      url: input.url,
      sort_order: nextSort,
    });
    if (error) {
      toast.error(humanizeError(error, "新增"));
      return false;
    }
    toast.success("已新增代辦事項");
    refresh();
    return true;
  };

  /** 修改代辦（標題／指派／連結）。已完成的項目不會走到這裡 */
  const saveItem = async (
    item: LeaveItem,
    patch: { title: string; assignee_id: string | null; url: string | null },
  ) => {
    const { data, error } = await supabase
      .from("eip_leave_handover_item")
      .update(patch)
      .eq("id", item.id)
      .select("id");
    if (error) {
      toast.error(humanizeError(error, "修改"));
      return false;
    }
    if (!data?.length) {
      toast.error("修改失敗：沒有權限或資料已變更（可能已被刪除或已被勾完成）");
      refresh();
      return false;
    }
    toast.success("已更新代辦事項");
    refresh();
    return true;
  };

  const removeItem = async (item: LeaveItem) => {
    if (!window.confirm(`刪除代辦「${item.title}」？`)) return;
    const { data, error } = await supabase
      .from("eip_leave_handover_item")
      .delete()
      .eq("id", item.id)
      .select("id");
    if (error) {
      toast.error(humanizeError(error, "刪除"));
      return;
    }
    if (!data?.length) {
      toast.error("刪除失敗：沒有權限或資料已變更（已完成的項目不能刪除）");
      refresh();
      return;
    }
    toast.success("已刪除代辦事項");
    refresh();
  };

  /**
   * 拖拉排序。整段（可能跨多張假單）重新編號 sort_order，走
   * eip_reorder_leave_handover_items RPC 一次寫完 —— 逐列 PATCH 會打很多次 API，
   * 中途失敗還會留下半套順序。RPC 是 SECURITY INVOKER，只有請假本人改得動。
   *
   * targetId 為 null＝拖到清單最後面。
   */
  const moveItem = async (g: LeaveGroup, dragId: string, targetId: string | null) => {
    setDragItemId(null);
    if (dragId === targetId) return;
    const ids = orderedItems(g).map((i) => i.id);
    const from = ids.indexOf(dragId);
    if (from < 0) return;
    const rest = ids.filter((x) => x !== dragId);
    let insertAt = rest.length;
    if (targetId) {
      const t = rest.indexOf(targetId);
      if (t < 0) return;
      // 往下拖＝放到目標下面，往上拖＝放到目標上面
      insertAt = from < ids.indexOf(targetId) ? t + 1 : t;
    }
    const next = [...rest.slice(0, insertAt), dragId, ...rest.slice(insertAt)];
    if (next.join(",") === ids.join(",")) return;

    setPendingOrder((p) => ({ ...p, [g.key]: next }));
    const { error } = await supabase.rpc("eip_reorder_leave_handover_items", { p_ids: next });
    if (error) {
      toast.error(humanizeError(error, "排序"));
    }
    // 不管成功或失敗都以 server 為準：成功是確認、失敗是還原
    await qc.invalidateQueries({ queryKey: ["eip", "my-leave-handover"] });
    setPendingOrder((p) => {
      const n = { ...p };
      delete n[g.key];
      return n;
    });
    if (!error) refresh();
  };

  return (
    <Card className="mt-3">
      <CardContent className="p-3 sm:p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <CalendarOff className="w-4 h-4 text-accent shrink-0" />
          <span className="text-sm font-semibold">我的請假交接</span>
          {openReports.length > 0 && (
            <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
              {openReports.length}
            </span>
          )}
          <div className="flex-1" />
          {closedCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setShowClosed((v) => !v)}
            >
              {showClosed ? "隱藏已結案" : `顯示已結案（${closedCount}）`}
            </Button>
          )}
        </div>

        <p className="text-[12.5px] text-muted-foreground">
          請假送出後不需主管核准。代理人與代辦事項可以隨時在這裡補登或修改，
          代理人勾完成後完成度會自動回傳；已完成的項目只能檢視，不能改標題或刪除。
          連續請假就算分成幾張假單（假別不同），這裡會併成一張交接清單；
          代辦事項可以用左邊的握把拖拉調整順序。
        </p>

        {(activeUsersQ.isError || allUsersQ.isError) && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-destructive">人員清單載入失敗，姓名與選人清單可能不完整</span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-xs"
              onClick={() => {
                void activeUsersQ.refetch();
                void allUsersQ.refetch();
              }}
            >
              重試
            </Button>
          </div>
        )}

        {reportsQ.isLoading ? (
          <div className="text-xs text-muted-foreground py-2">載入中…</div>
        ) : reportsQ.isError ? (
          /* 載入失敗不能退化成「沒有請假單」，否則使用者會以為假沒送出去 */
          <div className="flex items-center gap-2 text-xs py-2">
            <span className="text-destructive">
              請假單載入失敗：
              {reportsQ.error instanceof Error ? reportsQ.error.message : "請稍後再試"}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-xs"
              onClick={() => void reportsQ.refetch()}
            >
              重試
            </Button>
          </div>
        ) : groups.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2">
            {allReports.length === 0
              ? "你目前沒有請假紀錄。請假請到「我的工作」按「我要請假」，只填區間就能送出。"
              : "沒有未結案的請假單。按上面的「顯示已結案」可以查看過去的紀錄。"}
          </div>
        ) : (
          <div className="space-y-3">
            {/* 已結案群組置頂，切換時一眼就看到 */}
            {showClosed && closedGroups.length > 0 && (
              <>
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-xs font-medium text-emerald-700">已結案</span>
                  <div className="flex-1 border-t border-emerald-200" />
                </div>
                {closedGroups.map((g) => {
                  const items = orderedItems(g);
                  const done = items.filter((i) => i.done_at).length;
                  const unassigned = items.filter((i) => !i.assignee_id).length;
                  const closed = g.closed;
                  const merged = g.reports.length > 1;
                  const span = merged
                    ? { text: `${g.start} ～ ${g.end}`, tag: `${daysInclusive(g.start, g.end)} 天` }
                    : leaveSpan(g.primary.leave_from, g.primary.leave_to, g.primary.report_date);
                  const deputyId = g.primary.deputy_id ?? g.reports.find((r) => r.deputy_id)?.deputy_id ?? null;
                  const deputyMixed = new Set(g.reports.map((r) => r.deputy_id ?? "")).size > 1;
                  const deputyOptions = withCurrent(others, deputyId, nameOf, activeIds);
                  const canDrag = false;
                  const allItemsDone = !closed && items.length > 0 && done === items.length;
                  return (
                    <div key={g.key} className="rounded-md border overflow-hidden opacity-80">
                      <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-muted/40 border-b">
                        <span className="text-sm font-medium">{span.text}</span>
                        {span.tag && (
                          <Badge variant="secondary" className="text-[11.5px]">
                            {span.tag}
                          </Badge>
                        )}
                        {!merged && (
                          <Badge variant="outline" className="text-[11.5px]">
                            {leaveTypeName(g.primary.leave_type)}
                          </Badge>
                        )}
                        <Badge
                          variant="outline"
                          className="bg-emerald-100 text-emerald-700 border-emerald-300"
                        >
                          已結案
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {itemsQ.isLoading ? (
                            "代辦載入中…"
                          ) : itemsQ.isError ? (
                            <span className="text-destructive">代辦載入失敗</span>
                          ) : (
                            `代辦 ${done}/${items.length}`
                          )}
                        </span>
                        <div className="flex-1" />
                        <span className="text-xs text-muted-foreground">代理人</span>
                        <span className="text-xs font-medium">{nameOf(deputyId)}</span>
                      </div>
                      {merged && (
                        <div className="px-3 py-1.5 text-[12.5px] text-muted-foreground bg-muted/20 border-b">
                          這段連續請假分成 {g.reports.length} 張假單（假別不同要分開送）：
                          {g.reports.map((r) => segmentLabel(r)).join("、")}
                          {deputyMixed && (
                            <span className="text-amber-700">（原本各段代理人不同）</span>
                          )}
                        </div>
                      )}
                      {itemsQ.isError ? (
                        <div className="flex items-center gap-2 px-3 py-2 text-xs">
                          <span className="text-destructive">代辦事項載入失敗</span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs"
                            onClick={() => void itemsQ.refetch()}
                          >
                            重試
                          </Button>
                        </div>
                      ) : items.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-muted-foreground">
                          還沒有代辦事項。
                        </div>
                      ) : (
                        <div className="divide-y">
                          {items.map((it) => (
                            <div key={it.id}>
                              <LeaveItemRow
                                item={it}
                                users={withCurrent(others, it.assignee_id, nameOf, activeIds)}
                                nameOf={nameOf}
                                deputyId={deputyId}
                                canEdit={false}
                                canDrag={false}
                                onDragStart={() => {}}
                                onDragEnd={() => {}}
                                onSave={saveItem}
                                onDelete={removeItem}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {openGroups.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">未結案</span>
                    <div className="flex-1 border-t border-border" />
                  </div>
                )}
              </>
            )}
            {openGroups.map((g) => {
              const items = orderedItems(g);
              const done = items.filter((i) => i.done_at).length;
              const unassigned = items.filter((i) => !i.assignee_id).length;
              const closed = g.closed;
              const merged = g.reports.length > 1;
              // 單張維持原本的「日期＋時段＋全天/N 小時」顯示；合併卡顯示整段日期與天數
              const span = merged
                ? { text: `${g.start} ～ ${g.end}`, tag: `${daysInclusive(g.start, g.end)} 天` }
                : leaveSpan(g.primary.leave_from, g.primary.leave_to, g.primary.report_date);
              // 代理人以主段為準；各段不同時提示一下，改動會一起套用
              const deputyId = g.primary.deputy_id ?? g.reports.find((r) => r.deputy_id)?.deputy_id ?? null;
              const deputyMixed = new Set(g.reports.map((r) => r.deputy_id ?? "")).size > 1;
              const deputyOptions = withCurrent(others, deputyId, nameOf, activeIds);
              const canDrag = !closed && items.length > 1;
              /**
               * 徽章：closed 是 DB 的 status（由 trigger 依完成度回寫），控制能不能再編輯。
               * 但合併卡裡「沒有代辦的那一段」永遠不會被 trigger 推成 done
               * （rollup 只在 total > 0 時動），若只看 closed，代辦全部做完了卡片還是寫「待處理」。
               * 所以再補一個「代辦已完成」的顯示狀態 —— 刻意不叫「已結案」，
               * 因為那一段假單在 DB 裡真的還沒結案，而且還可以繼續補代辦。
               */
              const allItemsDone = !closed && items.length > 0 && done === items.length;
              return (
                <div key={g.key} className="rounded-md border overflow-hidden">
                  <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-muted/40 border-b">
                    <span className="text-sm font-medium">{span.text}</span>
                    {span.tag && (
                      <Badge variant="secondary" className="text-[11.5px]">
                        {span.tag}
                      </Badge>
                    )}
                    {!merged && (
                      <Badge variant="outline" className="text-[11.5px]">
                        {leaveTypeName(g.primary.leave_type)}
                      </Badge>
                    )}
                    <Badge
                      variant="outline"
                      className={
                        closed || allItemsDone
                          ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                          : "bg-amber-100 text-amber-700 border-amber-300"
                      }
                    >
                      {closed ? "已結案" : allItemsDone ? "代辦已完成" : "待處理"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {itemsQ.isLoading ? (
                        "代辦載入中…"
                      ) : itemsQ.isError ? (
                        <span className="text-destructive">代辦載入失敗</span>
                      ) : (
                        `代辦 ${done}/${items.length}`
                      )}
                    </span>
                    <div className="flex-1" />
                    <span className="text-xs text-muted-foreground">代理人</span>
                    {closed ? (
                      <span className="text-xs font-medium">{nameOf(deputyId)}</span>
                    ) : (
                      <Select
                        value={deputyId ?? NO_ASSIGNEE}
                        disabled={deputyBusy.has(g.key)}
                        onValueChange={(v) => void setDeputy(g, v === NO_ASSIGNEE ? null : v)}
                      >
                        <SelectTrigger
                          className={`w-44 h-8 text-xs ${deputyId ? "" : "text-amber-700"}`}
                        >
                          <SelectValue placeholder="選擇代理人" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_ASSIGNEE}>未指定</SelectItem>
                          {deputyOptions.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  {merged && (
                    <div className="px-3 py-1.5 text-[12.5px] text-muted-foreground bg-muted/20 border-b">
                      這段連續請假分成 {g.reports.length} 張假單（假別不同要分開送）：
                      {g.reports.map((r) => segmentLabel(r)).join("、")}
                      {" "}
                      —— 代辦事項已合併成一份，新增的會掛在「{segmentLabel(g.primary)}」。
                      {deputyMixed && (
                        <span className="text-amber-700">（原本各段代理人不同，改動會一起套用）</span>
                      )}
                    </div>
                  )}

                  {itemsQ.isError ? (
                    <div className="flex items-center gap-2 px-3 py-2 text-xs">
                      <span className="text-destructive">代辦事項載入失敗</span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs"
                        onClick={() => void itemsQ.refetch()}
                      >
                        重試
                      </Button>
                    </div>
                  ) : items.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      還沒有代辦事項{closed ? "。" : "，可在下方新增。"}
                    </div>
                  ) : (
                    <div
                      className="divide-y"
                      // 拖到清單空白處＝放到最後面
                      onDragOver={(e) => {
                        if (canDrag && dragItemId) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        if (!canDrag || !dragItemId) return;
                        e.preventDefault();
                        void moveItem(g, dragItemId, null);
                      }}
                    >
                      {items.map((it) => (
                        <div
                          key={it.id}
                          onDragOver={(e) => {
                            if (canDrag && dragItemId && dragItemId !== it.id) e.preventDefault();
                          }}
                          onDrop={(e) => {
                            if (!canDrag || !dragItemId) return;
                            e.preventDefault();
                            e.stopPropagation();
                            void moveItem(g, dragItemId, it.id);
                          }}
                          className={dragItemId === it.id ? "opacity-50" : undefined}
                        >
                          <LeaveItemRow
                            item={it}
                            users={withCurrent(others, it.assignee_id, nameOf, activeIds)}
                            nameOf={nameOf}
                            deputyId={deputyId}
                            canEdit={!closed}
                            canDrag={canDrag}
                            onDragStart={() => setDragItemId(it.id)}
                            onDragEnd={() => setDragItemId(null)}
                            onSave={saveItem}
                            onDelete={removeItem}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {unassigned > 0 && !itemsQ.isError && (
                    <div className="px-3 py-1.5 text-[12.5px] text-amber-700 bg-amber-50">
                      有 {unassigned} 項還沒有指派對象，指定代理人或逐項指派後對方才會收到通知。
                    </div>
                  )}

                  {!closed && !itemsQ.isError && (
                    <AddLeaveItemRow
                      users={others}
                      deputyId={deputyId}
                      onAdd={(input) => addItem(g, input)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** 連結顯示：UNC／file:// 一律做成「複製路徑」，瀏覽器不能從 https 頁面開 \\伺服器\… */
function ItemUrl({ url }: { url: string }) {
  if (isLocalPath(url)) {
    return (
      <button
        type="button"
        onClick={() => void copyPath(url, toast.success, toast.info)}
        title={`${url}（點擊複製路徑）`}
        className="inline-flex items-center text-primary hover:underline break-all"
      >
        複製路徑
        <FolderOpen className="w-3 h-3 ml-0.5" />
      </button>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      className="inline-flex items-center text-primary hover:underline break-all"
    >
      開啟連結
      <ExternalLink className="w-3 h-3 ml-0.5" />
    </a>
  );
}

/**
 * 一列代辦。編輯是明確進出「編輯模式」而不是常駐輸入框 ——
 * 常駐 input 的本地狀態會在背景 refetch 後跟 server 值不一致，
 * 使用者會以為自己看到的是最新內容。
 */
function LeaveItemRow({
  item,
  users,
  nameOf,
  deputyId,
  canEdit,
  canDrag,
  onDragStart,
  onDragEnd,
  onSave,
  onDelete,
}: {
  item: LeaveItem;
  users: UserOpt[];
  nameOf: (id: string | null) => string;
  /** 這張請假單目前的代理人；「同代理人」要寫入的就是這個 id（不是 null） */
  deputyId: string | null;
  canEdit: boolean;
  /** 這一段有兩項以上且未結案才給拖拉 */
  canDrag: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onSave: (
    item: LeaveItem,
    patch: { title: string; assignee_id: string | null; url: string | null },
  ) => Promise<boolean>;
  onDelete: (item: LeaveItem) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [assignee, setAssignee] = useState(item.assignee_id ?? NO_ASSIGNEE);
  const [url, setUrl] = useState(item.url ?? "");
  const [busy, setBusy] = useState(false);

  const done = !!item.done_at;
  // 已完成＝代理人做完的紀錄，只能看：不給改標題、不給刪
  const editable = canEdit && !done;

  const startEdit = () => {
    setTitle(item.title);
    setAssignee(item.assignee_id ?? NO_ASSIGNEE);
    setUrl(item.url ?? "");
    setEditing(true);
  };

  const save = async () => {
    if (busy) return;
    const t = title.trim();
    if (!t) {
      toast.error("代辦事項不能空白");
      return;
    }
    const u = url.trim();
    if (u) {
      const bad = validateExternalUrl(u);
      if (bad) {
        toast.error(bad);
        return;
      }
    }
    setBusy(true);
    // 「同代理人」必須寫入 deputyId，不能寫 null：DB 的 eip_fill_lhi_defaults 只在
    // INSERT 時補預設值，trg_lhi_backfill_on_deputy_set 只在 deputy_id 變更時回填，
    // UPDATE 既有項目時兩支都不會動 —— 寫 null 的結果是變成「未指派」，
    // 代理人的工作區直接收不到這一項。
    const ok = await onSave(item, {
      title: t,
      assignee_id: assignee === NO_ASSIGNEE ? deputyId : assignee,
      url: u || null,
    });
    setBusy(false);
    if (ok) setEditing(false);
  };

  if (editing) {
    return (
      <div className="px-3 py-2 space-y-2 bg-muted/20">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="代辦事項"
          className="h-8 text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={assignee} onValueChange={setAssignee}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* 有代理人就直接寫入代理人；沒有代理人才是真的留成未指派 */}
              <SelectItem value={NO_ASSIGNEE}>{deputyId ? "同代理人" : "未指派"}</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="連結（選填）https:// 或 \\NAS\品保\…"
            className="h-8 text-xs font-mono flex-1 min-w-[12rem]"
          />
          <Button size="sm" className="h-8" disabled={busy} onClick={() => void save()}>
            {busy ? "儲存中…" : "儲存"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            disabled={busy}
            onClick={() => setEditing(false)}
          >
            取消
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 px-3 py-2 text-sm">
      {/* 只有握把 draggable：整列 draggable 會讓編輯模式的輸入框沒辦法用滑鼠選字 */}
      {canDrag && (
        <span
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          title="按住拖拉可以調整順序"
          className="mt-0.5 shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/60 hover:text-foreground"
        >
          <GripVertical className="w-4 h-4" />
        </span>
      )}
      <div className="flex-1 min-w-0">
        <div className={done ? "line-through text-muted-foreground break-words" : "break-words"}>
          {item.title}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs mt-0.5">
          {item.assignee_id ? (
            <span className="text-muted-foreground">指派：{nameOf(item.assignee_id)}</span>
          ) : (
            <span className="text-amber-700">未指派</span>
          )}
          {item.url && <ItemUrl url={item.url} />}
          {item.done_at && (
            <span className="text-muted-foreground">
              已完成 {fmt(item.done_at)}
              {item.done_by && ` ・${nameOf(item.done_by)}`}
            </span>
          )}
        </div>
      </div>
      {editable && (
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={startEdit}
            title="編輯這項代辦"
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-muted-foreground hover:text-destructive"
            onClick={() => void onDelete(item)}
            title="刪除這項代辦"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
      {done && !editable && (
        <span className="text-[12.5px] text-muted-foreground shrink-0 inline-flex items-center gap-1">
          <Check className="w-3 h-3" />
          已完成
        </span>
      )}
    </div>
  );
}

/** 新增一列代辦：事項必填，指派與連結選填 */
function AddLeaveItemRow({
  users,
  deputyId,
  onAdd,
}: {
  users: UserOpt[];
  /** 這張請假單目前的代理人；「同代理人」直接寫入這個 id */
  deputyId: string | null;
  onAdd: (input: { title: string; assigneeId: string | null; url: string | null }) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState(NO_ASSIGNEE);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return; // INSERT 連按兩次會真的插兩筆
    setBusy(true);
    const ok = await onAdd({
      title,
      // 跟編輯一致：有代理人就明確寫進去，不依賴 INSERT trigger 的預設值
      assigneeId: assignee === NO_ASSIGNEE ? deputyId : assignee,
      url: url.trim() || null,
    });
    setBusy(false);
    if (ok) {
      setTitle("");
      setUrl("");
      setAssignee(NO_ASSIGNEE);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t bg-muted/10">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder="新增代辦事項（例：追蹤 A 客戶報價回覆）"
        className="h-8 text-sm flex-1 min-w-[12rem]"
      />
      <Select value={assignee} onValueChange={setAssignee}>
        <SelectTrigger className="w-36 h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_ASSIGNEE}>{deputyId ? "同代理人" : "未指派"}</SelectItem>
          {users.map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="連結（選填）https:// 或 \\NAS\品保\…"
        className="h-8 text-xs font-mono w-56"
      />
      <Button size="sm" className="h-8" disabled={busy || !title.trim()} onClick={() => void submit()}>
        <Plus className="w-3.5 h-3.5 mr-1" />
        {busy ? "新增中…" : "新增"}
      </Button>
    </div>
  );
}
