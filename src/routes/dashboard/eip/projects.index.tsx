import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Download, MoreHorizontal, Pencil, Trash2, ChevronRight, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { exportToExcel } from "@/lib/eip-export";
import { supabase } from "@/integrations/supabase/client";
import { useEipUser } from "@/lib/eip-user";
import { useActiveUsers, useAllUsers } from "@/hooks/useUsers";
import { DEFAULT_TENANT_ID } from "@/lib/eip-constants";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";
import { VisibilityScopeFields, VisibilityBadge, validateVisibility, type VisibilityScope } from "@/components/eip/VisibilityScope";
import { humanizeError } from "@/lib/eip-error";

export const Route = createFileRoute("/dashboard/eip/projects/")({ component: ProjectsPage });

type CanFn = (key: string, action?: "view" | "create" | "edit" | "delete" | "export") => boolean;

function canManageProject(p: Project, appUser: AppUser | null, can: CanFn): boolean {
  if (!appUser) return false;
  if (p.owner_id === appUser.id) return true;
  return can("eip_projects", "edit") || can("eip_projects", "delete");
}


type Project = Database["public"]["Tables"]["project"]["Row"];
type AppUser = Database["public"]["Tables"]["app_user"]["Row"];
type Task = Database["public"]["Tables"]["task"]["Row"];
type Milestone = Database["public"]["Tables"]["milestone"]["Row"];
type Kpi = Database["public"]["Tables"]["project_kpi"]["Row"];
type Risk = Database["public"]["Tables"]["project_risk"]["Row"];
type Department = Database["public"]["Tables"]["department"]["Row"];
type ProjectStatus = Database["public"]["Enums"]["project_status"];
type ProjectHealth = Database["public"]["Enums"]["project_health"];

const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: "規劃中", active: "進行中", on_hold: "暫停", done: "已完成",
};
const PROJECT_STATUS_COLOR: Record<ProjectStatus, string> = {
  planning: "bg-slate-100 text-slate-700",
  active: "bg-emerald-100 text-emerald-700",
  on_hold: "bg-amber-100 text-amber-700",
  done: "bg-blue-100 text-blue-700",
};
const HEALTH_LABEL: Record<ProjectHealth, string> = {
  on_track: "綠燈", at_risk: "黃燈", off_track: "紅燈",
};
const HEALTH_DOT: Record<ProjectHealth, string> = {
  on_track: "bg-emerald-500", at_risk: "bg-amber-500", off_track: "bg-red-500",
};

