import { createFileRoute, Link } from "@tanstack/react-router";
import { RequirePerm } from "@/components/RequirePerm";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
// eip_leave_roster RPC 尚未進 types.ts，請假名單用 any 版 client（型別在本檔自行宣告）。
import { supabase as supabaseAny } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { humanizeError } from "@/lib/eip-error";
import { isPickableUser } from "@/hooks/useUsers";

export const Route = createFileRoute("/dashboard/eip/calendar")({ component: () => (
    <RequirePerm module="eip_calendar">
      <CalendarPage />
    </RequirePerm>
  ) });

type EventType = "task" | "meeting" | "milestone" | "personal" | "leave" | "announcement";

type CalEvent = {
  id: string;
  type: EventType;
  title: string;
  date: string;
  href?: string;
  taskId?: string;
  meetingId?: string;
  milestoneId?: string;
  projectId?: string;
  announcementId?: string;
  endDate?: string;
  personal?: PersonalEvent;
  leave?: LeaveInfo;
  readOnly?: boolean;
};

type PersonalEvent = {
  id: string;
  user_id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
};

/**
 * eip_leave_roster RPC 的一列（migration 0148）。
 * SECURITY DEFINER，全公司都看得到所有人的請假；刻意不回事由與假別，
 * 所以行事曆上的請假只顯示姓名、部門與時段。
 */
type LeaveRosterRow = {
  id: string;
  user_id: string;
  user_name: string;
  department_name: string | null;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  is_full_day: boolean;
  handover_done: boolean;
};

/** 日格裡請假事件要用到的顯示資訊 */
type LeaveInfo = {
  userName: string;
  departmentName: string | null;
  timeLabel: string;
  handoverDone: boolean;
};

type AppUserLite = { id: string; name: string | null; hide_from_pickers?: boolean | null };

const TIME_OPTIONS: string[] = (() => {
  const arr: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      arr.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return arr;
})();

function fmtTime(t: string | null | undefined) {
  if (!t) return null;
  // accept "HH:MM" or "HH:MM:SS"
  const m = /^(\d{2}):(\d{2})/.exec(t);
  return m ? `${m[1]}:${m[2]}` : null;
}

/** 請假時段文字：全天顯示「全天」，半天顯示 HH:MM–HH:MM */
function leaveTimeLabel(r: LeaveRosterRow) {
  if (r.is_full_day) return "全天";
  const s = fmtTime(r.start_time);
  const e = fmtTime(r.end_time);
  if (s && e) return `${s}–${e}`;
  if (s) return `${s} 起`;
  if (e) return `至 ${e}`;
  return "時段未填";
}

const TYPE_LABEL = { task: "任務", meeting: "會議", milestone: "里程碑", personal: "個人行程", leave: "請假", announcement: "公告" } as const;
const TYPE_COLOR: Record<EventType, string> = {
  task: "bg-blue-100 text-blue-700 border-blue-200",
  meeting: "bg-emerald-100 text-emerald-700 border-emerald-200",
  milestone: "bg-amber-100 text-amber-700 border-amber-200",
  personal: "bg-purple-100 text-purple-700 border-purple-200",
  leave: "bg-rose-100 text-rose-700 border-rose-200",
  announcement: "bg-teal-100 text-teal-700 border-teal-300",
};

/** 日格未展開時最多顯示幾筆 */
const DAY_PREVIEW_COUNT = 4;

