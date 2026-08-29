import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Inbox, ExternalLink, Link2, FolderOpen, CalendarOff, Check } from "lucide-react";
import { toast } from "sonner";

// eip_handover_item 與 eip_leave_handover_item 尚未進 types.ts，用寬鬆型別的 client
import { supabase } from "@/lib/supabase";
import { useAllUsers } from "@/hooks/useUsers";
import { isLocalPath, copyPath } from "@/lib/eip-url";
import { LeaveRequestDialog } from "@/components/eip/LeaveRequestDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { humanizeError } from "@/lib/eip-error";

const ENTITY_LABEL: Record<string, string> = {
  task: "任務",
  task_collaborator: "任務協作",
  project: "專案",
  recurring_rule: "常態工作",
  meeting_action_item: "會議決議",
  deputy: "職務代理人",
};

type Row = {
  id: string;
  entity_type: string;
  entity_title: string | null;
  escalated_level: number;
};

/** eip_leave_handover_item + 所屬請假單的請假人與區間 */
type LeaveRow = {
  id: string;
  title: string;
  url: string | null;
  quick_report_id: string;
  done_at: string | null;
  submitter_id: string | null;
  leave_from: string | null;
  leave_to: string | null;
  /** 請假單讀不到（RLS）時為 true，用來誠實顯示而不是假裝欄位是空的 */
  report_unreadable: boolean;
};

type LeaveGroup = {
  reportId: string;
  submitterId: string | null;
  from: string | null;
  to: string | null;
  unreadable: boolean;
  items: LeaveRow[];
  done: number;
};

// 請假區間只需要「哪幾天」，用本地日期字串；toISOString() 在 UTC+8 會退回前一天
const localDate = (iso: string) => new Date(iso).toLocaleDateString("sv-SE");
const todayLocal = () => new Date().toLocaleDateString("sv-SE");

