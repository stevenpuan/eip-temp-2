import { EipUserPending } from "@/components/eip/EipUserPending";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Play, Pencil, Trash2, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
// eip_can_run_recurring 還沒進 types.ts，走 untyped re-export
import { supabase as supabaseAny } from "@/lib/supabase";
import { useEipUser } from "@/lib/eip-user";
import { useAuth } from "@/lib/auth";
import { DEFAULT_TENANT_ID, PRIORITY_LABEL } from "@/lib/eip-constants";
import { taipeiToday } from "@/lib/eip-routine";
import { PageHeader } from "@/components/layout/PageHeader";
import { MultiSelect } from "@/components/eip/MultiSelect";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Link } from "@tanstack/react-router";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { Database } from "@/integrations/supabase/types";
import { humanizeError } from "@/lib/eip-error";

export const Route = createFileRoute("/dashboard/eip/recurring")({ component: RecurringPage });

type Rule = Database["public"]["Tables"]["recurring_rule"]["Row"];
type AppUser = Database["public"]["Tables"]["app_user"]["Row"];
type Department = Database["public"]["Tables"]["department"]["Row"];
type Priority = Database["public"]["Enums"]["task_priority"];
type ReportField = { label: string; type: "text" | "checkbox" | "number" | "date" };

/**
 * 對接人員（可複選）。`counterpart_user_ids` 是主資料，舊的單一欄位
 * `counterpart_user_id` 由 DB trigger 同步為第一位，只留給還沒更新的讀取端。
 * 兩者都還沒進 src/integrations/supabase/types.ts，所以這裡自己取。
 */
const counterpartIds = (r: Rule | null | undefined): string[] => {
  const raw = (r as unknown as { counterpart_user_ids?: string[] | null })?.counterpart_user_ids;
  if (Array.isArray(raw) && raw.length) return raw.filter(Boolean);
  const one = (r as unknown as { counterpart_user_id?: string | null })?.counterpart_user_id;
  return one ? [one] : [];
};

const FREQ_LABEL: Record<string, string> = {
  daily: "每日", weekly: "每週", monthly: "每月", yearly: "每年", manual: "手動",
};
const WEEKDAYS = [
  { v: 1, label: "一" }, { v: 2, label: "二" }, { v: 3, label: "三" },
  { v: 4, label: "四" }, { v: 5, label: "五" }, { v: 6, label: "六" }, { v: 7, label: "日" },
];
const ALL_MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const MONTH_PRESETS: { label: string; months: number[] }[] = [
  { label: "每月", months: [] },
  { label: "單月", months: [1, 3, 5, 7, 9, 11] },
  { label: "雙月", months: [2, 4, 6, 8, 10, 12] },
  { label: "每季", months: [3, 6, 9, 12] },
  { label: "半年", months: [6, 12] },
];

function summarize(r: Rule): string {
  if (r.freq === "daily") {
    const aw: number[] = (r as any).active_weekdays ?? [];
    if (!aw.length || aw.length === 7) return "每日";
    const labels = WEEKDAYS.filter((w) => aw.includes(w.v)).map((w) => w.label);
    return "每" + labels.join("、");
  }
  if (r.freq === "manual") return "手動";
  if (r.freq === "weekly") {
    const w = WEEKDAYS.find((x) => x.v === r.weekday);
    return `每週${w?.label ?? "?"}`;
  }
  const monthPart =
    !r.months || r.months.length === 0
      ? r.freq === "monthly" ? "每月" : "每年"
      : `${r.months.join("/")} 月`;
  const dayPart = r.use_month_end
    ? "月底"
    : r.days_of_month && r.days_of_month.length
      ? `${r.days_of_month.join("/")} 日`
      : "—";
  return `${monthPart} ${dayPart}`;
}

const REPORT_TYPE_LABEL: Record<string, string> = {
  text: "文字", checkbox: "勾選", number: "數字", date: "日期",
};