function toYMD(d: Date | string | null) {
  if (!d) return null;
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return null;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function CalendarPage() {
  const { user } = useAuth();
  const myId = user?.id ?? "";
  const qc = useQueryClient();

  const [cursor, setCursor] = useState(() => {
    const d = new Date(); d.setDate(1); return d;
  });
  const [show, setShow] = useState({ task: true, meeting: true, milestone: true, personal: true, leave: true, announcement: true });
  // 已展開（顯示全部事項）的日格，key 是該格的 ymd
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // 請假名單按月份範圍查，切月份要重新抓
  const rangeFrom = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const rangeTo = `${year}-${String(month + 1).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
  const today = toYMD(new Date()) ?? rangeFrom;

  const tasksQ = useQuery({
    queryKey: ["cal", "tasks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("task").select("id,title,due_date,start_date").not("due_date", "is", null);
      if (error) throw error;
      return data ?? [];
    },
  });
  const meetingsQ = useQuery({
    queryKey: ["cal", "meetings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("meeting").select("id,title,meeting_date");
      if (error) throw error;
      return data ?? [];
    },
  });
  const milestonesQ = useQuery({
    queryKey: ["cal", "milestones"],
    queryFn: async () => {
      const { data, error } = await supabase.from("milestone").select("id,name,due_date,project_id").not("due_date", "is", null);
      if (error) throw error;
      return data ?? [];
    },
  });
  const personalQ = useQuery({
    queryKey: ["cal", "personal"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("personal_event")
        .select("id,user_id,title,start_date,end_date,start_time,end_time,note");
      if (error) throw error;
      return (data ?? []) as PersonalEvent[];
    },
  });
  // 請假改走 eip_leave_roster RPC（SECURITY DEFINER），全公司每個人都看得到所有人的假。
  // 原本讀 eip_calendar_events view 是 security_invoker，一般成員受 eip_quick_report 的
  // qr_read 政策限制，只看得到自己與自己代理的假，等於行事曆上根本沒有當日請假名單。
  const leaveQ = useQuery({
    queryKey: ["cal", "leave-roster", rangeFrom, rangeTo],
    queryFn: async () => {
      const { data, error } = await supabaseAny.rpc("eip_leave_roster", { p_from: rangeFrom, p_to: rangeTo });
      if (error) throw error;
      return (data ?? []) as LeaveRosterRow[];
    },
  });
  // 「今日請假」不管月曆翻到哪個月都要正確，所以今天單獨查一次（快取以 today 為 key，切月份不會重抓）。
  const todayLeaveQ = useQuery({
    queryKey: ["cal", "leave-roster", today, today],
    queryFn: async () => {
      const { data, error } = await supabaseAny.rpc("eip_leave_roster", { p_from: today, p_to: today });
      if (error) throw error;
      return (data ?? []) as LeaveRosterRow[];
    },
  });
  const sharesQ = useQuery({
    queryKey: ["cal", "personal_shares"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("personal_event_share")
        .select("event_id,shared_with_user_id");
      if (error) throw error;
      return data ?? [];
    },
  });
  const usersQ = useQuery({
    queryKey: ["cal", "app_users"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_user").select("id,name,hide_from_pickers").eq("status", "active");
      if (error) throw error;
      return (data ?? []) as AppUserLite[];
    },
  });
  // 公告：以發布日期（published_at）落在行事曆上；未發布（草稿）不顯示。
  // RLS 會依對象自動過濾，使用者只會看到自己看得到的公告，與公告頁一致。
  const announcementsQ = useQuery({
    queryKey: ["cal", "announcements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("announcement")
        .select("id,title,published_at")
        .not("published_at", "is", null);
      if (error) throw error;
      return data ?? [];
    },
  });

  const events = useMemo<CalEvent[]>(() => {
    const list: CalEvent[] = [];
    if (show.task) {
      (tasksQ.data ?? []).forEach((t: any) => {
        const d = toYMD(t.due_date);
        if (d) list.push({ id: `t-${t.id}`, type: "task", title: t.title, date: d, endDate: toYMD(t.start_date) ?? undefined, href: `/dashboard/eip/tasks`, taskId: t.id });
      });
    }
    if (show.meeting) {
      (meetingsQ.data ?? []).forEach((m: any) => {
        const d = toYMD(m.meeting_date);
        if (d) list.push({ id: `m-${m.id}`, type: "meeting", title: m.title, date: d, meetingId: m.id });
      });
    }
    if (show.milestone) {
      (milestonesQ.data ?? []).forEach((ms: any) => {
        const d = toYMD(ms.due_date);
        if (d) list.push({ id: `ms-${ms.id}`, type: "milestone", title: ms.name, date: d, projectId: ms.project_id ?? undefined, milestoneId: ms.id });
      });
    }
    if (show.announcement) {
      (announcementsQ.data ?? []).forEach((a: any) => {
        const d = toYMD(a.published_at);
        if (d) list.push({ id: `a-${a.id}`, type: "announcement", title: a.title, date: d, announcementId: a.id });
      });
    }
    if (show.personal) {
      (personalQ.data ?? []).forEach((p) => {
        const d = toYMD(p.start_date);
        if (d) list.push({
          id: `p-${p.id}`,
          type: "personal",
          title: p.title,
          date: d,
          endDate: toYMD(p.end_date) ?? undefined,
          personal: p,
          readOnly: p.user_id !== myId,
        });
      });
    }
    if (show.leave) {
      (leaveQ.data ?? []).forEach((lv) => {
        const start = toYMD(lv.start_date);
        const end = toYMD(lv.end_date) ?? start;
        if (!start) return;
        const timeLabel = leaveTimeLabel(lv);
        // 跨日的假要每一天都出現，否則只看得到第一天
        const cur = new Date(start + "T00:00:00");
        const last = new Date((end ?? start) + "T00:00:00");
        let guard = 0;
        while (cur <= last && guard < 62) {
          const d = toYMD(cur);
          if (d) {
            list.push({
              id: `lv-${lv.id}-${d}`,
              type: "leave",
              // RPC 不回事由與假別，標題只放請假人姓名
              title: lv.user_name,
              date: d,
              endDate: end ?? undefined,
              // 一般成員沒有權限看請假詳情，所以不做成可點擊跳轉，只用 tooltip 補資訊
              readOnly: true,
              leave: {
                userName: lv.user_name,
                departmentName: lv.department_name,
                timeLabel,
                handoverDone: lv.handover_done,
              },
            });
          }
          cur.setDate(cur.getDate() + 1);
          guard += 1;
        }
      });
    }
    return list;
  }, [tasksQ.data, meetingsQ.data, milestonesQ.data, personalQ.data, leaveQ.data, announcementsQ.data, show, myId]);

  const firstDow = new Date(year, month, 1).getDay();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const eventsByDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    events.forEach((e) => {
      const arr = m.get(e.date) ?? [];
      arr.push(e);
      m.set(e.date, arr);
    });
    return m;
  }, [events]);

  const toggleDay = (ymd: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(ymd)) next.delete(ymd);
      else next.add(ymd);
      return next;
    });
  };
  // 本月哪些日格超過預覽筆數（只有這些格子需要展開／收合）
  const overflowDays = cells
    .map((d) => (d ? toYMD(d) : null))
    .filter((ymd): ymd is string => !!ymd && (eventsByDay.get(ymd)?.length ?? 0) > DAY_PREVIEW_COUNT);
  const allExpanded = overflowDays.length > 0 && overflowDays.every((ymd) => expandedDays.has(ymd));
  const toggleAllDays = () => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      overflowDays.forEach((ymd) => { if (allExpanded) next.delete(ymd); else next.add(ymd); });
      return next;
    });
  };

  // 今日請假名單：不受 show.leave 篩選影響，所有人都看得到
  const todayLeaves = useMemo(
    () => [...(todayLeaveQ.data ?? [])].sort((a, b) => a.user_name.localeCompare(b.user_name, "zh-Hant")),
    [todayLeaveQ.data],
  );
  // 兩支請假查詢任一失敗都要讓使用者看得出來，不能顯示成 0 筆或空白
  const leaveFailed = todayLeaveQ.isError || leaveQ.isError;
  const retryLeave = () => {
    void todayLeaveQ.refetch();
    void leaveQ.refetch();
  };

  // ---- Personal event dialog ----
  const [peOpen, setPeOpen] = useState(false);
  const [peEditing, setPeEditing] = useState<PersonalEvent | null>(null);
  const [peTitle, setPeTitle] = useState("");
  const [peStart, setPeStart] = useState("");
  const [peEnd, setPeEnd] = useState("");
  const [peStartTime, setPeStartTime] = useState("");
  const [peEndTime, setPeEndTime] = useState("");
  const [peNote, setPeNote] = useState("");
  const [peShares, setPeShares] = useState<string[]>([]);
  const [peSubmitting, setPeSubmitting] = useState(false);
  const [peViewing, setPeViewing] = useState<PersonalEvent | null>(null);

  const sharesByEvent = useMemo(() => {
    const m = new Map<string, string[]>();
    (sharesQ.data ?? []).forEach((s: any) => {
      const arr = m.get(s.event_id) ?? [];
      arr.push(s.shared_with_user_id);
      m.set(s.event_id, arr);
    });
    return m;
  }, [sharesQ.data]);

  const openCreatePe = () => {
    setPeEditing(null);
    setPeTitle("");
    setPeStart(today);
    setPeEnd("");
    setPeStartTime("");
    setPeEndTime("");
    setPeNote("");
    setPeShares([]);
    setPeOpen(true);
  };
  const openEditPe = (p: PersonalEvent) => {
    setPeEditing(p);
    setPeTitle(p.title);
    setPeStart(toYMD(p.start_date) ?? "");
    setPeEnd(toYMD(p.end_date) ?? "");
    setPeStartTime(fmtTime(p.start_time) ?? "");
    setPeEndTime(fmtTime(p.end_time) ?? "");
    setPeNote(p.note ?? "");
    setPeShares(sharesByEvent.get(p.id) ?? []);
    setPeOpen(true);
  };
  const toggleShare = (uid: string) => {
    setPeShares((prev) => prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]);
  };

  const savePe = async () => {
    if (!peTitle.trim() || !peStart) { toast.error("請填寫標題與開始日期"); return; }
    setPeSubmitting(true);
    let eventId = peEditing?.id ?? null;
    if (peEditing) {
      const { error } = await supabase.from("personal_event").update({
        title: peTitle.trim(),
        start_date: peStart,
        end_date: peEnd || null,
        start_time: peStartTime || null,
        end_time: peEndTime || null,
        note: peNote.trim() || null,
      } as any).eq("id", peEditing.id);
      if (error) { setPeSubmitting(false); toast.error(humanizeError(error, "儲存行程")); return; }
      // 先清掉舊的分享對象再重建；失敗就停下來，避免顯示「已儲存」但被移除的人仍看得到（2026-10-17 總檢查）
      const { error: shErr } = await supabase.from("personal_event_share").delete().eq("event_id", peEditing.id);
      if (shErr) { setPeSubmitting(false); toast.error(humanizeError(shErr, "更新分享對象")); return; }
    } else {
      const { data, error } = await supabase.from("personal_event").insert({
        title: peTitle.trim(),
        start_date: peStart,
        end_date: peEnd || null,
        start_time: peStartTime || null,
        end_time: peEndTime || null,
        note: peNote.trim() || null,
      } as any).select("id").single();
      if (error) { setPeSubmitting(false); toast.error(humanizeError(error, "建立行程")); return; }
      eventId = data.id;
    }
    if (eventId && peShares.length > 0) {
      const rows = peShares.map((uid) => ({ event_id: eventId!, shared_with_user_id: uid }));
      const { error } = await supabase.from("personal_event_share").insert(rows);
      if (error) { setPeSubmitting(false); toast.error(humanizeError(error, "分享行程")); return; }
    }
    setPeSubmitting(false);
    setPeOpen(false);
    toast.success("已儲存");
    qc.invalidateQueries({ queryKey: ["cal", "personal"] });
    qc.invalidateQueries({ queryKey: ["cal", "personal_shares"] });
  };

  const deletePe = async () => {
    if (!peEditing) return;
    if (!confirm("確定刪除此個人行程？")) return;
    setPeSubmitting(true);
    // personal_event 掛了 BEFORE DELETE 的軟刪除 guard，.delete() 的 ROW_COUNT 一律 0、
    // error 一律 null → 原本無論如何都跳「已刪除」。改走 eip_soft_delete 檢查 {ok}。
    // 另外原本會先硬刪 personal_event_share：行程是軟刪除（管理者可還原），分享名單卻
    // 被真的刪掉，還原之後所有分享對象都不見了，所以這句一併移除。
    const { data, error } = await supabaseAny.rpc("eip_soft_delete", {
      p_module: "eip_calendar",
      p_id: peEditing.id,
    });
    setPeSubmitting(false);
    if (error) { toast.error(humanizeError(error, "刪除行程")); return; }
    if ((data as { ok?: boolean; reason?: string } | null)?.ok !== true) {
      toast.error((data as { reason?: string } | null)?.reason ?? "刪除失敗：只有行程建立者可以刪除");
      return;
    }
    setPeOpen(false);
    toast.success("已刪除");
    qc.invalidateQueries({ queryKey: ["cal", "personal"] });
    qc.invalidateQueries({ queryKey: ["cal", "personal_shares"] });
  };

  const userMap = useMemo(() => {
    const m = new Map<string, string>();
    (usersQ.data ?? []).forEach((u) => m.set(u.id, u.name ?? u.id));
    return m;
  }, [usersQ.data]);

  return (
    <div>
      <PageHeader
        title="行事曆"
        description="整合任務、會議、里程碑、個人行程、請假名單與公告於同一視圖。"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="icon" onClick={() => setCursor(new Date(year, month - 1, 1))}><ChevronLeft className="w-4 h-4" /></Button>
            <div className="text-sm font-medium w-28 text-center">{year} 年 {month + 1} 月</div>
            <Button variant="outline" size="icon" onClick={() => setCursor(new Date(year, month + 1, 1))}><ChevronRight className="w-4 h-4" /></Button>
            <Button variant="ghost" size="sm" onClick={() => { const d = new Date(); d.setDate(1); setCursor(d); }}>今天</Button>
            <Button size="sm" onClick={openCreatePe}>＋ 新增行程</Button>
          </div>
        }
      />

      <div className="mb-3 flex items-center gap-4 text-xs flex-wrap">
        {(Object.keys(TYPE_LABEL) as Array<keyof typeof TYPE_LABEL>).map((k) => (
          <label key={k} className="flex items-center gap-1.5 cursor-pointer">
            <Checkbox checked={show[k]} onCheckedChange={(v) => setShow((s) => ({ ...s, [k]: !!v }))} />
            <span className={`inline-block w-3 h-3 rounded ${TYPE_COLOR[k].split(" ")[0]}`} />
            {TYPE_LABEL[k]}
          </label>
        ))}
        {overflowDays.length > 0 && (
          <Button variant="outline" size="sm" className="h-6 text-xs ml-auto" onClick={toggleAllDays}>
            {allExpanded ? "全部收合" : "全部展開"}
          </Button>
        )}
      </div>

      <Card className="mb-3">
        <CardContent className="p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-medium">今日請假</h2>
            <span className="text-xs text-muted-foreground">{today}</span>
          </div>
          {leaveFailed ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-destructive">請假名單載入失敗</span>
              <Button size="sm" variant="outline" className="h-6 text-xs" onClick={retryLeave}>重試</Button>
            </div>
          ) : todayLeaveQ.isLoading ? (
            <p className="text-xs text-muted-foreground">請假名單載入中…</p>
          ) : todayLeaves.length === 0 ? (
            <p className="text-xs text-muted-foreground/70">今天沒有人請假</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {todayLeaves.map((lv) => (
                <div key={lv.id} className="flex items-center gap-2 text-xs border rounded-md px-2 py-1">
                  <span className="font-medium">{lv.user_name}</span>
                  <span className="text-muted-foreground">{lv.department_name ?? "未設部門"}</span>
                  <span className="text-muted-foreground">{leaveTimeLabel(lv)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="grid grid-cols-7 text-xs text-muted-foreground border-b">
            {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
              <div key={d} className="px-2 py-1.5 text-center">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d, i) => {
              const ymd = d ? toYMD(d) : null;
              const evs = ymd ? eventsByDay.get(ymd) ?? [] : [];
              const isToday = ymd === today;
              const expanded = !!ymd && expandedDays.has(ymd);
              const visible = expanded ? evs : evs.slice(0, DAY_PREVIEW_COUNT);
              return (
                <div key={i} className={`min-h-[110px] h-auto border-r border-b p-1.5 ${isToday ? "bg-accent/30" : ""}`}>
                  {d && (
                    <>
                      <div className={`text-xs font-medium mb-1 ${isToday ? "text-primary" : "text-muted-foreground"}`}>{d.getDate()}</div>
                      <div className="space-y-1">
                        {visible.map((e) => {
                          const cls = `block text-[12.5px] truncate px-1.5 py-0.5 rounded border ${TYPE_COLOR[e.type]}`;
                          const displayTitle = (e.type === "personal" && e.personal && fmtTime(e.personal.start_time))
                            ? `${fmtTime(e.personal.start_time)} ${e.title}`
                            : e.title;
                          if (e.type === "leave" && e.leave) {
                            const lv = e.leave;
                            // 一般成員沒有權限看請假詳情，所以不做連結，資訊放 tooltip
                            const tip = `請假：${lv.userName}（${lv.departmentName ?? "未設部門"}）${lv.timeLabel}`;
                            return (
                              <div key={e.id} className={cls} title={tip}>
                                {lv.userName}
                              </div>
                            );
                          }
                          if (e.type === "personal" && e.personal) {
                            const onClick = () => {
                              if (e.readOnly) setPeViewing(e.personal!);
                              else openEditPe(e.personal!);
                            };
                            return (
                              <button key={e.id} type="button" onClick={onClick} className={cls + " hover:opacity-80 text-left w-full"} title={`[${TYPE_LABEL[e.type]}] ${displayTitle}`}>
                                {displayTitle}
                              </button>
                            );
                          }
                          if (e.type === "task" && e.taskId) {
                            return (
                              <Link
                                key={e.id}
                                to="/dashboard/eip/tasks"
                                search={{ openTask: e.taskId }}
                                className={cls + " hover:opacity-80"}
                                title={`[${TYPE_LABEL[e.type]}] ${displayTitle}`}
                              >
                                {displayTitle}
                              </Link>
                            );
                          }
                          if (e.type === "meeting" && e.meetingId) {
                            return (
                              <Link
                                key={e.id}
                                to="/dashboard/eip/meetings/$id"
                                params={{ id: e.meetingId }}
                                className={cls + " hover:opacity-80"}
                                title={`[${TYPE_LABEL[e.type]}] ${displayTitle}`}
                              >
                                {displayTitle}
                              </Link>
                            );
                          }
                          if (e.type === "announcement" && e.announcementId) {
                            return (
                              <Link
                                key={e.id}
                                to="/dashboard/eip/announcements"
                                search={{ open: e.announcementId }}
                                className={cls + " hover:opacity-80"}
                                title={`[${TYPE_LABEL[e.type]}] ${displayTitle}`}
                              >
                                {displayTitle}
                              </Link>
                            );
                          }
                          if (e.type === "milestone" && e.projectId) {
                            return (
                              <Link
                                key={e.id}
                                to="/dashboard/eip/projects/$id"
                                params={{ id: e.projectId }}
                                search={{ milestone: e.milestoneId }}
                                className={cls + " hover:opacity-80"}
                                title={`[${TYPE_LABEL[e.type]}] ${displayTitle}`}
                              >
                                {displayTitle}
                              </Link>
                            );
                          }
                          return e.href ? (
                            <Link key={e.id} to={e.href as any} className={cls + " hover:opacity-80"} title={`[${TYPE_LABEL[e.type]}] ${displayTitle}`}>
                              {displayTitle}
                            </Link>
                          ) : (
                            <div key={e.id} className={cls} title={`[${TYPE_LABEL[e.type]}] ${displayTitle}`}>{displayTitle}</div>
                          );
                        })}
                        {ymd && evs.length > DAY_PREVIEW_COUNT && (
                          <button
                            type="button"
                            onClick={() => toggleDay(ymd)}
                            className="text-[11.5px] text-muted-foreground hover:text-foreground hover:underline px-1 text-left w-full"
                          >
                            {expanded ? "收合" : `+${evs.length - DAY_PREVIEW_COUNT}`}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Dialog open={peOpen} onOpenChange={(o) => { if (!o) setPeOpen(false); }}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{peEditing ? "編輯個人行程" : "新增個人行程"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">標題 *</Label>
              <Input value={peTitle} onChange={(e) => setPeTitle(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">開始日期 *</Label>
                <Input type="date" value={peStart} onChange={(e) => setPeStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">開始時間</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={peStartTime}
                  onChange={(e) => setPeStartTime(e.target.value)}
                >
                  <option value="">整天 / 不指定</option>
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">結束日期</Label>
                <Input type="date" value={peEnd} onChange={(e) => setPeEnd(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">結束時間</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={peEndTime}
                  onChange={(e) => setPeEndTime(e.target.value)}
                >
                  <option value="">整天 / 不指定</option>
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">備註</Label>
              <Textarea value={peNote} onChange={(e) => setPeNote(e.target.value)} rows={3} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">分享給</Label>
              <div className="max-h-40 overflow-y-auto border rounded-md p-2 space-y-1">
                {(usersQ.data ?? []).filter((u) => u.id !== myId && isPickableUser(u)).map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={peShares.includes(u.id)} onCheckedChange={() => toggleShare(u.id)} />
                    <span>{u.name ?? u.id}</span>
                  </label>
                ))}
                {(usersQ.data ?? []).filter((u) => u.id !== myId && isPickableUser(u)).length === 0 && (
                  <p className="text-xs text-muted-foreground">無其他成員</p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            {peEditing && (
              <Button variant="destructive" onClick={deletePe} disabled={peSubmitting} className="mr-auto">刪除</Button>
            )}
            <Button variant="outline" onClick={() => setPeOpen(false)} disabled={peSubmitting}>取消</Button>
            <Button onClick={savePe} disabled={peSubmitting}>{peSubmitting ? "儲存中…" : "儲存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!peViewing} onOpenChange={(o) => { if (!o) setPeViewing(null); }}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{peViewing?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">建立者：</span>{peViewing ? (userMap.get(peViewing.user_id) ?? peViewing.user_id) : ""}</p>
            <p><span className="text-muted-foreground">日期：</span>{peViewing?.start_date}{peViewing?.end_date ? ` ~ ${peViewing.end_date}` : ""}</p>
            {(peViewing?.start_time || peViewing?.end_time) && (
              <p><span className="text-muted-foreground">時間：</span>{fmtTime(peViewing?.start_time) ?? "—"}{peViewing?.end_time ? ` ~ ${fmtTime(peViewing.end_time)}` : ""}</p>
            )}
            {peViewing?.note && (
              <p className="whitespace-pre-wrap"><span className="text-muted-foreground">備註：</span>{peViewing.note}</p>
            )}
            <p className="text-xs text-muted-foreground">此為他人分享給你的行程，僅可檢視。</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPeViewing(null)}>關閉</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