// 寫回 done_at 用「帶時區位移」的本地時間戳，同樣是為了避開 UTC 字串造成的日期偏移
function nowWithOffset() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const offMin = -d.getTimezoneOffset();
  const abs = Math.abs(offMin);
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${offMin >= 0 ? "+" : "-"}${p(Math.floor(abs / 60))}:${p(abs % 60)}`
  );
}

const formatRange = (from: string | null, to: string | null) => {
  if (!from && !to) return "未填區間";
  if (from && to) {
    const a = localDate(from);
    const b = localDate(to);
    return a === b ? a : `${a} ～ ${b}`;
  }
  return localDate((from ?? to) as string);
};

const formatDoneAt = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * 「我的工作區」的代理事項區塊（規劃圖第 ⑥ 類、規格書原型 H-2）。
 *
 * 兩段來源都是「別人的事落到我身上」，放同一張卡才不會讓人以為只有離職交接：
 *  - 離職交接（eip_handover_item）：只提示與跳轉，處理動作留在交接待辦頁一處，
 *    避免兩邊都能改狀態。
 *  - 請假代辦（eip_leave_handover_item）：照原型 H-2 以「代理：某人（區間）x/y」
 *    分組，就地勾完成、顯示完成時間。這類項目本來就是「代理人做完就打勾」，
 *    多繞一頁反而沒人打勾。請假單的 status 由 DB trigger 依完成度回寫，
 *    前端只寫 done_at。
 *
 * 這張卡同時是「請假＋交接一次填完」的**選填**入口（LeaveRequestDialog），
 * 所以即使沒有任何待辦也會顯示那顆按鈕。主管不核准、不簽核，只收通知。
 *
 * 2026-07-30 定案調整：臨時請假的主路徑改回「快速回報 → 請假」（只填區間＋事由、
 * 一鍵送出），代理人與交接代辦一律在「交接代辦」頁補登。這裡的完整版表單留給
 * 有時間一次填完的人用，不是必經路徑。
 */
export function HandoverInboxCard({ meId }: { meId: string }) {
  const qc = useQueryClient();
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [leaveOpen, setLeaveOpen] = useState(false);

  const q = useQuery({
    enabled: !!meId,
    queryKey: ["eip", "handover-inbox", meId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eip_handover_item")
        .select("id,entity_type,entity_title,escalated_level")
        .eq("assignee_id", meId)
        .eq("status", "pending")
        .order("escalated_level", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const leaveKey = useMemo(() => ["eip", "leave-handover-inbox", meId] as const, [meId]);
  const leaveQ = useQuery({
    enabled: !!meId,
    queryKey: leaveKey,
    queryFn: async () => {
      // 抓「指派給我」的全部項目（含已完成），因為原型要顯示 x/y 與完成時間。
      // 分組與過濾在下面做，不在這裡先砍掉已完成的。
      // 撈取順序改成 created_at 新到舊，再在前端依 sort_order 排回卡片內的顯示順序。
      // 原本直接 order("sort_order") + limit(200)：sort_order 每張假單各自從 0 開始、
      // 跨假單大量重複，Postgres 對並列列的取捨是不定的，累積超過 200 筆之後
      // 新指派的代辦可能根本不在回傳的 200 筆裡 —— 收件匣不顯示、徽章也漏算，
      // 代理人不知道有事要做。卡片內的排序（拖拉結果）仍然照 sort_order。
      const { data, error } = await supabase
        .from("eip_leave_handover_item")
        .select("id,title,url,quick_report_id,done_at,sort_order")
        .eq("assignee_id", meId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .limit(200);
      if (error) throw error;
      const items = ((data ?? []) as unknown as (Omit<
        LeaveRow,
        "submitter_id" | "leave_from" | "leave_to" | "report_unreadable"
      > & { sort_order: number | null })[]).sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
      );
      if (items.length === 0) return [] as LeaveRow[];

      // 請假人與區間分開查：這張表還沒進 types.ts，巢狀 select 的關聯名稱無法用型別驗證，
      // 拆成兩次查詢出錯時比較容易判斷是哪一段被 RLS 擋掉
      const reportIds = Array.from(new Set(items.map((i) => i.quick_report_id)));
      const { data: reports, error: repErr } = await supabase
        .from("eip_quick_report")
        .select("id,submitter_id,leave_from,leave_to")
        .in("id", reportIds);
      if (repErr) throw repErr;
      const byId = new Map(
        (
          (reports ?? []) as unknown as {
            id: string;
            submitter_id: string | null;
            leave_from: string | null;
            leave_to: string | null;
          }[]
        ).map((r) => [r.id, r]),
      );
      return items.map(({ sort_order: _sortOrder, ...i }) => {
        const rep = byId.get(i.quick_report_id);
        return {
          ...i,
          submitter_id: rep?.submitter_id ?? null,
          leave_from: rep?.leave_from ?? null,
          leave_to: rep?.leave_to ?? null,
          // RLS 擋住時 PostgREST 是回空集合而不是錯誤，不能假裝欄位本來就是空的
          report_unreadable: !rep,
        } satisfies LeaveRow;
      });
    },
  });

  // 請假人可能已停用，姓名對照要用含停用的版本
  const usersQ = useAllUsers();
  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    (usersQ.data ?? []).forEach((u) => m.set(u.id, u.name ?? "—"));
    return m;
  }, [usersQ.data]);
  const nameOf = (id: string | null) => (id ? (nameMap.get(id) ?? "—") : "—");

  const rows = q.data ?? [];

  /** 照原型 H-2 以請假單分組；只留「還有未完成」或「假還沒結束」的組，避免歷史堆積 */
  const groups = useMemo<LeaveGroup[]>(() => {
    const today = todayLocal();
    const m = new Map<string, LeaveGroup>();
    (leaveQ.data ?? []).forEach((it) => {
      let g = m.get(it.quick_report_id);
      if (!g) {
        g = {
          reportId: it.quick_report_id,
          submitterId: it.submitter_id,
          from: it.leave_from,
          to: it.leave_to,
          unreadable: it.report_unreadable,
          items: [],
          done: 0,
        };
        m.set(it.quick_report_id, g);
      }
      g.items.push(it);
      if (it.done_at) g.done += 1;
    });
    return Array.from(m.values()).filter((g) => {
      const hasOpen = g.done < g.items.length;
      const ongoing = g.to ? localDate(g.to) >= today : true;
      return hasOpen || ongoing;
    });
  }, [leaveQ.data]);

  const openLeaveCount = groups.reduce((n, g) => n + (g.items.length - g.done), 0);
  const total = rows.length + openLeaveCount;
  const hasError = q.isError || leaveQ.isError || usersQ.isError;

  /** 勾完成／取消完成：done_by 由 trigger 蓋章，前端只寫 done_at */
  const toggleLeaveDone = async (row: LeaveRow) => {
    if (busyIds.has(row.id)) return;
    setBusyIds((p) => new Set(p).add(row.id));
    const next = row.done_at ? null : nowWithOffset();
    // 樂觀更新只改這一筆 —— 整批快照覆寫會讓同時在飛的另一筆被打回去
    qc.setQueryData<LeaveRow[]>(leaveKey, (cur) =>
      (cur ?? []).map((x) => (x.id === row.id ? { ...x, done_at: next } : x)),
    );
    // 方向是用本地快取算的，所以加樂觀鎖：DB 端不是我以為的狀態就不要改，
    // 否則別人剛勾完成、我這邊還是舊快取，一點就把它取消掉
    let upd = supabase.from("eip_leave_handover_item").update({ done_at: next }).eq("id", row.id);
    upd = next ? upd.is("done_at", null) : upd.not("done_at", "is", null);
    const { data, error } = await upd.select("id");
    setBusyIds((p) => {
      const n = new Set(p);
      n.delete(row.id);
      return n;
    });
    const rollback = () =>
      qc.setQueryData<LeaveRow[]>(leaveKey, (cur) =>
        (cur ?? []).map((x) => (x.id === row.id ? { ...x, done_at: row.done_at } : x)),
      );
    if (error) {
      rollback();
      return toast.error(humanizeError(error, "更新"));
    }
    if (!data?.length) {
      // 0 筆＝樂觀鎖沒過或被 RLS 擋掉，兩者 PostgREST 都是 error=null
      rollback();
      void leaveQ.refetch();
      return toast.error("這一項已被他人更新，請重新整理後再試");
    }
    toast.success(next ? "已標記完成" : "已取消完成");
    void leaveQ.refetch();
    // 請假單 status 由 trigger 依完成度回寫，臨時回報頁要跟著重讀
    void qc.invalidateQueries({ queryKey: ["eip", "quick-reports"] });
  };

  const escalated = rows.filter((r) => r.escalated_level > 0).length;
  const showInbox = hasError || total > 0;

  return (
    <>
      <Card className="mb-3 border-accent/40">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Inbox className="w-4 h-4 text-accent shrink-0" />
            <span className="text-sm font-semibold">代理事項</span>
            {total > 0 && (
              <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                {total}
              </span>
            )}
            <div className="flex-1" />
            {/* 代理人與代辦事項改成事後補登，補登的地方在「交接代辦」，這裡給一個入口 */}
            <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
              <Link to="/dashboard/eip/handover">補登交接代辦</Link>
            </Button>
            {/* 選填的完整版入口：請假＋代理人＋代辦一次填完。
                只想快點把假報掉的人走右下角「快速回報 → 請假」。 */}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setLeaveOpen(true)}
            >
              <CalendarOff className="w-3.5 h-3.5 mr-1" />
              請假＋交接一次填
            </Button>
          </div>

          {!showInbox ? (
            <div className="text-xs text-muted-foreground">
              目前沒有需要你接手的代辦。請假按上面的「我要請假」，只要填請假區間就能送出，
              不需要主管核准；代理人與代辦事項可以之後到「交接代辦」頁面補登。
            </div>
          ) : (
            <>
              {usersQ.isError && (
                <div className="text-[12.5px] text-destructive mb-2">
                  人員清單載入失敗，下面的姓名可能顯示不出來。
                </div>
              )}

              {/* 離職交接 */}
              {(q.isError || rows.length > 0) && (
                <div className="mb-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-medium text-muted-foreground">離職交接</span>
                    {escalated > 0 && (
                      <span className="text-[11.5px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                        {escalated} 筆已催辦
                      </span>
                    )}
                    <div className="flex-1" />
                    <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
                      <Link to="/dashboard/eip/handover">
                        前往處理
                        <ExternalLink className="w-3 h-3 ml-1" />
                      </Link>
                    </Button>
                  </div>
                  {q.isError ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-destructive">離職交接載入失敗</span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs"
                        onClick={() => void q.refetch()}
                      >
                        重試
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {rows.slice(0, 5).map((r) => (
                        <div
                          key={r.id}
                          className="flex items-center gap-2 text-sm rounded-md border px-2 py-1.5"
                        >
                          <span className="text-[11.5px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                            {ENTITY_LABEL[r.entity_type] ?? r.entity_type}
                          </span>
                          <span className="flex-1 min-w-0 truncate">
                            {r.entity_title ?? "（無標題）"}
                          </span>
                        </div>
                      ))}
                      {rows.length > 5 && (
                        <div className="text-[12.5px] text-muted-foreground pl-1">
                          另有 {rows.length - 5} 筆，請到交接待辦頁查看
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 請假代辦（原型 H-2：以請假單分組，就地勾完成） */}
              {leaveQ.isError ? (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-destructive">請假代辦載入失敗</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs"
                    onClick={() => void leaveQ.refetch()}
                  >
                    重試
                  </Button>
                </div>
              ) : (
                groups.map((g) => (
                  <div key={g.reportId} className="rounded-md border mb-2 last:mb-0 overflow-hidden">
                    <div className="flex items-center gap-2 px-2 py-1.5 bg-muted/40">
                      <span className="text-xs font-medium">
                        代理：{g.unreadable ? "（無檢視權限）" : nameOf(g.submitterId)}
                        {!g.unreadable && `（${formatRange(g.from, g.to)}）`}
                      </span>
                      <div className="flex-1" />
                      <span className="text-[12.5px] text-muted-foreground bg-background rounded-full px-2 py-0.5">
                        {g.done}/{g.items.length}
                      </span>
                    </div>
                    <div className="divide-y">
                      {g.items.map((it) => (
                        <div key={it.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                          <Checkbox
                            checked={!!it.done_at}
                            disabled={busyIds.has(it.id)}
                            onCheckedChange={() => void toggleLeaveDone(it)}
                            aria-label={it.done_at ? "取消完成" : "標記完成"}
                          />
                          <span
                            className={`flex-1 min-w-0 break-words ${it.done_at ? "line-through text-muted-foreground" : ""}`}
                          >
                            {it.title}
                          </span>
                          {it.url &&
                            (isLocalPath(it.url) ? (
                              // UNC／file:// 不能當超連結開（瀏覽器會把 \ 正規化成 / 或直接封鎖）
                              <button
                                type="button"
                                onClick={() => void copyPath(it.url!, toast.success, toast.info)}
                                title={`${it.url}（點擊複製路徑）`}
                                className="text-muted-foreground hover:text-primary shrink-0"
                              >
                                <FolderOpen className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <a
                                href={it.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline shrink-0"
                                title={it.url}
                              >
                                <Link2 className="w-3.5 h-3.5" />
                              </a>
                            ))}
                          <span className="text-[12.5px] text-muted-foreground shrink-0 w-20 text-right tabular-nums">
                            {it.done_at ? formatDoneAt(it.done_at) : "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                    {g.done === g.items.length && (
                      <div className="px-2 py-1 text-[12.5px] text-muted-foreground bg-muted/20 flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        全部完成，已自動通知休假人與單位主管
                      </div>
                    )}
                  </div>
                ))
              )}
              {groups.length > 0 && (
                <p className="text-[12.5px] text-muted-foreground">
                  完成度即時回傳，休假人與單位主管都看得到；主管不需要按任何按鈕。
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <LeaveRequestDialog open={leaveOpen} onClose={() => setLeaveOpen(false)} />
    </>
  );
}
