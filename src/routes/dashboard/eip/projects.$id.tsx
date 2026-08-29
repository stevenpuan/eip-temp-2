import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronLeft, Plus, Pencil, Trash2, Target, Flag, ListChecks,
  AlertTriangle, CalendarDays, Activity, MoreHorizontal, Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEipUser } from "@/lib/eip-user";
import { useActiveUsers, useAllUsers } from "@/hooks/useUsers";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import type { Database } from "@/integrations/supabase/types";
import { TaskSourceBadge, useTaskSources } from "@/components/eip/TaskSourceBadge";
import { EditTaskDialog } from "@/routes/dashboard/eip/tasks";
import { VisibilityBadge } from "@/components/eip/VisibilityScope";
import { humanizeError } from "@/lib/eip-error";
import { taipeiToday } from "@/lib/eip-routine";

export const Route = createFileRoute("/dashboard/eip/projects/$id")({
  validateSearch: (search: Record<string, unknown>): { milestone?: string } => ({
    milestone: typeof search.milestone === "string" ? search.milestone : undefined,
  }),
  component: ProjectDetailPage,
});

type Project = Database["public"]["Tables"]["project"]["Row"];
type Task = Database["public"]["Tables"]["task"]["Row"];
type Milestone = Database["public"]["Tables"]["milestone"]["Row"];
type AppUser = Database["public"]["Tables"]["app_user"]["Row"];
type Kpi = Database["public"]["Tables"]["project_kpi"]["Row"];
type Risk = Database["public"]["Tables"]["project_risk"]["Row"];
type Meeting = Database["public"]["Tables"]["meeting"]["Row"];
type ProjectStatus = Database["public"]["Enums"]["project_status"];
type ProjectHealth = Database["public"]["Enums"]["project_health"];

const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: "規劃中", active: "進行中", on_hold: "暫停", done: "已完成",
};
const HEALTH_LABEL: Record<ProjectHealth, string> = {
  on_track: "綠燈 · 正常", at_risk: "黃燈 · 需關注", off_track: "紅燈 · 風險",
};
const HEALTH_DOT: Record<ProjectHealth, string> = {
  on_track: "bg-emerald-500", at_risk: "bg-amber-500", off_track: "bg-red-500",
};
const RISK_LEVEL_LABEL: Record<string, string> = { high: "高", medium: "中", low: "低" };
const RISK_STATUS_LABEL: Record<string, string> = { open: "待處理", mitigating: "處理中", closed: "已解決" };
const RISK_STATUS_COLOR: Record<string, string> = {
  open: "bg-red-100 text-red-700",
  mitigating: "bg-amber-100 text-amber-700",
  closed: "bg-emerald-100 text-emerald-700",
};
const MEETING_STATUS_LABEL: Record<string, string> = {
  draft: "草稿", scheduled: "已排程", in_progress: "進行中", completed: "已結束", canceled: "已取消",
};