function ProjectsPage() {
  const qc = useQueryClient();
  const { appUser } = useEipUser();
  const { can } = useAuth();
  const canCreate = can("eip_projects", "create");
  const [openCreate, setOpenCreate] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [deleteProject, setDeleteProject] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const projectsQ = useQuery({
    queryKey: ["eip", "projects-full"],
    queryFn: async () => {
      const { data, error } = await supabase.from("project").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Project[];
    },
  });
  // 顯示對照用：含已停用者，保留離職同仁的歷史姓名
  const usersQ = useAllUsers();
  // 選人用：只在職（專案負責人建立／編輯）
  const activeUsersQ = useActiveUsers();
  const tasksQ = useQuery({
    queryKey: ["eip", "all-project-tasks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("task").select("id,project_id,status_id,progress").not("project_id", "is", null);
      if (error) throw error;
      return (data ?? []) as Pick<Task, "id" | "project_id" | "status_id" | "progress">[];
    },
  });
  const statusesQ = useQuery({
    queryKey: ["eip", "task-statuses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("task_status").select("id,is_done_state");
      if (error) throw error;
      return data ?? [];
    },
  });
  const milestonesQ = useQuery({
    queryKey: ["eip", "all-milestones"],
    queryFn: async () => {
      const { data, error } = await supabase.from("milestone").select("id,project_id,status");
      if (error) throw error;
      return (data ?? []) as Pick<Milestone, "id" | "project_id" | "status">[];
    },
  });
  const kpisQ = useQuery({
    queryKey: ["eip", "all-project-kpis"],
    queryFn: async () => {
      const { data, error } = await supabase.from("project_kpi").select("id,project_id,target_value,current_value");
      if (error) throw error;
      return (data ?? []) as Pick<Kpi, "id" | "project_id" | "target_value" | "current_value">[];
    },
  });
  const risksQ = useQuery({
    queryKey: ["eip", "all-project-risks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("project_risk").select("id,project_id,status");
      if (error) throw error;
      return (data ?? []) as Pick<Risk, "id" | "project_id" | "status">[];
    },
  });

  const deptsQ = useQuery({
    queryKey: ["eip", "departments-tree"],
    queryFn: async () => {
      const { data, error } = await supabase.from("department").select("id,name,parent_id,sort_order,tenant_id,created_at,updated_at,manager_id").order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Department[];
    },
  });

  const userMap = useMemo(() => new Map((usersQ.data ?? []).map((u) => [u.id, u])), [usersQ.data]);
  const deptMap = useMemo(() => new Map((deptsQ.data ?? []).map((d) => [d.id, d])), [deptsQ.data]);
  const doneStatusIds = useMemo(
    () => new Set((statusesQ.data ?? []).filter((s: any) => s.is_done_state).map((s: any) => s.id as string)),
    [statusesQ.data],
  );
  const progressByProject = useMemo(() => {
    const m = new Map<string, { done: number; total: number }>();
    for (const t of tasksQ.data ?? []) {
      if (!t.project_id) continue;
      const cur = m.get(t.project_id) ?? { done: 0, total: 0 };
      cur.total += 1;
      if (doneStatusIds.has(t.status_id) || (t.progress ?? 0) >= 100) cur.done += 1;
      m.set(t.project_id, cur);
    }
    return m;
  }, [tasksQ.data, doneStatusIds]);
  const milestonesByProject = useMemo(() => {
    const m = new Map<string, { done: number; total: number }>();
    for (const ms of milestonesQ.data ?? []) {
      const cur = m.get(ms.project_id) ?? { done: 0, total: 0 };
      cur.total += 1;
      if (ms.status === "done") cur.done += 1;
      m.set(ms.project_id, cur);
    }
    return m;
  }, [milestonesQ.data]);
  const kpiAvgByProject = useMemo(() => {
    const m = new Map<string, { sum: number; count: number }>();
    for (const k of kpisQ.data ?? []) {
      const t = parseFloat(k.target_value ?? "");
      const c = parseFloat(k.current_value ?? "");
      if (!isFinite(t) || !isFinite(c) || t === 0) continue;
      const pct = Math.max(0, Math.min(200, (c / t) * 100));
      const cur = m.get(k.project_id) ?? { sum: 0, count: 0 };
      cur.sum += pct;
      cur.count += 1;
      m.set(k.project_id, cur);
    }
    return m;
  }, [kpisQ.data]);
  const openRisksByProject = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of risksQ.data ?? []) {
      if (r.status === "closed" || r.status === "mitigated") continue;
      m.set(r.project_id, (m.get(r.project_id) ?? 0) + 1);
    }
    return m;
  }, [risksQ.data]);

  if (projectsQ.isLoading) return <div className="text-muted-foreground py-8">載入中…</div>;

  const projects = projectsQ.data ?? [];

  return (
    <div>
      <PageHeader title="專案"
        description="管理跨部門專案、里程碑與成員,並關聯任務與會議。"
        actions={
          <div className="flex items-center gap-2">
            <ExportProjectsBtn projects={projects} userMap={userMap} />
            {canCreate && appUser && (
              <Button onClick={() => setOpenCreate(true)}><Plus className="w-4 h-4" />新增專案</Button>
            )}
          </div>
        }
      />

      {projects.length === 0 ? (
        <div className="rounded-lg border bg-card py-12 text-center space-y-3">
          <div className="text-sm text-muted-foreground">目前沒有專案,點「新增專案」建立第一個專案。</div>
          {canCreate && (
            <Button size="sm" onClick={() => setOpenCreate(true)}>
              <Plus className="w-4 h-4" /> 新增專案
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
          <ul className="divide-y">
            {projects.map((p) => (
              <ProjectRow
                key={p.id}
                project={p}
                expanded={expanded.has(p.id)}
                onToggle={() => toggleExpand(p.id)}
                appUser={appUser}
                userMap={userMap}
                deptMap={deptMap}
                taskStat={progressByProject.get(p.id)}
                milestoneStat={milestonesByProject.get(p.id)}
                kpiStat={kpiAvgByProject.get(p.id)}
                openRisks={openRisksByProject.get(p.id) ?? 0}
                onEdit={() => setEditProject(p)}
                onDelete={() => setDeleteProject(p)}
              />
            ))}
          </ul>
        </div>
      )}

      {openCreate && appUser && (
        <CreateProjectDialog
          open={openCreate} onClose={() => setOpenCreate(false)} appUser={appUser} users={activeUsersQ.data ?? []}
          departments={deptsQ.data ?? []}
          onCreated={() => qc.invalidateQueries({ queryKey: ["eip", "projects-full"] })}
        />
      )}
      {editProject && appUser && (
        <EditProjectDialog
          project={editProject} users={activeUsersQ.data ?? []} departments={deptsQ.data ?? []}
          onClose={() => setEditProject(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["eip", "projects-full"] }); setEditProject(null); }}
        />
      )}
      <AlertDialog open={!!deleteProject} onOpenChange={(o) => !o && !deleting && setDeleteProject(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定刪除專案?</AlertDialogTitle>
            <AlertDialogDescription>
              即將刪除「{deleteProject?.name}」,相關里程碑/成員紀錄可能一併移除。刪除後無法復原。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault();
                if (!deleteProject) return;
                setDeleting(true);
                const { data, error } = await supabase
                  .from("project").delete().eq("id", deleteProject.id).select("id");
                setDeleting(false);
                if (error) { toast.error(humanizeError(error, "刪除")); return; }
                // 被 RLS 擋掉時回 0 列而 error 是 null；原本一律跳「專案已刪除」。
                if (!data?.length) { toast.error("刪除失敗：沒有權限修改這個專案（僅專案負責人 / 專案成員 / 管理者）"); return; }
                toast.success("專案已刪除");
                setDeleteProject(null);
                qc.invalidateQueries({ queryKey: ["eip", "projects-full"] });
              }}
            >
              {deleting ? "刪除中…" : "確認刪除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ProjectRow({
  project: p, expanded, onToggle, appUser, userMap, deptMap,
  taskStat, milestoneStat, kpiStat, openRisks,
  onEdit, onDelete,
}: {
  project: Project;
  expanded: boolean;
  onToggle: () => void;
  appUser: AppUser | null;
  userMap: Map<string, AppUser>;
  deptMap: Map<string, Department>;
  taskStat?: { done: number; total: number };
  milestoneStat?: { done: number; total: number };
  kpiStat?: { sum: number; count: number };
  openRisks: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canManage = canManageProject(p, appUser, can);

  const owner = userMap.get(p.owner_id);
  const pct = taskStat && taskStat.total ? Math.round((taskStat.done / taskStat.total) * 100) : 0;
  const kpiAvg = kpiStat && kpiStat.count ? Math.round(kpiStat.sum / kpiStat.count) : null;
  const daysLeft = (() => {
    if (!p.end_date) return null;
    const d = new Date(p.end_date + "T00:00:00");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - today.getTime()) / 86400000);
  })();

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
        className="group flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors"
      >
        <ChevronRight className={cn("w-4 h-4 text-muted-foreground shrink-0 transition-transform", expanded && "rotate-90")} />
        <div className="font-medium truncate min-w-0 flex-[2]">{p.name}</div>
        <Badge className={cn("text-[11.5px] shrink-0", PROJECT_STATUS_COLOR[p.status])} variant="secondary">
          {PROJECT_STATUS_LABEL[p.status]}
        </Badge>
        <VisibilityBadge scope={p.visibility_scope} departmentId={p.department_id} deptMap={deptMap} className="shrink-0" />
        <span className="hidden sm:flex items-center gap-1 text-[12.5px] text-muted-foreground shrink-0">
          <span className={cn("inline-block w-2 h-2 rounded-full", HEALTH_DOT[p.health])} />
          {HEALTH_LABEL[p.health]}
        </span>
        <div className="hidden md:flex items-center gap-2 flex-[2] min-w-0">
          <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[12.5px] text-muted-foreground tabular-nums w-9 text-right">{pct}%</span>
        </div>
        <span className="sm:hidden text-[12.5px] text-muted-foreground tabular-nums shrink-0">{pct}%</span>
        <span className="hidden lg:inline text-xs text-muted-foreground truncate w-28 text-right">
          {owner?.name ?? "—"}
        </span>
        <span className="hidden lg:inline text-xs text-muted-foreground tabular-nums w-24 text-right">
          {p.end_date ?? "—"}
        </span>
        {canManage ? (
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
                  aria-label="更多操作"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onEdit(); }}>
                  <Pencil className="w-3.5 h-3.5 mr-2" /> 編輯
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={(e) => { e.preventDefault(); onDelete(); }}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-2" /> 刪除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <div className="w-7" />
        )}
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-1 bg-muted/30 border-t">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="md:col-span-2 space-y-2">
              <div>
                <div className="text-[12.5px] text-muted-foreground mb-0.5">目標</div>
                <div className="text-sm line-clamp-3 whitespace-pre-wrap">{p.goal || "—"}</div>
              </div>
              <div>
                <div className="text-[12.5px] text-muted-foreground mb-0.5">範疇</div>
                <div className="text-sm line-clamp-3 whitespace-pre-wrap">{p.scope || "—"}</div>
              </div>
            </div>
            <div className="space-y-1.5 text-xs">
              <Metric label="任務完成率" value={taskStat?.total ? `${pct}%` : "—"} sub={taskStat?.total ? `${taskStat.done}/${taskStat.total}` : undefined} />
              <Metric label="里程碑達成" value={milestoneStat?.total ? `${milestoneStat.done}/${milestoneStat.total}` : "—"} />
              <Metric label="KPI 平均達成" value={kpiAvg != null ? `${kpiAvg}%` : "—"} />
              <Metric label="未結風險" value={String(openRisks)} />
              <Metric label="距結束" value={daysLeft == null ? "—" : daysLeft >= 0 ? `${daysLeft} 天` : `已逾期 ${Math.abs(daysLeft)} 天`} />
              <Metric label="負責人" value={owner?.name ?? "—"} />
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                navigate({ to: "/dashboard/eip/projects/$id", params: { id: p.id } });
              }}
            >
              進入專案詳情 <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">
        {value}{sub && <span className="text-muted-foreground font-normal ml-1">({sub})</span>}
      </span>
    </div>
  );
}

