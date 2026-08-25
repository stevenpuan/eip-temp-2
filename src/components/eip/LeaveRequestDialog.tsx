import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Link2 } from "lucide-react";
import { toast } from "sonner";

// eip_leave_handover_item 與 eip_quick_report.deputy_id 尚未進 types.ts，用寬鬆型別的 client
import { supabase } from "@/lib/supabase";
import { useEipUser } from "@/lib/eip-user";
import { useActiveUsers } from "@/hooks/useUsers";
import { validateExternalUrl } from "@/lib/eip-url";
import { LEAVE_TYPE_LABEL } from "@/lib/eip-constants";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { humanizeError } from "@/lib/eip-error";
import { RangeSummary } from "@/components/eip/RangeSummary";
import {
  summarizeDateTimeRange,
  syncFromDate,
  syncToDate,
  syncToTime,
} from "@/lib/eip-datetime-range";

const NO_ASSIGNEE = "__none__";

type Draft = { key: string; title: string; assigneeId: string; url: string };

/** 本地日期字串；toISOString() 在 UTC+8 會退回前一天，不能用 */
const todayLocal = () => new Date().toLocaleDateString("sv-SE");

/** 把「日期 + 時間」組成帶時區位移的 timestamptz，避免被當成 UTC */
function stamp(date: string, time: string) {
  const d = new Date(`${date}T${time}:00`);
  const p = (n: number) => String(n).padStart(2, "0");
  const offMin = -d.getTimezoneOffset();
  const abs = Math.abs(offMin);
  return (
    `${date}T${time}:00` +
    `${offMin >= 0 ? "+" : "-"}${p(Math.floor(abs / 60))}:${p(abs % 60)}`
  );
}

let seq = 0;
const newKey = () => `d${++seq}`;

/**
 * 請假申請（規格書 H、原型 H-1）—— **選填的完整版入口**。
 *
 * 2026-07-30 定案調整：臨時請假的主路徑是「快速回報 → 請假」（只填區間＋事由、
 * 一鍵送出），代理人與交接代辦到「交接代辦」頁補登。這張表單留給有時間一次
 * 填完的人，入口在「我的工作區」的交接卡片，不是必經路徑。
 *
 * 四個刻意的設計決定，對應訪談定案：
 *  ・**假別為必填**（2026-08 依需求回復，選項取自 leave_type 字典表，存代碼）；
 *    事由不在此表單（如需填走快速回報／正式假單）。
 *  ・**只填請假區間就能送出**：臨時請假常常是人在外面、趕時間，
 *    代理人與代辦清單一律**選填**，事後在「交接代辦」頁補登。
 *    前一版把三者綁成一張必填表單，結果是假送不出去 —— 這裡刻意反過來。
 *  ・**代理人是每次請假指定**（存 eip_quick_report.deputy_id），
 *    不是 app_user.deputy_id 那個靜態代理人（那是通知副本用）。
 *  ・**主管不核准、不簽核**（定案第 14 條）：送出只發通知給單位主管與代理人，
 *    這個表單裡不會有任何「送審」的概念。
 *
 * 代辦沒指定 assignee 時 DB 的 eip_fill_lhi_defaults 會自動掛給這張單的 deputy_id；
 * deputy 也是 null 就留 null（＝未指派），這是允許的狀態，前端不擋。
 */
