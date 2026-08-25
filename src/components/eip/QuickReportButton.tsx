import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useEipUser } from "@/lib/eip-user";
import { DEFAULT_TENANT_ID, LEAVE_TYPE_LABEL } from "@/lib/eip-constants";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { humanizeError } from "@/lib/eip-error";
import { RangeSummary } from "@/components/eip/RangeSummary";
import {
  summarizeDateRange,
  summarizeTimeRange,
  syncFromDate,
  syncToDate,
  syncToTime,
} from "@/lib/eip-datetime-range";
import { useQuery, useQueryClient } from "@tanstack/react-query";

// 本地日期 YYYY-MM-DD（台北）
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
// 組成帶時區的時間戳（台北 +08:00）
const ts = (date: string, time: string) => `${date}T${(time || "00:00")}:00+08:00`;

const TYPE_LABEL: Record<string, string> = { late: "遲到", leave: "請假", other: "事件" };
const TYPE_COLOR: Record<string, string> = {
  late: "bg-amber-100 text-amber-700 border-amber-300",
  leave: "bg-blue-100 text-blue-700 border-blue-300",
  other: "bg-slate-100 text-slate-700 border-slate-300",
};
// acknowledged 不是完成：代辦全數完成才會由 DB trigger 推到 done，
// 任一項被取消完成就退回 acknowledged。與臨時回報頁採同一套口徑。
const STATUS_LABEL: Record<string, string> = { open: "待處理", acknowledged: "處理中", done: "已完成", closed: "已完成" };
const DONE_STATUSES = new Set(["done", "closed"]);

/**
 * 快速回報（右下角浮動按鈕）。
 *
 * 請假這一頁刻意「只收區間＋事由，按送出就成立」：
 *  ・臨時請假的當下不一定有時間把交接登打仔細，強迫填代理人與代辦會讓人乾脆不回報。
 *  ・**代理人與交接代辦一律在「交接代辦」頁補登**（那一頁的「我的請假交接」區塊
 *    可以指定／更換代理人、新增／編輯／刪除代辦、逐項指派）。
 *  ・有時間一次填完的人走「我的工作區」交接卡片上的 LeaveRequestDialog，
 *    那是選填的完整版入口，不是必經路徑。
 *  ・假別為必填（2026-08 依需求回復，選項取自 leave_type 字典表，存代碼）。
 *
 * DB 端已確認可承受 deputy_id / 代辦皆為空的請假單：
 * `eip_quick_report.deputy_id` 可為 null，`eip_notify_quick_report` 仍會以
 * `leave_handover_created` 通知單位主管，沒代理人時只是少發那一份副本。
 */