function EditProjectDialog({
  project, users, departments, onClose, onSaved,
}: { project: Project; users: AppUser[]; departments: Department[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(project.name);
  const [goal, setGoal] = useState(project.goal ?? "");
  const [scope, setScope] = useState(project.scope ?? "");
  const [description, setDescription] = useState(project.description ?? "");
  const [ownerId, setOwnerId] = useState(project.owner_id);
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [health, setHealth] = useState<ProjectHealth>(project.health);
  const [startDate, setStartDate] = useState(project.start_date ?? "");
  const [endDate, setEndDate] = useState(project.end_date ?? "");
  const [vScope, setVScope] = useState<VisibilityScope>(
    (project.visibility_scope as VisibilityScope) ?? (project.department_id ? "department" : "company"),
  );
  const [deptId, setDeptId] = useState<string | null>(project.department_id ?? null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return toast.error("請輸入專案名稱");
    const v = validateVisibility(vScope, deptId);
    if (!v.ok) return toast.error(v.error);
    setBusy(true);
    const { data, error } = await supabase.from("project").update({
      name: name.trim(),
      goal: goal.trim() || null,
      scope: scope.trim() || null,
      description: description.trim() || null,
      owner_id: ownerId,
      status,
      health,
      start_date: startDate || null,
      end_date: endDate || null,
      visibility_scope: v.payload.visibility_scope,
      department_id: v.payload.department_id,
    }).eq("id", project.id).select("id");
    setBusy(false);
    if (error) { toast.error(humanizeError(error, "儲存")); return; }
    if (!data?.length) { toast.error("儲存失敗：沒有權限修改這個專案（僅專案負責人 / 專案成員 / 管理者）"); return; }
    toast.success("已儲存"); onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>編輯專案</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <Field label="名稱"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="目標"><Input value={goal} onChange={(e) => setGoal(e.target.value)} /></Field>
          <Field label="範疇"><Textarea rows={2} value={scope} onChange={(e) => setScope(e.target.value)} placeholder="專案範疇,含括與排除項目" /></Field>
          <Field label="描述"><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="負責人">
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="狀態">
              <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) =>
                    <SelectItem key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="健康度">
              <Select value={health} onValueChange={(v) => setHealth(v as ProjectHealth)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(HEALTH_LABEL) as ProjectHealth[]).map((h) =>
                    <SelectItem key={h} value={h}>{HEALTH_LABEL[h]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <div />
            <Field label="開始日"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
            <Field label="結束日"><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
          </div>
          <VisibilityScopeFields
            scope={vScope} onScopeChange={setVScope}
            deptId={deptId} onDeptIdChange={setDeptId}
            departments={departments}
            allowMembers
          />
          {vScope === "members" && (
            <p className="text-[12.5px] text-muted-foreground">參與成員請於專案詳情頁的「專案成員」區塊管理。</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "儲存中…" : "儲存"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function CreateProjectDialog({
  open, onClose, appUser, users, departments, onCreated,
}: { open: boolean; onClose: () => void; appUser: AppUser; users: AppUser[]; departments: Department[]; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [scope, setScope] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState(appUser.id);
  const [status, setStatus] = useState<ProjectStatus>("planning");
  const [health, setHealth] = useState<ProjectHealth>("on_track");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [vScope, setVScope] = useState<VisibilityScope>(appUser.department_id ? "department" : "company");
  const [deptId, setDeptId] = useState<string | null>(appUser.department_id ?? null);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return toast.error("請輸入專案名稱");
    const v = validateVisibility(vScope, deptId);
    if (!v.ok) return toast.error(v.error);
    setBusy(true);
    try {
      const { data: created, error } = await supabase.from("project").insert({
        tenant_id: appUser.tenant_id ?? DEFAULT_TENANT_ID,
        name: name.trim(),
        goal: goal.trim() || null,
        scope: scope.trim() || null,
        description: description.trim() || null,
        owner_id: ownerId,
        status,
        health,
        start_date: startDate || null,
        end_date: endDate || null,
        visibility_scope: v.payload.visibility_scope,
        department_id: v.payload.department_id,
      }).select("id").single();
      if (error) throw error;
      // 私密專案：把挑選的參與成員寫入 project_member（負責人本身自動有權限，不需重複加入）
      if (created && memberIds.length > 0) {
        const rows = memberIds
          .filter((uid) => uid !== ownerId)
          .map((uid) => ({ project_id: created.id, user_id: uid, role: "member" }));
        if (rows.length > 0) {
          const { error: mErr } = await supabase.from("project_member").insert(rows);
          if (mErr) throw mErr;
        }
      }
      toast.success("專案已建立");
      onCreated(); onClose();
    } catch (e) { toast.error(humanizeError(e, "建立")); }
    finally { setBusy(false); }
  };


  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>新增專案</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <Field label="名稱"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="目標"><Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="一句話描述專案目標" /></Field>
          <Field label="範疇"><Textarea rows={2} value={scope} onChange={(e) => setScope(e.target.value)} placeholder="專案範疇,含括與排除項目" /></Field>
          <Field label="描述"><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="負責人">
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="狀態">
              <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) =>
                    <SelectItem key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="健康度">
              <Select value={health} onValueChange={(v) => setHealth(v as ProjectHealth)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(HEALTH_LABEL) as ProjectHealth[]).map((h) =>
                    <SelectItem key={h} value={h}>{HEALTH_LABEL[h]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <div />
            <Field label="開始日"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
            <Field label="結束日"><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
          </div>
          <VisibilityScopeFields
            scope={vScope} onScopeChange={setVScope}
            deptId={deptId} onDeptIdChange={setDeptId}
            departments={departments}
            allowMembers
          />
          {vScope === "members" && (
            <MemberMultiSelect users={users} ownerId={ownerId} value={memberIds} onChange={setMemberIds} />
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={submit} disabled={busy}>建立</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function MemberMultiSelect({
  users, ownerId, value, onChange,
}: { users: AppUser[]; ownerId: string; value: string[]; onChange: (v: string[]) => void }) {
  const selectable = users.filter((u) => u.id !== ownerId && !value.includes(u.id));
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? "未知";
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">專案成員（可檢視並編輯此專案）</Label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border p-2 min-h-9">
        <span className="text-[12.5px] text-muted-foreground">負責人：{nameOf(ownerId)}</span>
        {value.map((uid) => (
          <span key={uid} className="inline-flex items-center gap-1 text-[12.5px] px-2 py-0.5 rounded-full border bg-accent/30">
            {nameOf(uid)}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== uid))} className="text-muted-foreground hover:text-destructive" aria-label="移除">×</button>
          </span>
        ))}
        <select
          value=""
          onChange={(e) => { if (e.target.value) onChange([...value, e.target.value]); }}
          className="h-7 rounded-md border bg-card px-1 text-[12.5px]"
        >
          <option value="">＋加入成員…</option>
          {selectable.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>
      <div className="text-[12.5px] text-muted-foreground">只有負責人與這些成員看得到並可編輯此專案。</div>
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

function ExportProjectsBtn({ projects, userMap }: { projects: Project[]; userMap: Map<string, AppUser> }) {
  const { can } = useAuth();
  if (!can("eip_projects", "export")) return null;
  return (
    <Button variant="outline" onClick={() => exportToExcel({
      filename: "EIP專案", sheetName: "專案", rows: projects,
      columns: [
        { header: "名稱", key: "name" },
        { header: "狀態", key: "status", map: (r) => PROJECT_STATUS_LABEL[r.status] ?? r.status },
        { header: "負責人", key: "owner_id", map: (r) => r.owner_id ? userMap.get(r.owner_id)?.name ?? "" : "" },
        { header: "開始", key: "start_date", map: (r) => r.start_date ?? "" },
        { header: "結束", key: "end_date", map: (r) => r.end_date ?? "" },
        { header: "描述", key: "description", map: (r) => r.description ?? "" },
        { header: "建立時間", key: "created_at", map: (r) => new Date(r.created_at).toLocaleString("zh-TW") },
      ],
    })}>
      <Download className="w-4 h-4" /> 匯出 Excel
    </Button>
  );
}