export function LeaveRequestDialog({
  open,
  onClose,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
}) {
  const { appUser } = useEipUser();
  const qc = useQueryClient();
  const usersQ = useActiveUsers();

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
  // 假別必填：字典表載入失敗或回空時退回內建對照表，避免下拉沒選項卡住送不出去
  const leaveTypeOptions =
    leaveTypesQ.data && leaveTypesQ.data.length
      ? leaveTypesQ.data
      : Object.entries(LEAVE_TYPE_LABEL).map(([code, name]) => ({ code, name }));

  const [leaveType, setLeaveType] = useState("");
  const [fromDate, setFromDate] = useState(todayLocal());
  const [toDate, setToDate] = useState(todayLocal());
  const [fromTime, setFromTime] = useState("08:00");
  const [toTime, setToTime] = useState("17:30");
  const [deputyId, setDeputyId] = useState<string>(NO_ASSIGNEE);
  // 預設空陣列＋收起：臨時請假的主流程是「只填區間就送出」，
  // 一開場就攤開一列空白輸入會讓人以為那是必填的
  const [items, setItems] = useState<Draft[]>([]);
  const [showItems, setShowItems] = useState(false);
  const [busy, setBusy] = useState(false);

  const others = (usersQ.data ?? []).filter((u) => u.id !== appUser?.id);

  const patch = (key: string, p: Partial<Draft>) =>
    setItems((prev) => prev.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const blankRow = (): Draft => ({ key: newKey(), title: "", assigneeId: NO_ASSIGNEE, url: "" });

  /** 有填標題的列數：收起後用來提示「還留著幾項」 */
  const draftCount = items.filter((x) => x.title.trim()).length;

  /** 展開代辦區塊；空的時候補一列，否則展開後是一片空白沒東西可填 */
  const openItems = () => {
    setShowItems(true);
    setItems((prev) => (prev.length ? prev : [blankRow()]));
  };

  const reset = () => {
    setLeaveType("");
    setFromDate(todayLocal());
    setToDate(todayLocal());
    setFromTime("08:00");
    setToTime("17:30");
    setDeputyId(NO_ASSIGNEE);
    setItems([]);
    setShowItems(false);
  };

  const submit = async () => {
    if (!appUser?.id || busy) return;
    if (!leaveType) return toast.error("請選擇假別");
    if (!fromDate || !toDate) return toast.error("請選擇請假區間");
    if (toDate < fromDate) return toast.error("迄日不可早於起日");
    if (fromDate === toDate && toTime <= fromTime) return toast.error("同一天的迄時要晚於起時");
    // 代理人是選填：沒指定就整張單先成立，之後在「交接代辦」補。這裡刻意不擋。

    // 代辦區塊收起時一律不送代辦，即使之前展開過打了字（那視同放棄）
    const filled = showItems ? items.filter((x) => x.title.trim()) : [];
    for (const it of filled) {
      const u = it.url.trim();
      if (u) {
        const bad = validateExternalUrl(u);
        if (bad) return toast.error(`「${it.title.trim()}」的${bad}`);
      }
    }

    setBusy(true);
    // 送出即通知（單位主管＋代理人），不進任何簽核流程
    const { data: rep, error } = await supabase
      .from("eip_quick_report")
      .insert({
        type: "leave",
        report_date: fromDate,
        leave_type: leaveType,
        leave_from: stamp(fromDate, fromTime),
        leave_to: stamp(toDate, toTime),
        // 未指定代理人就寫 null（DB 允許），不要寫 sentinel 字串
        deputy_id: deputyId === NO_ASSIGNEE ? null : deputyId,
        submitted_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();

    if (error || !rep?.id) {
      setBusy(false);
      return toast.error(error ? humanizeError(error, "送出") : "送出失敗：沒有取得單號，請重試");
    }

    // 代辦項目是附帶寫入：失敗不該讓請假單消失，但也絕對不能照跳成功
    let itemErr: string | null = null;
    const deputy = deputyId === NO_ASSIGNEE ? null : deputyId;
    // 代理人與逐項指派都空＝未指派，DB 允許（trigger 補不到人時留 null）
    const unassigned = deputy
      ? 0
      : filled.filter((x) => x.assigneeId === NO_ASSIGNEE).length;
    if (filled.length) {
      const { error: ie } = await supabase.from("eip_leave_handover_item").insert(
        filled.map((x, i) => ({
          quick_report_id: rep.id,
          title: x.title.trim(),
          // 沒指定就掛給這次的代理人（DB trigger 也會補，這裡先寫清楚語意）；
          // 代理人也沒指定時是 null＝未指派
          assignee_id: x.assigneeId === NO_ASSIGNEE ? deputy : x.assigneeId,
          url: x.url.trim() || null,
          sort_order: i + 1,
        })),
      );
      if (ie) itemErr = ie.message;
    }
    setBusy(false);

    if (itemErr) {
      toast.warning(`請假已送出，但代辦事項沒有存進去（${itemErr}），請到「交接代辦」頁補上`);
    } else if (filled.length === 0) {
      toast.success("請假已送出。代辦事項可到「交接代辦」頁補登，代理人也可以在那裡指定。");
    } else if (unassigned > 0) {
      toast.warning(`請假已送出，${unassigned} 項代辦尚未指派，請到「交接代辦」指定代理人`);
    } else {
      toast.success(`請假已送出，${filled.length} 項代辦已通知代理人`);
    }

    void qc.invalidateQueries({ queryKey: ["eip", "quick-reports"] });
    void qc.invalidateQueries({ queryKey: ["eip", "leave-handover-inbox"] });
    // 交接代辦頁的「我的請假交接」要立刻看得到這張新單（代理人／代辦在那裡補登）
    void qc.invalidateQueries({ queryKey: ["eip", "my-leave-handover"] });
    reset();
    onSubmitted?.();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>請假申請</DialogTitle>
          <DialogDescription>
            <span className="block">
              只要填假別與請假區間就可以送出。代理人與代辦事項都是選填，臨時請假來不及登打時，
              事後到「交接代辦」頁面補就好。
            </span>
            <span className="block mt-1">
              送出後不需主管核准、不用簽核，系統會直接通知單位主管與代理人。
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs">假別 <span className="text-destructive">*</span></Label>
            <Select value={leaveType} onValueChange={setLeaveType}>
              <SelectTrigger className="h-9 mt-1">
                <SelectValue placeholder="請選擇假別" />
              </SelectTrigger>
              <SelectContent>
                {leaveTypeOptions.map((lt) => (
                  <SelectItem key={lt.code} value={lt.code}>{lt.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 區間 ＋ 代理人。
              摘要放在欄位「上方」：原生日曆／時鐘小視窗往下展開會蓋住欄位，
              放下方使用者得先點掉小視窗才看得到自己選了什麼。 */}
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <Label className="text-xs">請假區間</Label>
              <RangeSummary text={summarizeDateTimeRange(fromDate, fromTime, toDate, toTime)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 mt-1">
              <div>
                <Label className="text-xs">請假起日 / 時間</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    type="date"
                    value={fromDate}
                    onChange={(e) => {
                      const v = e.target.value;
                      setFromDate(v);
                      // 迄日沒填或早於起日就跟上，不覆蓋使用者已選的較晚迄日
                      setToDate((prev) => syncToDate(v, prev));
                    }}
                    onBlur={(e) => setFromDate(e.target.value)}
                    className="h-9"
                  />
                  <Input
                    type="time"
                    value={fromTime}
                    onChange={(e) => {
                      const v = e.target.value;
                      setFromTime(v);
                      // 跨日時迄時屬於最後一天，不能用起時去推，只在同一天連動
                      setToTime((prev) => syncToTime(v, prev, { sameDay: !!fromDate && fromDate === toDate }));
                    }}
                    onBlur={(e) => setFromTime(e.target.value)}
                    className="h-9 w-28"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">請假迄日 / 時間</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    type="date"
                    value={toDate}
                    min={fromDate}
                    onChange={(e) => {
                      const v = e.target.value;
                      setToDate(v);
                      setFromDate((prev) => syncFromDate(v, prev));
                    }}
                    onBlur={(e) => setToDate(e.target.value)}
                    className="h-9"
                  />
                  <Input
                    type="time"
                    value={toTime}
                    onChange={(e) => setToTime(e.target.value)}
                    onBlur={(e) => setToTime(e.target.value)}
                    className="h-9 w-28"
                  />
                </div>
              </div>
            </div>
          </div>

          <div>
            <Label className="text-xs">代理人（選填，可稍後在交接代辦指定）</Label>
            <Select value={deputyId} onValueChange={setDeputyId}>
              <SelectTrigger className="h-9 mt-1">
                <SelectValue placeholder="選擇代理人…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ASSIGNEE}>未指定</SelectItem>
                {others.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {usersQ.isError && (
              <p className="text-[12.5px] text-destructive mt-1">
                人員清單載入失敗，代理人選單會是空的；可以先送出，之後到「交接代辦」再指定。
              </p>
            )}
          </div>

          {/* 代辦清單：預設收起。臨時請假的人要能三十秒送完，不能被清單擋住 */}
          {!showItems ? (
            <button
              type="button"
              onClick={openItems}
              className="text-sm text-primary hover:underline text-left inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              {/* 收起狀態刻意不送代辦（submit 端的 showItems 閘門）。既然「收起」不再清空，
                  就必須把「還留著 N 項、但收著送出不會送」講明，否則會變成另一種靜默丟失 */}
              {draftCount > 0
                ? `展開代辦事項（已填 ${draftCount} 項；保持收起送出不會一起送）`
                : "順便填代辦事項（選填，也可以稍後在交接代辦補登）"}
            </button>
          ) : (
            <div className="rounded-md border p-3">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-sm font-medium">代辦事項清單（選填）</span>
              <span className="text-[12.5px] text-muted-foreground">
                每一項可以單獨指派給不同人；留空的列不會送出
              </span>
              <div className="flex-1" />
              {/* 只收起、不清空：使用者常常是想回頭確認一下請假區間才收起的，
                  把已經打好的幾列直接丟掉且不可回復是無法接受的 */}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setShowItems(false)}
              >
                收起
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => setItems((p) => [...p, blankRow()])}
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                新增
              </Button>
            </div>

            <div className="space-y-2">
              {items.map((it) => (
                <div key={it.key} className="grid gap-2 sm:grid-cols-[1fr_140px_1fr_32px] items-center">
                  <Input
                    placeholder="代辦事項（例如：加工部排程表更新）"
                    value={it.title}
                    onChange={(e) => patch(it.key, { title: e.target.value })}
                    className="h-9 text-sm"
                  />
                  <Select value={it.assigneeId} onValueChange={(v) => patch(it.key, { assigneeId: v })}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="指派" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_ASSIGNEE}>
                        {deputyId === NO_ASSIGNEE ? "未指派" : "同代理人"}
                      </SelectItem>
                      {others.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="relative">
                    <Link2 className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="連結（選填）\\NAS\… 或 https://…"
                      value={it.url}
                      onChange={(e) => patch(it.key, { url: e.target.value })}
                      className="h-9 pl-7 text-xs font-mono"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    disabled={items.length === 1}
                    onClick={() => setItems((p) => p.filter((x) => x.key !== it.key))}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-[12.5px] text-muted-foreground mt-2">
              代理人在「我的工作」就能勾完成，完成度即時回傳給你與單位主管；全部完成時系統自動發第二段通知。
              沒有指派對象也沒有代理人的項目會先留成「未指派」，到「交接代辦」指定代理人就會有人接。
            </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "送出中…" : "送出申請"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