export function QuickReportButton() {
  const { appUser } = useEipUser();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"late" | "leave" | "other">("late");
  const [busy, setBusy] = useState(false);

  // 遲到：時段（幾點幾分 ~ 幾點幾分）
  const [lateStart, setLateStart] = useState("");
  const [lateEnd, setLateEnd] = useState("");
  const [lateDetail, setLateDetail] = useState("");

  // 請假：假別（必填）＋日期起訖（必填）＋時間起訖（選填）＋事由（選填）。代理人／代辦走交接代辦頁
  const [leaveType, setLeaveType] = useState("");
  const [leaveFromDate, setLeaveFromDate] = useState("");
  const [leaveToDate, setLeaveToDate] = useState("");
  const [leaveFromTime, setLeaveFromTime] = useState("");
  const [leaveToTime, setLeaveToTime] = useState("");
  const [leaveDetail, setLeaveDetail] = useState("");

  // 假別選項取自 leave_type 字典表（依 is_active／sort_order），存代碼
  const leaveTypesQ = useQuery({
    queryKey: ["eip", "leave-types"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_type")
        .select("code,name")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as { code: string; name: string }[];
    },
  });
  // 假別是必填：字典表載入失敗或回空時，退回內建對照表，避免下拉沒選項讓人送不出去
  const leaveTypeOptions =
    leaveTypesQ.data && leaveTypesQ.data.length
      ? leaveTypesQ.data
      : Object.entries(LEAVE_TYPE_LABEL).map(([code, name]) => ({ code, name }));

  // 事件
  const [otherDetail, setOtherDetail] = useState("");

  const reset = () => {
    setLateStart(""); setLateEnd(""); setLateDetail("");
    setLeaveType("");
    setLeaveFromDate(""); setLeaveToDate("");
    setLeaveFromTime(""); setLeaveToTime(""); setLeaveDetail("");
    setOtherDetail("");
  };

  const tenantId = appUser?.tenant_id ?? DEFAULT_TENANT_ID;

  const submitLate = async () => {
    if (!appUser) return;
    if (!lateStart && !lateEnd && !lateDetail.trim()) {
      toast.error("請填寫遲到時段或事由");
      return;
    }
    if (lateStart && lateEnd && lateEnd < lateStart) {
      toast.error("迄時不可早於起時");
      return;
    }
    const today = todayStr();
    const etaText = lateStart || lateEnd ? `${lateStart || "—"} ~ ${lateEnd || "—"}` : null;
    setBusy(true);
    const { error } = await supabase.from("eip_quick_report").insert({
      tenant_id: tenantId,
      submitter_id: appUser.id,
      type: "late",
      report_date: today,
      eta: etaText,
      leave_from: lateStart ? ts(today, lateStart) : null,
      leave_to: lateEnd ? ts(today, lateEnd) : null,
      detail: lateDetail.trim() || null,
    });
    setBusy(false);
    if (error) return toast.error(humanizeError(error, "送出"));
    toast.success("遲到回報已送出");
    reset();
    setOpen(false);
  };

  const submitLeave = async () => {
    if (!appUser) return;
    if (!leaveType) return toast.error("請選擇假別");
    if (!leaveFromDate || !leaveToDate) return toast.error("請選擇請假日期（起訖）");
    if (leaveToDate < leaveFromDate) return toast.error("迄日不可早於起日");
    if (leaveFromDate === leaveToDate && leaveFromTime && leaveToTime && leaveToTime < leaveFromTime) {
      return toast.error("同一天的迄時不可早於起時");
    }
    setBusy(true);
    // 只寫區間與事由。deputy_id 與代辦一律留給「交接代辦」頁補登（DB 允許為空）
    const { error } = await supabase.from("eip_quick_report").insert({
      tenant_id: tenantId,
      submitter_id: appUser.id,
      type: "leave",
      report_date: leaveFromDate,
      leave_type: leaveType || null,
      leave_from: ts(leaveFromDate, leaveFromTime || "00:00"),
      leave_to: ts(leaveToDate, leaveToTime || "23:59"),
      detail: leaveDetail.trim() || null,
    });
    setBusy(false);
    if (error) return toast.error(humanizeError(error, "送出"));
    toast.success("請假已送出。代理人與交接代辦可稍後到「交接代辦」補登");
    // 「交接代辦」頁的「我的請假交接」要立刻看得到這張新單
    void qc.invalidateQueries({ queryKey: ["eip", "my-leave-handover"] });
    void qc.invalidateQueries({ queryKey: ["eip", "leave-handover-inbox"] });
    reset();
    setOpen(false);
  };

  const submitOther = async () => {
    if (!appUser) return;
    if (!otherDetail.trim()) return toast.error("請填寫事件內容");
    setBusy(true);
    const { error } = await supabase.from("eip_quick_report").insert({
      tenant_id: tenantId,
      submitter_id: appUser.id,
      type: "other",
      report_date: todayStr(),
      detail: otherDetail.trim(),
    });
    setBusy(false);
    if (error) return toast.error(humanizeError(error, "送出"));
    toast.success("事件回報已送出");
    reset();
    setOpen(false);
  };

  if (!appUser) return null;

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 h-12 rounded-full shadow-lg px-5"
      >
        <Plus className="h-4 w-4" /> 快速回報
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>快速回報</DialogTitle>
          </DialogHeader>
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="late">遲到</TabsTrigger>
              <TabsTrigger value="leave">請假</TabsTrigger>
              <TabsTrigger value="other">事件</TabsTrigger>
            </TabsList>



            {/* 遲到 */}
            <TabsContent value="late" className="space-y-3 pt-2">
              <div>
                {/* 摘要放欄位「上方」：原生時鐘小視窗往下展開會蓋住欄位，放下面等於看不到 */}
                <div className="flex items-baseline justify-between gap-2">
                  <Label>遲到時段（今日）</Label>
                  <RangeSummary text={summarizeTimeRange(lateStart, lateEnd)} />
                </div>
                <div className="grid grid-cols-2 gap-3 mt-1">
                  <div>
                    <span className="text-xs text-muted-foreground">起</span>
                    <Input
                      type="time"
                      value={lateStart}
                      onChange={(e) => {
                        const v = e.target.value;
                        setLateStart(v);
                        // 迄（預計到達）沒填或早於起時就自動跟上，使用者仍可自行改
                        setLateEnd((prev) => syncToTime(v, prev));
                      }}
                      onBlur={(e) => setLateStart(e.target.value)}
                    />
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">迄（預計到達）</span>
                    <Input
                      type="time"
                      value={lateEnd}
                      onChange={(e) => setLateEnd(e.target.value)}
                      onBlur={(e) => setLateEnd(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div>
                <Label>事由</Label>
                <Textarea rows={3} value={lateDetail} onChange={(e) => setLateDetail(e.target.value)} placeholder="(選填)" />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
                <Button disabled={busy} onClick={submitLate}>送出</Button>
              </DialogFooter>
            </TabsContent>

            {/* 請假：假別＋區間＋事由，一鍵送出。
                代理人與交接代辦不在這裡填 —— 臨時請假來不及登打，改到「交接代辦」頁補。 */}
            <TabsContent value="leave" className="space-y-3 pt-2">
              <div>
                <Label>假別 <span className="text-destructive">*</span></Label>
                <Select value={leaveType} onValueChange={setLeaveType}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="請選擇假別" />
                  </SelectTrigger>
                  <SelectContent>
                    {leaveTypeOptions.map((lt) => (
                      <SelectItem key={lt.code} value={lt.code}>{lt.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <Label>請假日期（起訖）</Label>
                  <RangeSummary text={summarizeDateRange(leaveFromDate, leaveToDate)} />
                </div>
                <div className="grid grid-cols-2 gap-3 mt-1">
                  <div>
                    <span className="text-xs text-muted-foreground">起日</span>
                    <Input
                      type="date"
                      value={leaveFromDate}
                      onChange={(e) => {
                        const v = e.target.value;
                        setLeaveFromDate(v);
                        // 迄日沒填、或早於新的起日，就自動跟上（其餘不動使用者已選的）
                        setLeaveToDate((prev) => syncToDate(v, prev));
                      }}
                      onBlur={(e) => setLeaveFromDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">迄日</span>
                    <Input
                      type="date"
                      value={leaveToDate}
                      min={leaveFromDate || undefined}
                      onChange={(e) => {
                        const v = e.target.value;
                        setLeaveToDate(v);
                        setLeaveFromDate((prev) => syncFromDate(v, prev));
                      }}
                      onBlur={(e) => setLeaveToDate(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <Label>時間（選填，不填視為整日）</Label>
                  <RangeSummary text={summarizeTimeRange(leaveFromTime, leaveToTime, "整日")} placeholder="整日" />
                </div>
                <div className="grid grid-cols-2 gap-3 mt-1">
                  <div>
                    <span className="text-xs text-muted-foreground">起時</span>
                    <Input
                      type="time"
                      value={leaveFromTime}
                      onChange={(e) => {
                        const v = e.target.value;
                        setLeaveFromTime(v);
                        // 跨日的迄時屬於最後一天，不能用起時去推，所以只在同一天才連動
                        setLeaveToTime((prev) =>
                          syncToTime(v, prev, {
                            sameDay: !!leaveFromDate && leaveFromDate === leaveToDate,
                          }),
                        );
                      }}
                      onBlur={(e) => setLeaveFromTime(e.target.value)}
                    />
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">迄時</span>
                    <Input
                      type="time"
                      value={leaveToTime}
                      onChange={(e) => setLeaveToTime(e.target.value)}
                      onBlur={(e) => setLeaveToTime(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div>
                <Label>事由</Label>
                <Textarea
                  rows={3}
                  value={leaveDetail}
                  onChange={(e) => setLeaveDetail(e.target.value)}
                  placeholder="(選填)"
                />
              </div>
              <p className="text-xs text-muted-foreground rounded-md border bg-muted/30 p-2">
                送出即成立，不需主管核准，系統會通知單位主管。
                <span className="font-medium">代理人與交接代辦事項請到「交接代辦」頁登打</span>
                ，臨時請假可以先送出、事後再補。
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
                <Button disabled={busy} onClick={submitLeave}>送出</Button>
              </DialogFooter>
            </TabsContent>

            {/* 事件 */}
            <TabsContent value="other" className="space-y-3 pt-2">
              <div>
                <Label>事件內容</Label>
                <Textarea
                  rows={4}
                  value={otherDetail}
                  onChange={(e) => setOtherDetail(e.target.value)}
                  placeholder="描述需要主管知悉或處理的事件"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
                <Button disabled={busy} onClick={submitOther}>送出</Button>
              </DialogFooter>
            </TabsContent>


          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