// 列展開後的唯讀明細——把原本只能在「編輯」對話框看到的內文攤開來看，不必進編輯。
function RuleDetail({ r, userMap, deptMap }: {
  r: Rule; userMap: Map<string, AppUser>; deptMap: Map<string, Department>;
}) {
  const ids = counterpartIds(r);
  const counterpart = ids.length
    ? ids.map((id) => userMap.get(id)?.name ?? id).join("、")
    : (r.counterpart?.trim() || "—");
  const fields = Array.isArray(r.report_fields) ? (r.report_fields as unknown as ReportField[]) : [];
  return (
    <div className="space-y-3 px-1">
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">說明</div>
        <div className="text-sm whitespace-pre-wrap">
          {r.description?.trim() ? r.description : <span className="text-muted-foreground">（無說明）</span>}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
        <DetailField label="週期" value={`${FREQ_LABEL[r.freq] ?? r.freq}｜${summarize(r)}`} />
        <DetailField label="對接部門" value={r.department_id ? (deptMap.get(r.department_id)?.name ?? "—") : "—"} />
        <DetailField label="對接人員" value={counterpart} />
        <DetailField label="優先級" value={PRIORITY_LABEL[r.priority] ?? r.priority} />
        <DetailField label="提前提醒" value={r.advance_days?.length ? `提前 ${r.advance_days.join("、")} 天` : "—"} />
        <DetailField label="逾期再提醒" value={r.repeat_every_days ? `每 ${r.repeat_every_days} 天` : "—"} />
        <DetailField label="直到完成才停" value={r.remind_until_done ? "是" : "否"} />
        <DetailField label="上次執行" value={r.last_run_on ?? "—"} />
      </div>
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">回報欄位</div>
        {fields.length === 0 ? (
          <div className="text-sm text-muted-foreground">（未設定）</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {fields.map((f, i) => (
              <span key={i} className="text-xs px-2 py-0.5 rounded border bg-card">
                {f.label || "（未命名）"}
                <span className="text-muted-foreground">・{REPORT_TYPE_LABEL[f.type] ?? f.type}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function RecurringPage() {
  const qc = useQueryClient();
  const { appUser } = useEipUser();
  const { can, permsLoaded, roles } = useAuth();
  // 權限一律讀「角色權限設定」（常態工作模組），不寫死角色
  const allowed = can("eip_recurring", "view");
  const canCreate = can("eip_recurring", "create");
  const canManage = can("eip_recurring", "edit");
  /* 後端「跑全公司」的條件是 current_role_name()='company_admin'，
   * 而 eip_derive_app_role 會把 roles 的 admin 與 manager 都映射成 company_admin，
   * 所以這裡不能只看 isAdmin（那只認 admin）。 */
  const runsAllDepartments = roles.includes("admin") || roles.includes("manager");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [running, setRunning] = useState(false);
  // 展開檢視內文的列（可多列同時展開）
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  /**
   * 篩選（2026-08-25 客戶要求：不相關的部門與人不需要一直看到）。
   *
   * 注意這是**畫面篩選**，不是權限：權限在 DB 的 recurring_read 政策
   * （有填對接部門的規則，非相關成員本來就讀不到；管理者依設計仍全公司可見）。
   * 客戶自己的帳號掛著「管理者」，所以清單本來會出現別部門的規則 ——
   * 用「只看與我相關」預設開啟把它收乾淨，要稽核時關掉即可。
   */
  const [kw, setKw] = useState("");
  const [filterDepts, setFilterDepts] = useState<string[]>([]);
  const [filterOwners, setFilterOwners] = useState<string[]>([]);
  const [onlyRelated, setOnlyRelated] = useState(true);

  const rulesQ = useQuery({
    queryKey: ["eip", "recurring"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_rule")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Rule[];
    },
  });
  const usersQ = useQuery({
    queryKey: ["eip", "app_users"],
    queryFn: async () => {
      const { data } = await supabase.from("app_user").select("*").eq("status", "active").order("name");
      return (data ?? []) as AppUser[];
    },
  });
  const deptQ = useQuery({
    queryKey: ["eip", "departments"],
    queryFn: async () => {
      const { data } = await supabase.from("department").select("*").order("name");
      return (data ?? []) as Department[];
    },
  });

  const userMap = useMemo(() => {
    const m = new Map<string, AppUser>();
    (usersQ.data ?? []).forEach((u) => m.set(u.id, u));
    return m;
  }, [usersQ.data]);
  const deptMap = useMemo(() => {
    const m = new Map<string, Department>();
    (deptQ.data ?? []).forEach((d) => m.set(d.id, d));
    return m;
  }, [deptQ.data]);

  /** 與我相關＝我負責 / 我是對接人員 / 我建立 / 對接部門就是我的部門 */
  const isRelatedToMe = (r: Rule) => {
    const me = appUser?.id;
    if (!me) return true;
    if (r.owner_id === me) return true;
    if (counterpartIds(r).includes(me)) return true;
    if (r.created_by === me) return true;
    if (r.department_id && r.department_id === appUser?.department_id) return true;
    return false;
  };

  const shownRules = useMemo(() => {
    const k = kw.trim().toLowerCase();
    return (rulesQ.data ?? []).filter((r) => {
      if (onlyRelated && !isRelatedToMe(r)) return false;
      // "none" 代表「未指定部門」那一群
      if (filterDepts.length) {
        const key = r.department_id ?? "none";
        if (!filterDepts.includes(key)) return false;
      }
      if (filterOwners.length && !filterOwners.includes(r.owner_id)) return false;
      if (k) {
        const hay = `${r.title} ${r.description ?? ""}`.toLowerCase();
        if (!hay.includes(k)) return false;
      }
      return true;
    });
    // isRelatedToMe 只讀 appUser，附在依賴裡即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rulesQ.data, onlyRelated, filterDepts, filterOwners, kw, appUser?.id, appUser?.department_id]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["eip", "recurring"] });

  const toggleActive = async (r: Rule) => {
    const { data, error } = await supabase
      .from("recurring_rule")
      .update({ is_active: !r.is_active })
      .eq("id", r.id)
      .select("id");
    if (error) { toast.error(humanizeError(error, "更新狀態")); return; }
    // 被 RLS 擋掉時回 0 列而 error 是 null。原本會跳「已停用」然後開關彈回，
    // 使用者以為畫面卡住而重複點。
    if (!data?.length) { toast.error("更新失敗：沒有權限修改這條規則（僅規則負責人 / 該部門主管 / 管理者）"); refresh(); return; }
    toast.success(r.is_active ? "已停用" : "已啟用"); refresh();
  };
  const remove = async (r: Rule) => {
    if (!confirm(`確定刪除「${r.title}」？`)) return;
    const { data, error } = await supabase
      .from("recurring_rule").delete().eq("id", r.id).select("id");
    if (error) { toast.error(humanizeError(error, "刪除")); return; }
    if (!data?.length) { toast.error("刪除失敗：沒有權限修改這條規則（僅規則負責人 / 該部門主管 / 管理者）"); return; }
    toast.success("已刪除"); refresh();
  };
  /* 「立即產生/檢查」的顯示判準。
   * 這顆按鈕原本沒有任何權限判斷：一般成員看得到但按下去只會拿到「權限不足」（後端只讓
   * 管理者與部門主管手動觸發）。也不能改用 can("eip_recurring","create") 當閘門 ——
   * 一般成員在 eip_recurring 的矩陣是 VCE--（可新增/編輯自己的規則），用它一樣會留著假按鈕；
   * 而部門主管即使矩陣全開，管轄範圍內沒有規則時後端也跑不出任何東西。
   * 所以直接問後端同一支判準（管理者 ∪ 有管轄範圍/自己負責的規則），前後端不會各說一套。
   */
  const canRunQ = useQuery({
    queryKey: ["eip", "can-run-recurring"],
    queryFn: async () => {
      const { data, error } = await supabaseAny.rpc("eip_can_run_recurring");
      if (error) throw error;
      return !!data;
    },
  });

  const runNow = async () => {
    if (running) return;
    setRunning(true);
    const { error } = await supabase.rpc("eip_run_recurring", {});
    setRunning(false);
    if (error) toast.error(humanizeError(error, "立即執行"));
    else {
      // 後端對非管理者只跑「管轄部門 ∪ 自己負責」的規則，訊息不要讓人誤以為全公司都跑過了
      toast.success(
        runsAllDepartments
          ? "已執行：產生全公司到期任務與提醒"
          : "已執行：產生你管轄範圍內的到期任務與提醒",
      );
      refresh();
    }
  };

  if (!appUser) return <EipUserPending />;
  // 權限還沒載入完就判斷 allowed 會把有權限的人踢走（重新整理／書籤必中）
  if (!permsLoaded) return <div className="text-muted-foreground py-8">載入中…</div>;
  if (!allowed) return <Navigate to="/dashboard/eip/my-tasks" replace />;

  return (
    <div>
      <PageHeader
        title="常態工作"
        description="集中管理週期性任務（每日 / 每週 / 每月 / 每年），由系統自動依排程生成任務與提醒。"
        actions={
          <div className="flex items-center gap-2">
            {canRunQ.data && (
              <Button variant="outline" onClick={runNow} disabled={running}>
                <Play className="w-4 h-4 mr-1" />
                {running ? "產生中…" : "立即產生/檢查"}
              </Button>
            )}
            {canCreate && (
              <Button onClick={() => { setEditing(null); setOpen(true); }}>
                <Plus className="w-4 h-4 mr-1" />新增規則
              </Button>
            )}
          </div>
        }
      />
      <Tabs defaultValue="rules" className="mt-2">
        <TabsList>
          <TabsTrigger value="rules">規則設定</TabsTrigger>
          <TabsTrigger value="dashboard">達成儀表板</TabsTrigger>
        </TabsList>
        <TabsContent value="rules">
          <div className="flex flex-wrap items-center gap-2 mt-3 mb-2">
            <Input
              placeholder="搜尋標題 / 說明"
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              className="h-9 w-full sm:w-56"
            />
            <div className="w-full sm:w-44">
              <MultiSelect
                values={filterDepts}
                onChange={setFilterDepts}
                allLabel="全部部門"
                itemLabel="部門"
                options={[
                  { value: "none", label: "未指定部門" },
                  ...(deptQ.data ?? []).map((d) => ({ value: d.id, label: d.name })),
                ]}
                contentClassName="w-64"
              />
            </div>
            <div className="w-full sm:w-44">
              <MultiSelect
                values={filterOwners}
                onChange={setFilterOwners}
                allLabel="全部負責人"
                itemLabel="負責人"
                options={(usersQ.data ?? []).map((u) => ({ value: u.id, label: u.name }))}
                contentClassName="w-64"
              />
            </div>
            <Button
              type="button"
              variant={onlyRelated ? "default" : "outline"}
              className="h-9"
              onClick={() => setOnlyRelated((v) => !v)}
              title="只顯示我負責、我是對接人員、我建立，或對接部門是我部門的規則"
            >
              只看與我相關
            </Button>
            {(kw || filterDepts.length || filterOwners.length || !onlyRelated) && (
              <Button
                type="button"
                variant="ghost"
                className="h-9"
                onClick={() => { setKw(""); setFilterDepts([]); setFilterOwners([]); setOnlyRelated(true); }}
              >
                重設
              </Button>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              顯示 {shownRules.length} / {(rulesQ.data ?? []).length} 筆
            </span>
          </div>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              {rulesQ.isLoading ? (
                <div className="text-sm text-muted-foreground text-center py-8">載入中…</div>
              ) : !rulesQ.data?.length ? (
                <div className="text-sm text-muted-foreground text-center py-8">尚無常態工作規則。</div>
              ) : !shownRules.length ? (
                <div className="text-sm text-muted-foreground text-center py-8">
                  沒有符合篩選條件的規則。可以關掉「只看與我相關」或按「重設」。
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>標題</TableHead>
                      <TableHead>負責人</TableHead>
                      <TableHead>部門</TableHead>
                      <TableHead>週期</TableHead>
                      <TableHead>優先級</TableHead>
                      <TableHead>上次執行</TableHead>
                      <TableHead className="text-center">啟用</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shownRules.map((r) => (
                      <Fragment key={r.id}>
                      <TableRow>
                        <TableCell className="w-8 pr-0 align-middle">
                          <button type="button" onClick={() => toggleExpand(r.id)} aria-expanded={expanded.has(r.id)}
                            aria-label={expanded.has(r.id) ? "收合" : "展開檢視內文"}
                            className="p-1 rounded hover:bg-muted text-muted-foreground">
                            <ChevronDown className={`w-4 h-4 transition-transform ${expanded.has(r.id) ? "" : "-rotate-90"}`} />
                          </button>
                        </TableCell>
                        <TableCell className="font-medium cursor-pointer" onClick={() => toggleExpand(r.id)}>{r.title}</TableCell>
                        <TableCell>{userMap.get(r.owner_id)?.name ?? "—"}</TableCell>
                        <TableCell>{r.department_id ? deptMap.get(r.department_id)?.name ?? "—" : "—"}</TableCell>
                        <TableCell><Badge variant="secondary">{FREQ_LABEL[r.freq] ?? r.freq}</Badge> <span className="text-xs text-muted-foreground">{summarize(r)}</span></TableCell>
                        <TableCell>{PRIORITY_LABEL[r.priority]}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.last_run_on ?? "—"}</TableCell>
                        <TableCell className="text-center">
                          <Switch checked={r.is_active} onCheckedChange={() => canManage && toggleActive(r)} disabled={!canManage} />
                        </TableCell>
                        <TableCell className="text-right">
                          {canManage && (
                            <div className="flex items-center justify-end gap-1">
                              <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                              <Button size="icon" variant="ghost" onClick={() => remove(r)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded.has(r.id) && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={9} className="py-3">
                            <RuleDetail r={r} userMap={userMap} deptMap={deptMap} />
                          </TableCell>
                        </TableRow>
                      )}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="dashboard">
          <AchievementDashboard
            users={usersQ.data ?? []}
            departments={deptQ.data ?? []}
            activeRulesCount={(rulesQ.data ?? []).filter((r) => r.is_active).length}
          />
        </TabsContent>
      </Tabs>


      {open && (
        <RuleDialog
          rule={editing}
          users={usersQ.data ?? []}
          departments={deptQ.data ?? []}
          ownerFallback={appUser.id}
          onClose={() => setOpen(false)}
          onSaved={() => { setOpen(false); refresh(); }}
        />
      )}
    </div>
  );
}

function RuleDialog({
  rule, users, departments, ownerFallback, onClose, onSaved,
}: {
  rule: Rule | null;
  users: AppUser[];
  departments: Department[];
  ownerFallback: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(rule?.title ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [ownerId, setOwnerId] = useState<string>(rule?.owner_id ?? ownerFallback);
  const [deptId, setDeptId] = useState<string>(rule?.department_id ?? "none");
  const [counterpart, setCounterpart] = useState(rule?.counterpart ?? "");
  // 對接人員＝指定實際帳號（會通知並列為協作者），2026-08-25 起可複選；
  // counterpart 文字欄保留給舊資料
  const [counterpartUserIds, setCounterpartUserIds] = useState<string[]>(counterpartIds(rule));
  const [priority, setPriority] = useState<Priority>(rule?.priority ?? "normal");
  const [freq, setFreq] = useState<string>(rule?.freq ?? "monthly");
  const [weekday, setWeekday] = useState<number>(rule?.weekday ?? 1);
  const [activeWeekdays, setActiveWeekdays] = useState<number[]>(
    Array.isArray((rule as any)?.active_weekdays) && (rule as any).active_weekdays.length > 0
      ? (rule as any).active_weekdays
      : [1, 2, 3, 4, 5, 6, 7]
  );
  const toggleWeekdayCheck = (d: number) =>
    setActiveWeekdays((s) => {
      if (s.includes(d)) {
        if (s.length <= 1) return s;          // 至少保留一天
        return s.filter((x) => x !== d);
      }
      return [...s, d].sort((a, b) => a - b);
    });
  const [months, setMonths] = useState<number[]>(rule?.months ?? []);
  const [days, setDays] = useState<string>((rule?.days_of_month ?? []).join(","));
  const [useMonthEnd, setUseMonthEnd] = useState(rule?.use_month_end ?? false);
  const [advance, setAdvance] = useState<string>((rule?.advance_days ?? [1]).join(","));
  const [repeatEvery, setRepeatEvery] = useState<string>(String(rule?.repeat_every_days ?? ""));
  const [remindUntilDone, setRemindUntilDone] = useState(rule?.remind_until_done ?? true);
  const [isActive, setIsActive] = useState(rule?.is_active ?? true);
  const [fields, setFields] = useState<ReportField[]>(
    Array.isArray(rule?.report_fields) ? (rule?.report_fields as unknown as ReportField[]) : []
  );
  const [busy, setBusy] = useState(false);

  const toggleMonth = (m: number) =>
    setMonths((s) => s.includes(m) ? s.filter((x) => x !== m) : [...s, m].sort((a, b) => a - b));

  const submit = async () => {
    if (!title.trim()) return toast.error("請輸入標題");
    setBusy(true);
    try {
      const parseList = (s: string): number[] =>
        s.split(/[,\s、，]/).map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n) && n > 0);
      const payload = {
        tenant_id: DEFAULT_TENANT_ID,
        title: title.trim(),
        description: description.trim() || null,
        owner_id: ownerId,
        department_id: deptId === "none" ? null : deptId,
        counterpart: counterpart.trim() || null,
        // 陣列是主資料；單一欄位交給 DB trigger 同步（trg_recurring_sync_counterparts）
        counterpart_user_ids: counterpartUserIds,
        priority,
        freq,
        weekday: freq === "weekly" ? weekday : null,
        active_weekdays: freq === "daily" && activeWeekdays.length < 7 ? activeWeekdays : null,
        months: (freq === "monthly" || freq === "yearly") ? (months.length ? months : null) : null,
        days_of_month: (freq === "monthly" || freq === "yearly") && !useMonthEnd ? parseList(days) : null,
        use_month_end: (freq === "monthly" || freq === "yearly") ? useMonthEnd : false,
        advance_days: parseList(advance),
        repeat_every_days: repeatEvery ? parseInt(repeatEvery, 10) : null,
        remind_until_done: remindUntilDone,
        is_active: isActive,
        report_fields: fields as unknown as Database["public"]["Tables"]["recurring_rule"]["Row"]["report_fields"],
      };
      if (rule) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await supabase
          .from("recurring_rule").update(payload as any).eq("id", rule.id).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error("儲存失敗：沒有權限修改這條規則（僅規則負責人 / 該部門主管 / 管理者）");
        toast.success("已更新");
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await supabase.from("recurring_rule").insert(payload as any);
        if (error) throw error;
        toast.success("已新增");
      }
      onSaved();
    } catch (e) {
      toast.error(humanizeError(e, "儲存"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] overflow-y-auto"
        aria-describedby={undefined}
      >
        <DialogHeader><DialogTitle>{rule ? "編輯規則" : "新增規則"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 space-y-1.5">
            <Label>標題 *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>說明</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label>負責人</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>對接部門</Label>
            <Select value={deptId} onValueChange={setDeptId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>對接人員（選填，可複選；會通知並列為協作者）</Label>
            <MultiSelect
              values={counterpartUserIds}
              onChange={setCounterpartUserIds}
              options={users.map((u) => ({ value: u.id, label: u.name }))}
              allLabel="—（不指定）"
              itemLabel="對接人員"
              contentClassName="w-64"
            />
            {counterpartUserIds.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {counterpartUserIds
                  .map((id) => users.find((u) => u.id === id)?.name ?? id)
                  .join("、")}
                {" "}—— 每次產生任務時都會掛成協作者並收到通知，也看得到這條規則。
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>優先級</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["low", "normal", "high", "urgent"] as Priority[]).map((p) =>
                  <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2 border-t pt-3 space-y-3">
            <div className="space-y-1.5">
              <Label>週期</Label>
              <Select value={freq} onValueChange={setFreq}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(FREQ_LABEL).map(([k, v]) =>
                    <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {freq === "daily" && (
              <div className="space-y-1.5">
                <Label>執行日 <span className="text-xs text-muted-foreground">（預設每天）</span></Label>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((w) => (
                    <Button key={w.v} type="button" size="sm"
                      variant={activeWeekdays.includes(w.v) ? "default" : "outline"}
                      onClick={() => toggleWeekdayCheck(w.v)}>{w.label}</Button>
                  ))}
                </div>
              </div>
            )}

            {freq === "weekly" && (
              <div className="space-y-1.5">
                <Label>星期幾</Label>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((w) => (
                    <Button key={w.v} type="button" size="sm"
                      variant={weekday === w.v ? "default" : "outline"}
                      onClick={() => setWeekday(w.v)}>{w.label}</Button>
                  ))}
                </div>
              </div>
            )}

            {(freq === "monthly" || freq === "yearly") && (
              <>
                <div className="space-y-1.5">
                  <Label>適用月份 {freq === "monthly" && <span className="text-xs text-muted-foreground">（留空＝每月）</span>}</Label>
                  {freq === "monthly" && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {MONTH_PRESETS.map((p) => (
                        <Button key={p.label} type="button" size="sm" variant="outline"
                          onClick={() => setMonths(p.months)}>{p.label}</Button>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_MONTHS.map((m) => (
                      <Button key={m} type="button" size="sm"
                        variant={months.includes(m) ? "default" : "outline"}
                        onClick={() => toggleMonth(m)}>{m}</Button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="month-end" checked={useMonthEnd} onCheckedChange={(v) => setUseMonthEnd(!!v)} />
                  <Label htmlFor="month-end" className="cursor-pointer">月底</Label>
                </div>
                {!useMonthEnd && (
                  <div className="space-y-1.5">
                    <Label>每月哪幾日 <span className="text-xs text-muted-foreground">（多個以逗號分隔，如 10,20,30）</span></Label>
                    <Input value={days} onChange={(e) => setDays(e.target.value)} placeholder="10,20,30" />
                  </div>
                )}
              </>
            )}
          </div>

          <div className="col-span-2 border-t pt-3 grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>提前幾天提醒 <span className="text-xs text-muted-foreground">（多段以逗號分隔）</span></Label>
              <Input value={advance} onChange={(e) => setAdvance(e.target.value)} placeholder="30,7,1" />
            </div>
            <div className="space-y-1.5">
              <Label>逾期後每幾天再提醒</Label>
              <Input type="number" value={repeatEvery} onChange={(e) => setRepeatEvery(e.target.value)} placeholder="例如 1" />
            </div>
            <div className="col-span-2 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch id="rud" checked={remindUntilDone} onCheckedChange={setRemindUntilDone} />
                <Label htmlFor="rud" className="cursor-pointer">直到回報完成才停</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="act" checked={isActive} onCheckedChange={setIsActive} />
                <Label htmlFor="act" className="cursor-pointer">啟用</Label>
              </div>
            </div>
          </div>

          <div className="col-span-2 border-t pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <Label>回報欄位</Label>
              <Button type="button" size="sm" variant="outline"
                onClick={() => setFields((s) => [...s, { label: "", type: "text" }])}>
                <Plus className="w-3 h-3 mr-1" />新增欄位
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">定義此工作完成時要回報什麼（如：是否完成、發票號碼、金額）。</p>
            {fields.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">尚未新增回報欄位</div>
            ) : (
              <div className="space-y-2">
                {fields.map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input className="flex-1" placeholder="欄位名稱" value={f.label}
                      onChange={(e) => setFields((s) => s.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                    <Select value={f.type} onValueChange={(v) => setFields((s) => s.map((x, j) => j === i ? { ...x, type: v as ReportField["type"] } : x))}>
                      <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">文字</SelectItem>
                        <SelectItem value="checkbox">勾選</SelectItem>
                        <SelectItem value="number">數字</SelectItem>
                        <SelectItem value="date">日期</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button type="button" size="icon" variant="ghost"
                      onClick={() => setFields((s) => s.filter((_, j) => j !== i))}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "儲存中…" : "儲存"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type OverviewRow = Database["public"]["Views"]["eip_recurring_overview"]["Row"];
type PeriodKey = "month" | "30d" | "all";

function AchievementDashboard({
  users, departments, activeRulesCount,
}: {
  users: AppUser[];
  departments: Department[];
  activeRulesCount: number;
}) {
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [ownerId, setOwnerId] = useState<string>("all");
  const [deptId, setDeptId] = useState<string>("all");

  const range = useMemo(() => {
    const today = new Date();
    // 用本地(台北)日期格式化，不要走 toISOString（UTC+8 會把月首/今天退回前一天，
    // 導致「本月」範圍整段位移、月底到期的常態工作被漏算）。
    const fmt = (d: Date) => d.toLocaleDateString("sv-SE");
    if (period === "month") {
      const s = new Date(today.getFullYear(), today.getMonth(), 1);
      const e = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { from: fmt(s), to: fmt(e) };
    }
    if (period === "30d") {
      const s = new Date(today); s.setDate(s.getDate() - 30);
      return { from: fmt(s), to: fmt(today) };
    }
    return { from: null as string | null, to: null as string | null };
  }, [period]);

  const overviewQ = useQuery({
    queryKey: ["eip", "recurring-overview", range.from, range.to, ownerId, deptId],
    queryFn: async () => {
      let q = supabase.from("eip_recurring_overview").select("*");
      if (range.from) q = q.gte("due_date", range.from);
      if (range.to) q = q.lte("due_date", range.to);
      if (ownerId !== "all") q = q.eq("owner_id", ownerId);
      if (deptId !== "all") q = q.eq("department_id", deptId);
      const { data, error } = await q.order("due_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as OverviewRow[];
    },
  });

  const rows = overviewQ.data ?? [];
  const today = taipeiToday();
  const total = rows.length;
  const done = rows.filter((r) => r.is_done).length;
  const overdue = rows.filter((r) => r.is_overdue).length;
  const unreported = rows.filter((r) => !r.is_done && (r.due_date ?? "") <= today).length;
  const rate = total ? Math.round((done / total) * 100) : 0;

  const overdueList = rows.filter((r) => r.is_overdue);
  const unreportedList = rows.filter((r) => !r.is_done && (r.due_date ?? "") <= today);

  const daysBetween = (a: string, b: string) =>
    Math.floor((new Date(a).getTime() - new Date(b).getTime()) / 86400000);

  const byOwner = useMemo(() => {
    const m = new Map<string, { name: string; total: number; done: number; overdue: number }>();
    rows.forEach((r) => {
      const key = r.owner_id ?? "—";
      const name = r.owner_name ?? "—";
      const v = m.get(key) ?? { name, total: 0, done: 0, overdue: 0 };
      v.total += 1;
      if (r.is_done) v.done += 1;
      if (r.is_overdue) v.overdue += 1;
      m.set(key, v);
    });
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [rows]);

  const byDept = useMemo(() => {
    const m = new Map<string, { name: string; total: number; done: number; overdue: number }>();
    rows.forEach((r) => {
      const key = r.department_id ?? "—";
      const name = r.department_name ?? "—";
      const v = m.get(key) ?? { name, total: 0, done: 0, overdue: 0 };
      v.total += 1;
      if (r.is_done) v.done += 1;
      if (r.is_overdue) v.overdue += 1;
      m.set(key, v);
    });
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [rows]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">期間</Label>
            <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="month">本月</SelectItem>
                <SelectItem value="30d">近 30 天</SelectItem>
                <SelectItem value="all">全部</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">負責人</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">部門</Label>
            <Select value={deptId} onValueChange={setDeptId}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard label="啟用規則" value={activeRulesCount} />
        <MetricCard label="本期到期" value={total} />
        <MetricCard label="已完成" value={done} tone="success" />
        <MetricCard label="逾期未完成" value={overdue} tone="danger" />
        <MetricCard label="未回報" value={unreported} tone="warning" />
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="text-xs text-muted-foreground">達成率</div>
            <div className="text-2xl font-bold">{rate}%</div>
            <Progress value={rate} className="h-2" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="font-medium">逾期清單</div>
          {overviewQ.isLoading ? (
            <div className="text-sm text-muted-foreground text-center py-6">載入中…</div>
          ) : overdueList.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-6">沒有逾期項目 🎉</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>工作</TableHead><TableHead>負責人</TableHead>
                <TableHead>到期日</TableHead><TableHead className="text-right">逾期天數</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {overdueList.map((r) => (
                  <TableRow key={r.task_id ?? ""}>
                    <TableCell className="font-medium">
                      <Link to="/dashboard/eip/tasks" className="text-primary hover:underline">{r.rule_title}</Link>
                    </TableCell>
                    <TableCell>{r.owner_name ?? "—"}</TableCell>
                    <TableCell className="text-destructive">{r.due_date ?? "—"}</TableCell>
                    <TableCell className="text-right text-destructive font-medium">
                      {r.due_date ? daysBetween(today, r.due_date) : "—"} 天
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="font-medium">未回報 / 待處理</div>
          {unreportedList.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-6">沒有待處理項目</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>負責人</TableHead><TableHead>工作</TableHead><TableHead>到期日</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {unreportedList.map((r) => (
                  <TableRow key={r.task_id ?? ""}>
                    <TableCell>{r.owner_name ?? "—"}</TableCell>
                    <TableCell>
                      <Link to="/dashboard/eip/tasks" className="text-primary hover:underline">{r.rule_title}</Link>
                    </TableCell>
                    <TableCell>{r.due_date ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="font-medium">依負責人</div>
            {byOwner.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">無資料</div>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>負責人</TableHead><TableHead className="text-right">到期</TableHead>
                  <TableHead className="text-right">完成</TableHead><TableHead className="text-right">逾期</TableHead>
                  <TableHead className="text-right">達成率</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {byOwner.map((o, i) => (
                    <TableRow key={i}>
                      <TableCell>{o.name}</TableCell>
                      <TableCell className="text-right">{o.total}</TableCell>
                      <TableCell className="text-right">{o.done}</TableCell>
                      <TableCell className="text-right text-destructive">{o.overdue}</TableCell>
                      <TableCell className="text-right">{o.total ? Math.round((o.done / o.total) * 100) : 0}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="font-medium">依部門</div>
            {byDept.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">無資料</div>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>部門</TableHead><TableHead className="text-right">到期</TableHead>
                  <TableHead className="text-right">完成</TableHead><TableHead className="text-right">逾期</TableHead>
                  <TableHead className="text-right">達成率</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {byDept.map((o, i) => (
                    <TableRow key={i}>
                      <TableCell>{o.name}</TableCell>
                      <TableCell className="text-right">{o.total}</TableCell>
                      <TableCell className="text-right">{o.done}</TableCell>
                      <TableCell className="text-right text-destructive">{o.overdue}</TableCell>
                      <TableCell className="text-right">{o.total ? Math.round((o.done / o.total) * 100) : 0}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: number; tone?: "success" | "danger" | "warning" }) {
  const toneCls =
    tone === "success" ? "text-emerald-600" :
    tone === "danger" ? "text-destructive" :
    tone === "warning" ? "text-amber-600" : "";
  return (
    <Card>
      <CardContent className="p-4 space-y-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-bold ${toneCls}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
