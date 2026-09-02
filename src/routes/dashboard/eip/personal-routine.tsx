import { EipUserPending } from "@/components/eip/EipUserPending";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, GripVertical, Repeat } from "lucide-react";

// personal_routine 尚未進 src/integrations/supabase/types.ts，
// 這裡用 any 形式的 client（與 work-log.tsx 一致），型別在本檔自行宣告。
import { supabase } from "@/lib/supabase";
import { useEipUser } from "@/lib/eip-user";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { humanizeError } from "@/lib/eip-error";

export const Route = createFileRoute("/dashboard/eip/personal-routine")({
  component: PersonalRoutinePage,
});

/* ---------- 型別與常數 ---------- */

type TimeSlot = "morning" | "afternoon" | "allday";
type Freq = "daily" | "weekdays" | "weekly" | "monthly";

type PersonalRoutine = {
  id: string;
  user_id: string;
  tenant_id: string;
  title: string;
  time_slot: TimeSlot;
  freq: Freq;
  weekdays: number[] | null;
  days_of_month: number[] | null;
  use_month_end: boolean;
  require_content: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const SLOT_LABEL: Record<TimeSlot, string> = {
  morning: "上午",
  afternoon: "下午",
  allday: "全天",
};
const SLOT_CLASS: Record<TimeSlot, string> = {
  morning: "bg-blue-100 text-blue-700 hover:bg-blue-100",
  afternoon: "bg-amber-100 text-amber-700 hover:bg-amber-100",
  allday: "bg-slate-100 text-slate-700 hover:bg-slate-100",
};
const SLOT_ORDER: TimeSlot[] = ["morning", "afternoon", "allday"];

const FREQ_OPTIONS: { value: Freq; label: string }[] = [
  { value: "daily", label: "每日" },
  { value: "weekdays", label: "週一至週五" },
  { value: "weekly", label: "指定週幾" },
  { value: "monthly", label: "每月" },
];

const WEEKDAYS = [
  { v: 1, label: "一" },
  { v: 2, label: "二" },
  { v: 3, label: "三" },
  { v: 4, label: "四" },
  { v: 5, label: "五" },
  { v: 6, label: "六" },
  { v: 7, label: "日" },
];

/** 把週期欄位組成人看得懂的文字 */
function describeFreq(
  r: Pick<PersonalRoutine, "freq" | "weekdays" | "days_of_month" | "use_month_end">,
): string {
  if (r.freq === "daily") return "每日";
  if (r.freq === "weekdays") return "週一~五";
  if (r.freq === "weekly") {
    const ws = (r.weekdays ?? []).slice().sort((a, b) => a - b);
    if (!ws.length) return "每週（未指定）";
    return `每週${ws.map((v) => WEEKDAYS.find((w) => w.v === v)?.label ?? v).join("、")}`;
  }
  // monthly
  const days = (r.days_of_month ?? []).slice().sort((a, b) => a - b);
  const parts: string[] = [];
  if (days.length) parts.push(`${days.join("、")} 日`);
  if (r.use_month_end) parts.push("最後一天");
  if (!parts.length) return "每月（未指定）";
  return `每月 ${parts.join("、")}`;
}

/** "5, 20" → [5, 20]；濾掉非 1-31 的值並去重 */
function parseDays(input: string): number[] {
  const out = new Set<number>();
  input.split(/[,，\s]+/).forEach((tok) => {
    const n = Number.parseInt(tok, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 31) out.add(n);
  });
  return Array.from(out).sort((a, b) => a - b);
}

/* ---------- 主頁面 ---------- */

function PersonalRoutinePage() {
  const qc = useQueryClient();
  const { appUser } = useEipUser();
  const { can, permsLoaded } = useAuth();

  // 權限一律讀角色權限設定，不寫死角色字串
  const allowed = can("eip_personal_routine", "view");
  const canCreate = can("eip_personal_routine", "create");
  const canEdit = can("eip_personal_routine", "edit");
  const canDelete = can("eip_personal_routine", "delete");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PersonalRoutine | null>(null);
  const [deleting, setDeleting] = useState<PersonalRoutine | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  const listQ = useQuery({
    queryKey: ["eip", "personal-routine", appUser?.id],
    enabled: !!appUser?.id,
    queryFn: async () => {
      // RLS 已保證只看得到自己的，這裡仍明確過濾避免快取混淆
      const { data, error } = await supabase
        .from("personal_routine")
        .select("*")
        .eq("user_id", appUser!.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PersonalRoutine[];
    },
  });

  const rows = useMemo(() => listQ.data ?? [], [listQ.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["eip", "personal-routine"] });

  const toggleActive = async (r: PersonalRoutine) => {
    const { error } = await supabase
      .from("personal_routine")
      .update({ is_active: !r.is_active })
      .eq("id", r.id);
    if (error) {
      toast.error(humanizeError(error, "更新狀態"));
      return;
    }
    toast.success(r.is_active ? "已停用" : "已啟用");
    refresh();
  };

  const [removing, setRemoving] = useState(false);
  const remove = async () => {
    if (!deleting || removing) return;   // 連點兩次會送兩次 delete，第二次 0 列也照跳「已刪除」
    setRemoving(true);
    const { error } = await supabase.from("personal_routine").delete().eq("id", deleting.id);
    setRemoving(false);
    if (error) {
      toast.error(humanizeError(error, "刪除"));
      return;
    }
    toast.success("已刪除");
    setDeleting(null);
    refresh();
  };

  /** 拖曳結束：把目標順序寫回 sort_order（只更新順序真的變了的列） */
  const handleDrop = async (targetId: string) => {
    if (!dragId || dragId === targetId || reordering) {
      setDragId(null);
      return;
    }
    const from = rows.findIndex((r) => r.id === dragId);
    const to = rows.findIndex((r) => r.id === targetId);
    setDragId(null);
    if (from < 0 || to < 0) return;

    const next = rows.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);

    const changed = next
      .map((r, i) => ({ id: r.id, sort_order: i }))
      .filter((x, i) => rows[i]?.id !== x.id || rows[i]?.sort_order !== x.sort_order);
    if (!changed.length) return;

    setReordering(true);
    const results = await Promise.all(
      changed.map((x) =>
        supabase.from("personal_routine").update({ sort_order: x.sort_order }).eq("id", x.id),
      ),
    );
    setReordering(false);
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      toast.error(humanizeError(failed.error, "排序"));
    }
    refresh();
  };

  if (!appUser) return <EipUserPending />;
  // 權限還沒載入完就判斷 allowed 會把有權限的人踢走（重新整理／書籤必中）
  if (!permsLoaded) return <div className="text-muted-foreground py-8">載入中…</div>;
  if (!allowed) return <Navigate to="/dashboard/eip/my-tasks" replace />;

  return (
    <div>
      <PageHeader
        title="個人例行工作範本"
        description="設定每天重複的固定工作，系統每日自動帶入工作日誌。範本本身不會產生任務紀錄。"
        actions={
          canCreate ? (
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="w-4 h-4 mr-1" />
              新增例行項目
            </Button>
          ) : undefined
        }
      />

      <Card className="mt-2">
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
            <EmptyState
              canCreate={canCreate}
              onCreate={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>事項</TableHead>
                  <TableHead className="w-20">時段</TableHead>
                  <TableHead className="w-44">週期</TableHead>
                  <TableHead className="w-28 text-center">需填執行內容</TableHead>
                  <TableHead className="w-20 text-center">啟用</TableHead>
                  <TableHead className="w-24 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.id}
                    className={dragId === r.id ? "opacity-40" : undefined}
                    onDragOver={(e) => {
                      if (canEdit) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      void handleDrop(r.id);
                    }}
                  >
                    <TableCell className="align-middle">
                      {canEdit ? (
                        <span
                          draggable
                          onDragStart={() => setDragId(r.id)}
                          onDragEnd={() => setDragId(null)}
                          className="inline-flex cursor-grab text-muted-foreground active:cursor-grabbing"
                          title="拖曳調整順序"
                        >
                          <GripVertical className="w-4 h-4" />
                        </span>
                      ) : (
                        <GripVertical className="w-4 h-4 text-muted-foreground/30" />
                      )}
                    </TableCell>
                    <TableCell
                      className={`font-medium ${r.is_active ? "" : "text-muted-foreground line-through"}`}
                    >
                      {r.title}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={SLOT_CLASS[r.time_slot]}>
                        {SLOT_LABEL[r.time_slot]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {describeFreq(r)}
                    </TableCell>
                    <TableCell className="text-center text-sm text-muted-foreground">
                      {r.require_content ? "需填" : "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={r.is_active}
                        onCheckedChange={() => canEdit && void toggleActive(r)}
                        disabled={!canEdit}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canEdit && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              setEditing(r);
                              setDialogOpen(true);
                            }}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button size="icon" variant="ghost" onClick={() => setDeleting(r)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          順序決定工作日誌帶入的排列。停用的項目不會帶入日誌，但範本會保留。
        </p>
      )}

      {dialogOpen && (
        <RoutineDialog
          routine={editing}
          nextSortOrder={rows.length}
          onClose={() => {
            setDialogOpen(false);
            setEditing(null);
          }}
          onSaved={() => {
            setDialogOpen(false);
            setEditing(null);
            refresh();
          }}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>刪除例行項目</AlertDialogTitle>
            <AlertDialogDescription>
              確定刪除「{deleting?.title}」？此動作無法復原。
              若只是暫時不做，建議改用「啟用」開關停用即可。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()} disabled={removing}>
              {removing ? "刪除中…" : "刪除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ---------- 空狀態 ---------- */

function EmptyState({ canCreate, onCreate }: { canCreate: boolean; onCreate: () => void }) {
  return (
    <div className="text-center py-12 px-6">
      <Repeat className="w-8 h-8 mx-auto text-muted-foreground/50 mb-3" />
      <div className="text-sm text-muted-foreground max-w-md mx-auto">
        還沒有設定例行工作。建議先把每天固定要做的 5～8 件事建進來，之後工作日誌就會每天自動帶入。
      </div>
      {canCreate && (
        <Button className="mt-4" onClick={onCreate}>
          <Plus className="w-4 h-4 mr-1" />
          新增例行項目
        </Button>
      )}
    </div>
  );
}

/* ---------- 新增／編輯對話框 ---------- */

function RoutineDialog({
  routine,
  nextSortOrder,
  onClose,
  onSaved,
}: {
  routine: PersonalRoutine | null;
  nextSortOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!routine;
  const [title, setTitle] = useState(routine?.title ?? "");
  const [timeSlot, setTimeSlot] = useState<TimeSlot>(routine?.time_slot ?? "morning");
  const [freq, setFreq] = useState<Freq>(routine?.freq ?? "daily");
  const [weekdays, setWeekdays] = useState<number[]>(routine?.weekdays ?? []);
  const [daysInput, setDaysInput] = useState((routine?.days_of_month ?? []).join("、"));
  const [useMonthEnd, setUseMonthEnd] = useState(routine?.use_month_end ?? false);
  const [requireContent, setRequireContent] = useState(routine?.require_content ?? false);
  const [isActive, setIsActive] = useState(routine?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  const toggleWeekday = (v: number) =>
    setWeekdays((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v].sort((a, b) => a - b),
    );

  const save = async () => {
    const t = title.trim();
    if (!t) {
      toast.error("請填事項名稱");
      return;
    }

    const days = freq === "monthly" ? parseDays(daysInput) : [];
    if (freq === "weekly" && !weekdays.length) {
      toast.error("請至少選一個星期");
      return;
    }
    if (freq === "monthly" && !days.length && !useMonthEnd) {
      toast.error("請填每月哪幾日，或勾選「月底最後一天」");
      return;
    }

    // user_id / tenant_id 由 DB trigger 自動補，前端不要手動塞（會觸發 RLS 錯誤）
    const payload = {
      title: t,
      time_slot: timeSlot,
      freq,
      weekdays: freq === "weekly" ? weekdays : null,
      days_of_month: freq === "monthly" && days.length ? days : null,
      use_month_end: freq === "monthly" ? useMonthEnd : false,
      require_content: requireContent,
      is_active: isActive,
    };

    setSaving(true);
    const { error } = isEdit
      ? await supabase.from("personal_routine").update(payload).eq("id", routine!.id)
      : await supabase.from("personal_routine").insert({ ...payload, sort_order: nextSortOrder });
    setSaving(false);

    if (error) {
      toast.error(humanizeError(error, "儲存"));
      return;
    }
    toast.success(isEdit ? "已更新" : "已新增");
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{isEdit ? "編輯例行項目" : "新增例行項目"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>
              事項名稱 <span className="text-destructive">*</span>
            </Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例：檢查昨日出貨異常"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>時段</Label>
            <div className="flex gap-1.5">
              {SLOT_ORDER.map((s) => (
                <Button
                  key={s}
                  type="button"
                  size="sm"
                  variant={timeSlot === s ? "default" : "outline"}
                  onClick={() => setTimeSlot(s)}
                  className="flex-1"
                >
                  {SLOT_LABEL[s]}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>週期</Label>
            <Select value={freq} onValueChange={(v) => setFreq(v as Freq)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREQ_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {freq === "weekly" && (
            <div className="space-y-1.5">
              <Label>星期（可多選）</Label>
              <div className="flex gap-1.5">
                {WEEKDAYS.map((w) => (
                  <Button
                    key={w.v}
                    type="button"
                    size="icon"
                    variant={weekdays.includes(w.v) ? "default" : "outline"}
                    onClick={() => toggleWeekday(w.v)}
                    className="w-9 h-9"
                  >
                    {w.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {freq === "monthly" && (
            <div className="space-y-2">
              <div className="space-y-1.5">
                <Label>每月哪幾日</Label>
                <Input
                  value={daysInput}
                  onChange={(e) => setDaysInput(e.target.value)}
                  placeholder="例：5、20（用逗號或空白分隔）"
                />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={useMonthEnd}
                  onCheckedChange={(c) => setUseMonthEnd(c === true)}
                />
                月底最後一天
              </label>
            </div>
          )}

          <div className="flex items-center justify-between border-t pt-3">
            <div>
              <Label className="cursor-pointer">需填執行內容</Label>
              <p className="text-xs text-muted-foreground">日誌帶入時要求填寫實際做了什麼</p>
            </div>
            <Switch checked={requireContent} onCheckedChange={setRequireContent} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="cursor-pointer">啟用</Label>
              <p className="text-xs text-muted-foreground">停用後不再帶入日誌，範本仍保留</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "儲存中…" : "儲存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