function ProjectDetailPage() {
  const { id } = Route.useParams();
  const { milestone: highlightMilestoneId } = Route.useSearch();
  const { appUser } = useEipUser();
  const { can } = useAuth();
  const qc = useQueryClient();

  const projectQ = useQuery({
    queryKey: ["eip", "project", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("project").select("*").eq("id", id).single();
      if (error) throw error;
      return data as Project;
    },
  });
  // 顯示對照用：含已停用者，保留離職同仁的歷史姓名（選人用的清單在 TasksSection 內另取）
  const usersQ = useAllUsers();
  const tasksQ = useQuery({
    queryKey: ["eip", "project-tasks", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("task").select("*").eq("project_id", id);
      if (error) throw error;
      return (data ?? []) as Task[];
    },
  });
  const milestonesQ = useQuery({
    queryKey: ["eip", "milestones", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("milestone").select("*").eq("project_id", id).order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Milestone[];
    },
  });
  const kpisQ = useQuery({
    queryKey: ["eip", "project-kpis", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("project_kpi").select("*").eq("project_id", id).order("sort_order", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Kpi[];
    },
  });
  const risksQ = useQuery({
    queryKey: ["eip", "project-risks", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("project_risk").select("*").eq("project_id", id).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Risk[];
    },
  });
  const meetingsQ = useQuery({
    queryKey: ["eip", "project-meetings", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("meeting").select("*").eq("project_id", id).order("meeting_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Meeting[];
    },
  });
  const statusesQ = useQuery({
    queryKey: ["eip", "task-statuses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("task_status").select("*").order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const deptsTopQ = useQuery({
    queryKey: ["eip", "departments-tree"],
    queryFn: async () => {
      const { data, error } = await supabase.from("department").select("id,name,parent_id,sort_order").order("sort_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const userMap = useMemo(() => new Map((usersQ.data ?? []).map((u) => [u.id, u])), [usersQ.data]);
  const deptMap = useMemo(() => new Map((deptsTopQ.data ?? []).map((d: any) => [d.id as string, { name: d.name as string }])), [deptsTopQ.data]);
  const doneStatusIds = useMemo(
    () => new Set((statusesQ.data ?? []).filter((s: any) => s.is_done_state).map((s: any) => s.id as string)),
    [statusesQ.data],
  );

  if (projectQ.isLoading) return <div className="text-muted-foreground py-8">載入中…</div>;
  if (!projectQ.data) return <div className="text-destructive py-8">找不到專案</div>;

  const project = projectQ.data;
  const canEdit = can("eip_projects", "edit") || appUser?.id === project.owner_id;

  const tasks = tasksQ.data ?? [];
  const milestones = milestonesQ.data ?? [];
  const totalT = tasks.length;
  const doneT = tasks.filter((t) => doneStatusIds.has(t.status_id) || t.progress >= 100).length;
  const taskRate = totalT ? Math.round((doneT / totalT) * 100) : 0;
  const doneMs = milestones.filter((m) => m.status === "done").length;
  const totalMs = milestones.length;
  const avgMsProgress = totalMs ? Math.round(milestones.reduce((s, m) => s + (m.progress ?? 0), 0) / totalMs) : 0;
  const overallProgress = Math.round((taskRate + avgMsProgress) / (totalMs ? 2 : 1));
  // new Date("YYYY-MM-DD") 是 UTC 午夜＝台北早上 8 點，直接相減會讓截止日隔天的
  // 凌晨 0–8 點顯示「剩 0 天」而不是已逾期。補上 T00:00:00 用本地午夜比較
  //（列表頁 projects.index.tsx 已經是這個寫法）。
  const today = new Date();
  const daysLeft = project.end_date
    ? Math.ceil((new Date(project.end_date + "T00:00:00").getTime() - today.getTime()) / 86400000)
    : null;

  const refetchProject = () => qc.invalidateQueries({ queryKey: ["eip", "project", id] });

  const saveProject = async (patch: Partial<Project>) => {
    const { data, error } = await supabase
      .from("project").update(patch).eq("id", project.id).select("id");
    if (error) { toast.error(humanizeError(error, "儲存專案")); return; }
    // 被 RLS 擋掉時回 0 列而 error 是 null。這頁的 UPDATE／DELETE 原本全都只看 error，
    // 於是「改」和「刪」都跳成功、refetch 後彈回原值（新增反而會正確報 42501）。
    if (!data?.length) { toast.error("儲存失敗：沒有權限修改這個專案（僅專案負責人 / 專案成員 / 管理者）"); refetchProject(); return; }
    toast.success("已儲存"); refetchProject();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={project.name}
        description={project.goal ?? undefined}
        actions={
          <Link to="/dashboard/eip/projects">
            <Button variant="outline"><ChevronLeft className="w-4 h-4" />返回</Button>
          </Link>
        }
      />

      {/* A. 概覽 */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">狀態</span>
              {canEdit ? (
                <Select value={project.status} onValueChange={(v) => saveProject({ status: v as ProjectStatus })}>
                  <SelectTrigger className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) =>
                      <SelectItem key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : <Badge variant="secondary">{PROJECT_STATUS_LABEL[project.status]}</Badge>}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">健康度</span>
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${HEALTH_DOT[project.health]}`} />
              {canEdit ? (
                <Select value={project.health} onValueChange={(v) => saveProject({ health: v as ProjectHealth })}>
                  <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(HEALTH_LABEL) as ProjectHealth[]).map((h) =>
                      <SelectItem key={h} value={h}>{HEALTH_LABEL[h]}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : <span>{HEALTH_LABEL[project.health]}</span>}
            </div>
            <div><span className="text-muted-foreground">負責人 </span>{userMap.get(project.owner_id)?.name ?? "—"}</div>
            <div><span className="text-muted-foreground">期間 </span>{project.start_date ?? "—"} ~ {project.end_date ?? "—"}</div>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">可見範圍</span>
              <VisibilityBadge scope={project.visibility_scope} departmentId={project.department_id} deptMap={deptMap} />
            </div>
          </div>
          {(project.goal || project.scope || project.description) && (
            <div className="grid gap-2 md:grid-cols-3 text-sm">
              {project.goal && (
                <div><div className="text-xs text-muted-foreground mb-0.5">目標</div><div className="whitespace-pre-wrap">{project.goal}</div></div>
              )}
              {project.scope && (
                <div><div className="text-xs text-muted-foreground mb-0.5">範疇</div><div className="whitespace-pre-wrap">{project.scope}</div></div>
              )}
              {project.description && (
                <div><div className="text-xs text-muted-foreground mb-0.5">描述</div><div className="whitespace-pre-wrap text-muted-foreground">{project.description}</div></div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* B. 儀表板 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatBox label="整體進度" value={`${overallProgress}%`} />
        <StatBox label="任務完成率" value={`${taskRate}%`} sub={`${doneT}/${totalT}`} />
        <StatBox label="里程碑達成" value={`${doneMs}/${totalMs}`} sub={`平均進度 ${avgMsProgress}%`} />
        <StatBox label="距結束" value={daysLeft == null ? "—" : `${daysLeft} 天`} accent={daysLeft != null && daysLeft < 0 ? "text-red-600" : ""} />
        <StatBox label="健康度" value={<span className="flex items-center gap-1.5"><span className={`inline-block w-2.5 h-2.5 rounded-full ${HEALTH_DOT[project.health]}`} />{HEALTH_LABEL[project.health].split(" · ")[0]}</span>} />
      </div>

      {/* C0. 專案成員 */}
      <Section icon={Users} title="專案成員">
        <MembersSection projectId={id} ownerId={project.owner_id} userMap={userMap} canEdit={canEdit} />
      </Section>

      {/* C. KPI */}
      <Section icon={Target} title="KPI 指標">
        <KpiSection projectId={id} tenantId={project.tenant_id} kpis={kpisQ.data ?? []} canEdit={canEdit} />
      </Section>

      {/* D. 里程碑 */}
      <Section icon={Flag} title="里程碑">
        <MilestonesSection projectId={id} tenantId={project.tenant_id} milestones={milestones} canEdit={canEdit} highlightId={highlightMilestoneId} />
      </Section>

      {/* E. 任務 */}
      <Section icon={ListChecks} title={`專案任務（完成 ${doneT}/${totalT}・${taskRate}%）`}>
        <TasksSection projectId={id} tenantId={project.tenant_id} tasks={tasks} statuses={statusesQ.data ?? []} userMap={userMap} doneStatusIds={doneStatusIds} canEdit={canEdit} appUser={appUser ?? null} />
      </Section>

      {/* F. 風險 */}
      <Section icon={AlertTriangle} title="風險與議題">
        <RisksSection projectId={id} tenantId={project.tenant_id} risks={risksQ.data ?? []} canEdit={canEdit} />
      </Section>

      {/* G. 會議 */}
      <Section icon={CalendarDays} title="關聯會議">
        <MeetingsSection projectId={id} meetings={meetingsQ.data ?? []} canEdit={canEdit} />
      </Section>

    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary">
            <Icon className="w-4 h-4" />
          </span>
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function StatBox({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-bold mt-0.5 ${accent ?? ""}`}>{value}</div>
        {sub && <div className="text-[12.5px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

/* ---------- KPI ---------- */
function KpiSection({ projectId, tenantId, kpis, canEdit }: { projectId: string; tenantId: string; kpis: Kpi[]; canEdit: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Kpi | "new" | null>(null);
  const refetch = () => qc.invalidateQueries({ queryKey: ["eip", "project-kpis", projectId] });

  const remove = async (k: Kpi) => {
    const { data, error } = await supabase.from("project_kpi").delete().eq("id", k.id).select("id");
    if (error) { toast.error(humanizeError(error, "刪除 KPI")); return; }
    if (!data?.length) { toast.error("刪除失敗：沒有權限修改這個專案（僅專案負責人 / 專案成員 / 管理者）"); return; }
    toast.success("已刪除"); refetch();
  };

  return (
    <>
      {kpis.length === 0 ? (
        <div className="text-xs text-muted-foreground">尚無 KPI{canEdit && "，點下方「新增 KPI」設定第一個指標"}</div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {kpis.map((k) => {
            const cur = parseFloat(k.current_value ?? "0") || 0;
            const tgt = parseFloat(k.target_value ?? "0") || 0;
            const pct = tgt > 0 ? Math.min(100, Math.round((cur / tgt) * 100)) : 0;
            return (
              <div key={k.id} className="p-3 border rounded-md">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{k.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {k.current_value ?? "—"} / {k.target_value ?? "—"} {k.unit ?? ""}
                    </div>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{pct}%</span>
                  {canEdit && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground"><MoreHorizontal className="w-3.5 h-3.5" /></button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditing(k)}><Pencil className="w-3.5 h-3.5 mr-2" />編輯</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => remove(k)}><Trash2 className="w-3.5 h-3.5 mr-2" />刪除</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                <Progress value={pct} className="h-1.5 mt-2" />
              </div>
            );
          })}
        </div>
      )}
      {canEdit && (
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
          <Plus className="w-3.5 h-3.5" /> 新增 KPI
        </Button>
      )}
      {editing && (
        <KpiDialog
          kpi={editing === "new" ? null : editing}
          projectId={projectId} tenantId={tenantId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refetch(); }}
        />
      )}
    </>
  );
}

function KpiDialog({ kpi, projectId, tenantId, onClose, onSaved }: { kpi: Kpi | null; projectId: string; tenantId: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(kpi?.name ?? "");
  const [target, setTarget] = useState(kpi?.target_value ?? "");
  const [current, setCurrent] = useState(kpi?.current_value ?? "");
  const [unit, setUnit] = useState(kpi?.unit ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return toast.error("請輸入名稱");
    setBusy(true);
    const payload = {
      project_id: projectId, tenant_id: tenantId,
      name: name.trim(),
      target_value: target.trim() || null,
      current_value: current.trim() || null,
      unit: unit.trim() || null,
    };
    const { data, error } = kpi
      ? await supabase.from("project_kpi").update(payload).eq("id", kpi.id).select("id")
      : await supabase.from("project_kpi").insert(payload).select("id");
    setBusy(false);
    if (error) { toast.error(humanizeError(error, "儲存 KPI")); return; }
    if (!data?.length) { toast.error("儲存失敗：沒有權限修改這個專案（僅專案負責人 / 專案成員 / 管理者）"); return; }
    toast.success("已儲存"); onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{kpi ? "編輯 KPI" : "新增 KPI"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <Field label="名稱"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：客戶滿意度" /></Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="目前值"><Input value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
            <Field label="目標值"><Input value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
            <Field label="單位"><Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="%, 件, 萬…" /></Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "儲存中…" : "儲存"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Milestones ---------- */
function MilestonesSection({ projectId, tenantId, milestones, canEdit, highlightId }: { projectId: string; tenantId: string; milestones: Milestone[]; canEdit: boolean; highlightId?: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [due, setDue] = useState("");
  const [flashId, setFlashId] = useState<string | null>(null);
  const today = taipeiToday(); // 台北今天，勿用 toISOString（清晨會退回昨天，逾期判定錯位）
  const refetch = () => qc.invalidateQueries({ queryKey: ["eip", "milestones", projectId] });

  useEffect(() => {
    if (!highlightId || milestones.length === 0) return;
    if (!milestones.some((m) => m.id === highlightId)) return;
    const el = document.getElementById(`ms-${highlightId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashId(highlightId);
      const t = setTimeout(() => setFlashId(null), 2000);
      return () => clearTimeout(t);
    }
  }, [highlightId, milestones]);

  const add = async () => {
    if (!name.trim()) return;
    const { error } = await supabase.from("milestone").insert({
      tenant_id: tenantId, project_id: projectId, name: name.trim(),
      due_date: due || null, status: "pending",
    });
    if (error) toast.error(humanizeError(error, "新增里程碑")); else { setName(""); setDue(""); refetch(); }
  };
  const toggle = async (m: Milestone) => {
    const next = m.status === "done" ? "pending" : "done";
    const { data, error } = await supabase.from("milestone")
      .update({ status: next, progress: next === "done" ? 100 : m.progress }).eq("id", m.id).select("id");
    if (error) { toast.error(humanizeError(error, "更新里程碑")); return; }
    if (!data?.length) { toast.error("更新失敗：沒有權限修改這個專案（僅專案負責人 / 專案成員 / 管理者）"); refetch(); return; }
    refetch();
  };
  /** 回傳是否真的寫進去了，讓輸入框在失敗時可以把顯示值復原 */
  const setProgress = async (m: Milestone, v: number): Promise<boolean> => {
    // 夾在 0–100：DB 有 milestone_progress_check，超出範圍會回 23514
    if (!Number.isFinite(v)) return false;
    const val = Math.max(0, Math.min(100, Math.round(v)));
    if (val === (m.progress ?? 0)) return true;
    const { data, error } = await supabase.from("milestone")
      .update({ progress: val }).eq("id", m.id).select("id");
    if (error) { toast.error(humanizeError(error, "更新進度")); return false; }
    if (!data?.length) { toast.error("更新失敗：沒有權限修改這個專案（僅專案負責人 / 專案成員 / 管理者）"); refetch(); return false; }
    refetch();
    return true;
  };
  const remove = async (m: Milestone) => {
    const { data, error } = await supabase.from("milestone").delete().eq("id", m.id).select("id");
    if (error) { toast.error(humanizeError(error, "刪除里程碑")); return; }
    if (!data?.length) { toast.error("刪除失敗：沒有權限修改這個專案（僅專案負責人 / 專案成員 / 管理者）"); return; }
    refetch();
  };

  return (
    <>
      {milestones.length === 0 ? (
        <div className="text-xs text-muted-foreground">尚無里程碑{canEdit && "，於下方新增"}</div>
      ) : (
        <div className="relative pl-3">
          <div className="absolute left-1 top-2 bottom-2 w-px bg-border" />
          <div className="space-y-2">
            {milestones.map((m) => {
              const overdue = m.due_date && m.due_date < today && m.status !== "done";
              return (
                <div key={m.id} id={`ms-${m.id}`} className={`flex items-center gap-2 relative rounded-md transition-shadow ${flashId === m.id ? "ring-2 ring-primary ring-offset-1" : ""}`}>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => canEdit && toggle(m)}
                    className={`-ml-1 mt-0 w-3 h-3 rounded-full border-2 ${m.status === "done" ? "bg-emerald-500 border-emerald-500" : overdue ? "bg-red-500 border-red-500" : "bg-background border-muted-foreground"}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm ${m.status === "done" ? "line-through text-muted-foreground" : ""}`}>{m.name}</span>
                      {overdue && <Badge variant="destructive" className="text-[11.5px]">逾期</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">{m.due_date ?? "無期限"} · 進度 {m.progress}%</div>
                    <Progress value={m.progress} className="h-1 mt-1 max-w-xs" />
                  </div>
                  {canEdit && (
                    <>
                      <Input
                        type="number" min={0} max={100} defaultValue={m.progress ?? 0}
                        key={`${m.id}-${m.progress ?? 0}`}
                        /* 改成 onBlur：原本 onChange 每敲一鍵就寫一次庫（輸入 50 會先寫 5 再寫 50），
                           而且把欄位清空時 Number("") === 0 會直接把進度歸零。 */
                        onBlur={(e) => {
                          const raw = e.target.value.trim();
                          // 清空或寫入沒成功時，key 不會變 → 輸入框會一直停在空白／錯誤值，
                          // 旁邊卻顯示舊的百分比。這裡手動把顯示值復原。
                          if (raw === "") { e.target.value = String(m.progress ?? 0); return; }
                          void setProgress(m, Number(raw)).catch(() => { e.target.value = String(m.progress ?? 0); });
                        }}
                        className="w-20 h-8" />
                      <button onClick={() => remove(m)} className="text-muted-foreground hover:text-destructive p-1" aria-label="刪除"><Trash2 className="w-3.5 h-3.5" /></button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {canEdit && (
        <div className="flex gap-2 pt-1">
          <Input placeholder="新增里程碑…" value={name} onChange={(e) => setName(e.target.value)} />
          <Input type="date" className="w-[150px]" value={due} onChange={(e) => setDue(e.target.value)} />
          <Button size="sm" onClick={add}><Plus className="w-4 h-4" />新增</Button>
        </div>
      )}
    </>
  );
}

/* ---------- Tasks ---------- */
function TasksSection({
  projectId, tenantId, tasks, statuses, userMap, doneStatusIds, canEdit, appUser,
}: {
  projectId: string; tenantId: string; tasks: Task[]; statuses: any[];
  userMap: Map<string, AppUser>; doneStatusIds: Set<string>; canEdit: boolean; appUser: AppUser | null;
}) {
  const qc = useQueryClient();
  // 選人用：只在職，避免把專案任務指派給已離職同仁
  const activeUsersQ = useActiveUsers();
  const [adding, setAdding] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const statusMap = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);
  const sourceMap = useTaskSources(tasks);

  // for EditTaskDialog props
  const deptsQ = useQuery({
    queryKey: ["eip", "departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("department").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const allProjectsQ = useQuery({
    queryKey: ["eip", "projects"],
    queryFn: async () => {
      const { data, error } = await supabase.from("project").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <>
      {tasks.length === 0 ? (
        <div className="text-xs text-muted-foreground">尚無任務{canEdit && "，點右上「新增任務」建立"}</div>
      ) : (
        <div className="border rounded-md divide-y">
          {tasks.map((t) => {
            const done = doneStatusIds.has(t.status_id) || t.progress >= 100;
            const src = sourceMap.get(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setEditTask(t)}
                className="w-full text-left flex items-center gap-3 p-2.5 hover:bg-accent/50"
              >
                <div className="flex-1 min-w-0">
                  <div className={`text-sm truncate flex items-center gap-2 ${done ? "line-through text-muted-foreground" : ""}`}>
                    <span className="truncate">{t.title}</span>
                    {src && <TaskSourceBadge source={src} />}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {statusMap.get(t.status_id)?.name ?? "—"} · {userMap.get(t.owner_id)?.name ?? "—"}
                    {t.due_date && ` · 期限 ${t.due_date}`}
                  </div>
                </div>
                <div className="w-20 hidden sm:block">
                  <Progress value={t.progress} className="h-1.5" />
                  <div className="text-[11.5px] text-muted-foreground text-right mt-0.5">{t.progress}%</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {canEdit && appUser && (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="w-3.5 h-3.5" />新增任務</Button>
      )}
      {adding && appUser && (
        <NewTaskDialog
          projectId={projectId} tenantId={tenantId} statuses={statuses} users={activeUsersQ.data ?? []}
          appUser={appUser}
          onClose={() => setAdding(false)}
          onCreated={() => { setAdding(false); qc.invalidateQueries({ queryKey: ["eip", "project-tasks", projectId] }); }}
        />
      )}
      {editTask && (
        <EditTaskDialog
          key={editTask.id}
          task={editTask}
          readOnly={!canEdit && editTask.owner_id !== appUser?.id}
          onClose={() => setEditTask(null)}
          statuses={statuses as any}
          users={activeUsersQ.data ?? []}
          departments={(deptsQ.data ?? []) as any}
          projects={(allProjectsQ.data ?? []) as any}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["eip", "project-tasks", projectId] });
            setEditTask(null);
          }}
        />
      )}
    </>
  );
}

function NewTaskDialog({
  projectId, tenantId, statuses, users, appUser, onClose, onCreated,
}: {
  projectId: string; tenantId: string; statuses: any[]; users: AppUser[];
  appUser: AppUser; onClose: () => void; onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState(appUser.id);
  const [due, setDue] = useState("");
  const [statusId, setStatusId] = useState<string>(statuses[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) return toast.error("請輸入標題");
    if (!statusId) return toast.error("找不到任務狀態");
    setBusy(true);
    const { error } = await supabase.from("task").insert({
      tenant_id: tenantId, project_id: projectId,
      title: title.trim(), owner_id: ownerId, created_by: appUser.id,
      status_id: statusId, due_date: due || null,
    });
    setBusy(false);
    if (error) toast.error(humanizeError(error, "建立任務")); else { toast.success("已建立任務"); onCreated(); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>新增任務</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <Field label="標題"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="負責人">
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="狀態">
              <Select value={statusId} onValueChange={setStatusId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{statuses.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="期限"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "建立中…" : "建立"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Risks ---------- */
function RisksSection({ projectId, tenantId, risks, canEdit }: { projectId: string; tenantId: string; risks: Risk[]; canEdit: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Risk | "new" | null>(null);
  const refetch = () => qc.invalidateQueries({ queryKey: ["eip", "project-risks", projectId] });

  const remove = async (r: Risk) => {
    const { data, error } = await supabase.from("project_risk").delete().eq("id", r.id).select("id");
    if (error) { toast.error(humanizeError(error, "刪除風險")); return; }
    if (!data?.length) { toast.error("刪除失敗：沒有權限修改這個專案（僅專案負責人 / 專案成員 / 管理者）"); return; }
    toast.success("已刪除"); refetch();
  };

  return (
    <>
      {risks.length === 0 ? (
        <div className="text-xs text-muted-foreground">尚無風險紀錄{canEdit && "，點下方「新增風險」"}</div>
      ) : (
        <div className="border rounded-md divide-y">
          {risks.map((r) => (
            <div key={r.id} className="p-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{r.title}</span>
                  <Badge variant="outline" className="text-[11.5px]">可能性 {RISK_LEVEL_LABEL[r.likelihood ?? "medium"] ?? r.likelihood}</Badge>
                  <Badge variant="outline" className="text-[11.5px]">影響 {RISK_LEVEL_LABEL[r.impact ?? "medium"] ?? r.impact}</Badge>
                  <Badge className={`text-[11.5px] ${RISK_STATUS_COLOR[r.status] ?? ""}`} variant="secondary">{RISK_STATUS_LABEL[r.status] ?? r.status}</Badge>
                </div>
                {r.mitigation && <div className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">應對：{r.mitigation}</div>}
              </div>
              {canEdit && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground"><MoreHorizontal className="w-3.5 h-3.5" /></button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditing(r)}><Pencil className="w-3.5 h-3.5 mr-2" />編輯</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => remove(r)}><Trash2 className="w-3.5 h-3.5 mr-2" />刪除</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ))}
        </div>
      )}
      {canEdit && (
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
          <Plus className="w-3.5 h-3.5" /> 新增風險
        </Button>
      )}
      {editing && (
        <RiskDialog
          risk={editing === "new" ? null : editing}
          projectId={projectId} tenantId={tenantId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refetch(); }}
        />
      )}
    </>
  );
}

function RiskDialog({ risk, projectId, tenantId, onClose, onSaved }: { risk: Risk | null; projectId: string; tenantId: string; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(risk?.title ?? "");
  const [likelihood, setLikelihood] = useState(risk?.likelihood ?? "medium");
  const [impact, setImpact] = useState(risk?.impact ?? "medium");
  const [status, setStatus] = useState(risk?.status ?? "open");
  const [mitigation, setMitigation] = useState(risk?.mitigation ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) return toast.error("請輸入風險名稱");
    setBusy(true);
    const payload = {
      project_id: projectId, tenant_id: tenantId,
      title: title.trim(), likelihood, impact, status, mitigation: mitigation.trim() || null,
    };
    const { data, error } = risk
      ? await supabase.from("project_risk").update(payload).eq("id", risk.id).select("id")
      : await supabase.from("project_risk").insert(payload).select("id");
    setBusy(false);
    if (error) { toast.error(humanizeError(error, "儲存風險")); return; }
    if (!data?.length) { toast.error("儲存失敗：沒有權限修改這個專案（僅專案負責人 / 專案成員 / 管理者）"); return; }
    toast.success("已儲存"); onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{risk ? "編輯風險" : "新增風險"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <Field label="風險名稱"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="可能性">
              <Select value={likelihood} onValueChange={setLikelihood}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(RISK_LEVEL_LABEL).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="影響">
              <Select value={impact} onValueChange={setImpact}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(RISK_LEVEL_LABEL).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="狀態">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(RISK_STATUS_LABEL).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="應對方案"><Textarea rows={3} value={mitigation} onChange={(e) => setMitigation(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "儲存中…" : "儲存"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Meetings ---------- */
function MeetingsSection({ projectId, meetings, canEdit }: { projectId: string; meetings: Meeting[]; canEdit: boolean }) {
  const qc = useQueryClient();
  const [linkOpen, setLinkOpen] = useState(false);
  const linkedIds = useMemo(() => new Set(meetings.map((m) => m.id)), [meetings]);
  const candidatesQ = useQuery({
    queryKey: ["eip", "meetings-link-candidates", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from("meeting").select("*").or("project_id.is.null,project_id.neq." + projectId).order("meeting_date", { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as Meeting[];
    },
    enabled: linkOpen,
  });
  const [selectedId, setSelectedId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const link = async () => {
    if (!selectedId) return toast.error("請選擇會議");
    setBusy(true);
    const { data, error } = await supabase
      .from("meeting").update({ project_id: projectId }).eq("id", selectedId).select("id");
    setBusy(false);
    if (error) { toast.error(humanizeError(error, "關聯")); return; }
    // 這是寫 meeting 這張表，受 meeting_write 管（會議建立者／管轄主管／管理者），
    // 跟能不能編輯專案是兩回事，所以這裡的 0 列很常見。
    if (!data?.length) { toast.error("關聯失敗：沒有權限修改這場會議（需為會議建立者或該部門主管）"); return; }
    toast.success("已關聯");
    setSelectedId(""); setLinkOpen(false);
    qc.invalidateQueries({ queryKey: ["eip", "project-meetings", projectId] });
  };

  const unlink = async (mId: string) => {
    const { data, error } = await supabase
      .from("meeting").update({ project_id: null }).eq("id", mId).select("id");
    if (error) { toast.error(humanizeError(error, "取消關聯")); return; }
    if (!data?.length) { toast.error("取消關聯失敗：沒有權限修改這場會議"); return; }
    toast.success("已取消關聯");
    qc.invalidateQueries({ queryKey: ["eip", "project-meetings", projectId] });
  };

  const candidates = (candidatesQ.data ?? []).filter((m) => !linkedIds.has(m.id));

  return (
    <div className="space-y-2">
      {meetings.length === 0 ? (
        <div className="text-xs text-muted-foreground">尚無關聯會議{canEdit && "，點下方「+ 關聯會議」加入"}</div>
      ) : (
        <div className="border rounded-md divide-y">
          {meetings.map((m) => (
            <div key={m.id} className="flex items-center gap-3 p-2.5 hover:bg-accent/50">
              <Link to="/dashboard/eip/meetings/$id" params={{ id: m.id }} className="flex items-center gap-3 flex-1 min-w-0">
                <Activity className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{m.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(m.meeting_date).toLocaleString("zh-TW")}{m.location && ` · ${m.location}`}
                  </div>
                </div>
                <Badge variant="secondary" className="text-[11.5px]">{MEETING_STATUS_LABEL[m.status] ?? m.status}</Badge>
              </Link>
              {canEdit && (
                <Button size="sm" variant="ghost" onClick={() => unlink(m.id)} className="h-7 text-xs text-muted-foreground">取消關聯</Button>
              )}
            </div>
          ))}
        </div>
      )}
      {canEdit && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setLinkOpen(true)}><Plus className="w-3.5 h-3.5" /> 關聯會議</Button>
          <Button size="sm" variant="ghost" asChild>
            <Link to="/dashboard/eip/meetings">+ 新增會議</Link>
          </Button>
        </div>
      )}
      <Dialog open={linkOpen} onOpenChange={(o) => !o && setLinkOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>關聯會議</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-xs text-muted-foreground">選擇要關聯到本專案的會議</Label>
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger><SelectValue placeholder={candidatesQ.isLoading ? "載入中…" : "選擇會議"} /></SelectTrigger>
              <SelectContent>
                {candidates.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.title} · {new Date(m.meeting_date).toLocaleDateString("zh-TW")}
                  </SelectItem>
                ))}
                {candidates.length === 0 && !candidatesQ.isLoading && (
                  <div className="px-2 py-3 text-xs text-muted-foreground">沒有可關聯的會議，請先到「會議」建立</div>
                )}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLinkOpen(false)} disabled={busy}>取消</Button>
            <Button onClick={link} disabled={busy || !selectedId}>{busy ? "處理中…" : "關聯"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


function MembersSection({
  projectId, ownerId, userMap, canEdit,
}: { projectId: string; ownerId: string; userMap: Map<string, AppUser>; canEdit: boolean }) {
  const qc = useQueryClient();
  const activeUsersQ = useActiveUsers();
  const membersQ = useQuery({
    queryKey: ["eip", "project-members", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_member").select("project_id,user_id,role").eq("project_id", projectId);
      if (error) throw error;
      return (data ?? []) as { project_id: string; user_id: string; role: string | null }[];
    },
  });
  const members = membersQ.data ?? [];
  const memberIds = new Set(members.map((m) => m.user_id));
  const nameOf = (uid: string) =>
    userMap.get(uid)?.name ?? (activeUsersQ.data ?? []).find((u) => u.id === uid)?.name ?? "未知";
  const selectable = (activeUsersQ.data ?? []).filter((u) => u.id !== ownerId && !memberIds.has(u.id));
  const refetch = () => qc.invalidateQueries({ queryKey: ["eip", "project-members", projectId] });

  const addMember = async (uid: string) => {
    const { data, error } = await supabase.from("project_member")
      .insert({ project_id: projectId, user_id: uid, role: "member" }).select("user_id");
    if (error) { toast.error(humanizeError(error, "加入成員")); return; }
    if (!data?.length) { toast.error("加入失敗：沒有權限修改這個專案（僅專案負責人 / 專案成員 / 管理者）"); return; }
    toast.success("已加入成員"); refetch();
  };
  const removeMember = async (uid: string) => {
    const { data, error } = await supabase.from("project_member").delete()
      .eq("project_id", projectId).eq("user_id", uid).select("user_id");
    if (error) { toast.error(humanizeError(error, "移除成員")); return; }
    if (!data?.length) { toast.error("移除失敗：沒有權限修改這個專案（僅專案負責人 / 專案成員 / 管理者）"); return; }
    toast.success("已移除成員"); refetch();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-[11.5px] bg-amber-50 text-amber-700 border-amber-200">負責人</Badge>
        <span className="text-sm">{nameOf(ownerId)}</span>
      </div>
      {members.length === 0 ? (
        <div className="text-sm text-muted-foreground">尚未加入其他參與成員。</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {members.map((m) => (
            <span key={m.user_id} className="inline-flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-full border bg-muted/40">
              {nameOf(m.user_id)}
              {canEdit && (
                <button type="button" onClick={() => removeMember(m.user_id)} className="text-muted-foreground hover:text-destructive" aria-label="移除成員">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {canEdit && (
        <div className="flex items-center gap-2">
          <Select value="" onValueChange={(v) => { if (v) addMember(v); }}>
            <SelectTrigger className="h-9 w-56"><SelectValue placeholder="＋加入成員…" /></SelectTrigger>
            <SelectContent>
              {selectable.length === 0
                ? <div className="px-2 py-1.5 text-sm text-muted-foreground">沒有可加入的人員</div>
                : selectable.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-[12.5px] text-muted-foreground">加入的成員可檢視並編輯此專案。</span>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
