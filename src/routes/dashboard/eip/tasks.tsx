import { createFileRoute, Link } from "@tanstack/react-router";
import { RequirePerm } from "@/components/RequirePerm";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, GripVertical, Download, Paperclip, ListChecks, Link2, Repeat, SlidersHorizontal, MoreHorizontal, Pencil, Trash2, UserMinus, UserPen } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader } from "@/components/ui/sheet";

import { supabase } from "@/integrations/supabase/client";
// eip_handover_item 尚未進 types.ts，僅該查詢改用 any 版 client
import { supabase as supabaseAny } from "@/lib/supabase";
import { useEipUser } from "@/lib/eip-user";
import { useActiveUsers, useAllUsers } from "@/hooks/useUsers";
import { useAuth } from "@/lib/auth";
import { DEFAULT_TENANT_ID, PRIORITY_COLOR, PRIORITY_LABEL } from "@/lib/eip-constants";
import { exportToExcel } from "@/lib/eip-export";
// 建立對話框的「相關連結」跟 UrlLinks 元件共用同一份格式判定，不要各寫一套
import { validateExternalUrl } from "@/lib/eip-url";
import { PageHeader } from "@/components/layout/PageHeader";
import { MultiSelect } from "@/components/eip/MultiSelect";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Database } from "@/integrations/supabase/types";
import { RecurringReportDialog } from "@/components/eip/RecurringReportDialog";
import { TaskChecklist } from "@/components/eip/TaskChecklist";
import { EntityLinks } from "@/components/eip/EntityLinks";
import { UrlLinks } from "@/components/eip/UrlLinks";
import { TaskSourceBadge, useTaskSources, type TaskSource } from "@/components/eip/TaskSourceBadge";
import { VisibilityScopeFields, VisibilityBadge, validateVisibility, type VisibilityScope } from "@/components/eip/VisibilityScope";
import { humanizeError } from "@/lib/eip-error";

/**
 * 保留這個函式名以縮小 diff，但內容改成轉呼叫集中的 humanizeError。
 * 舊版是 `message / details / hint / code` 直接串起來丟給使用者看 —— 那正是老闆
 * 抱怨的那種畫面。判斷邏輯只留一份在 src/lib/eip-error.ts，這裡不要再長出第二套。
 */
function formatErr(e: unknown): string {
  return humanizeError(e);
}

type CanFn = (key: string, action?: "view" | "create" | "edit" | "delete" | "export") => boolean;

/**
 * 誰能編輯這筆任務。**逐字對應**後端 task_update_policy：
 * company_admin ／（dept_manager 且管轄該部門）／ owner_id ／ created_by ／
 * eip_is_task_collaborator()。
 *
 * export 出去給「我的工作」(my-tasks.tsx) 共用 —— 原本那頁自己寫
 * `readOnly={task.owner_id !== me}`，只認負責人，於是同一筆任務同一個人
 * 在任務看板可編、在「我的工作」是唯讀（協作者與建立者都被誤鎖）。
 * 判斷只留這一份，不要在別頁再長出第二套。
 */
export function canEditTask(task: Task, appUser: AppUser | null, can: CanFn, collabMap?: Map<string, Set<string>>): boolean {
  if (!appUser) return false;
  if (task.owner_id === appUser.id) return true;
  if (task.created_by === appUser.id) return true;
  if (collabMap?.get(task.id)?.has(appUser.id)) return true;
  if (!can("eip_tasks", "edit")) return false;
  // dept_manager 僅限本部門（後端 RLS 亦擋，此為 UI 一致性）
  if (appUser.role === "dept_manager") {
    return !!task.department_id && task.department_id === appUser.department_id;
  }
  return true;
}
/**
 * 協作者名單能不能寫入。**逐字對應**後端 task_collaborator 的 INSERT/DELETE 政策
 * `eip_can_manage_task()`：company_admin ／ owner_id ／ created_by ／
 * （dept_manager 且管轄該任務的部門）。
 *
 * 刻意不共用 canEditTask()：那支還認「協作者本人」與「被授予 eip_tasks:edit 的任何角色」，
 * 而 eip_can_manage_task() 不認這兩種。拿 canEditTask 當協作者 picker 的旗標，
 * 等於把可互動的 picker 開給寫入 100% 會被擋掉的人
 *（INSERT 42501、DELETE 回 0 列），而且按下去之前沒有任何提示。
 */
function canManageCollaborators(task: Task, appUser: AppUser | null): boolean {
  if (!appUser) return false;
  if (appUser.role === "company_admin") return true;
  if (task.owner_id === appUser.id) return true;
  if (task.created_by === appUser.id) return true;
  if (appUser.role === "dept_manager") {
    return !!task.department_id && task.department_id === appUser.department_id;
  }
  return false;
}
function canDeleteTask(task: Task, appUser: AppUser | null, can: CanFn, collabMap?: Map<string, Set<string>>): boolean {
  if (!appUser) return false;
  if (task.owner_id === appUser.id) return true;
  if (task.created_by === appUser.id) return true;
  if (collabMap?.get(task.id)?.has(appUser.id)) return true;
  if (!can("eip_tasks", "delete")) return false;
  if (appUser.role === "dept_manager") {
    return !!task.department_id && task.department_id === appUser.department_id;
  }
  return true;
}



// 2026-08-17 依客戶要求隱藏「獨立網址／NAS 連結」欄；網址請直接貼在說明／執行內容欄。
// 既有連結資料保留於資料庫不刪，要恢復顯示只需把下方旗標改為 true。
const SHOW_URL_LINK_FIELD = false;

// 2026-08-25 依客戶要求隱藏任務看板的「行事曆」分頁：首頁儀表板已經有全公司行事曆，
// 同一份資料兩個入口只會讓人不確定該看哪一個。CalendarView 程式碼刻意保留，
// 要恢復只需把旗標改回 true（分頁與說明文字都跟著這個旗標）。
const SHOW_CALENDAR_TAB = false;

export const Route = createFileRoute("/dashboard/eip/tasks")({
  component: () => (
    <RequirePerm module="eip_tasks">
      <TasksPage />
    </RequirePerm>
  ),
  validateSearch: (s: Record<string, unknown>): { openTask?: string } => ({
    openTask: typeof s.openTask === "string" ? s.openTask : undefined,
  }),
});

// closing_summary 是 0117 新增的欄位，types.ts 還沒重新產生，先在這裡補上型別。
// types.ts 重生成時把這個 & 拿掉即可。
type Task = Database["public"]["Tables"]["task"]["Row"] & { closing_summary?: string | null };
type Status = Database["public"]["Tables"]["task_status"]["Row"];
type TaskType = Database["public"]["Tables"]["task_type"]["Row"];
type AppUser = Database["public"]["Tables"]["app_user"]["Row"];
type Department = Database["public"]["Tables"]["department"]["Row"];
type Project = Database["public"]["Tables"]["project"]["Row"];
type Priority = Database["public"]["Enums"]["task_priority"];

const ALL_PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];

// moveMutation 用的哨兵：把「PostgREST 回 0 列」跟真正的連線／SQL 錯誤分開報。
// 訊息不會直接顯示給使用者（onError 會換成看得懂的說明），只是用來辨識來源。
const MOVE_BLOCKED = "__move_blocked_0_rows__";

function TasksPage() {
  const qc = useQueryClient();
  const { appUser } = useEipUser();
  const { can } = useAuth();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const canCreate = can("eip_tasks", "create");
  const canExport = can("eip_tasks", "export");

  // 共用篩選 state
  // 部門改複選（2026-08-25 客戶要求）；空陣列＝全部部門
  const [filterDepts, setFilterDepts] = useState<string[]>([]);
  // 協作者篩選（複選）：任一被選到的人是協作者就算符合
  const [filterCollabs, setFilterCollabs] = useState<string[]>([]);
  const [filterProject, setFilterProject] = useState("all");
  const [filterOwner, setFilterOwner] = useState("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState("all");
  // 只顯示因人員停用而待重新指派的任務（來源：eip_handover_item）
  const [onlyReassign, setOnlyReassign] = useState(false);
  // 只顯示我建立的（含指派給別人的），解決「建立者找不到自己建的任務」
  const [onlyMine, setOnlyMine] = useState(false);
  // 已完成任務的載入範圍（天）。null = 全部，效能考量預設 30 天。
  const [doneWindowDays, setDoneWindowDays] = useState<number | null>(30);
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [deleteTask, setDeleteTask] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState(false);

  const statusesQ = useQuery({
    queryKey: ["eip", "task_status"],
    queryFn: async () => {
      const { data, error } = await supabase.from("task_status").select("*").order("sort_order");
      if (error) throw error;
      return data as Status[];
    },
  });

  // 效能：已完成的任務會無限累積，看板預設只載「未完成全部 + 近 N 天已完成」。
  // 未完成的量是穩定的，會爆的只有已完成。要看更早的用「完成範圍」切換。
  // （已軟刪除的資料由 RLS 在資料庫層擋掉，前端不需再過濾）
  const tasksQ = useQuery({
    queryKey: ["eip", "tasks-full", doneWindowDays],
    queryFn: async () => {
      const cols =
        "id,tenant_id,title,description,type_id,project_id,parent_task_id,department_id,owner_id,priority,status_id,progress,due_date,created_by,completed_at,created_at,updated_at,board_position,start_date,recurring_rule_id,occurrence_date,visibility_scope";
      if (doneWindowDays === null) {
        const { data, error } = await supabase
          .from("task").select(cols)
          .order("board_position", { ascending: true })
          .order("created_at", { ascending: false });
        if (error) throw error;
        return data as Task[];
      }
      const since = new Date(Date.now() - doneWindowDays * 864e5).toISOString();
      const { data, error } = await supabase
        .from("task").select(cols)
        .or(`completed_at.is.null,completed_at.gte.${since}`)
        .order("board_position", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Task[];
    },
  });

  // 卡片上的「3/5」改讀 task_checklist_summary。
  // 原本是數 task.parent_task_id 的子任務，但那條路早就被 filter 掉、正式庫 0 筆；
  // 子項現在一律走 task_checklist 新表（見 docs/批3-批6_後端變更紀錄.md）。
  const subtasksQ = useQuery({
    queryKey: ["eip", "tasks-subcount"],
    queryFn: async () => {
      const { data, error } = await supabaseAny
        .from("task_checklist_summary")
        .select("task_id,total,done");
      if (error) throw error;
      return (data ?? []) as { task_id: string; total: number; done: number }[];
    },
  });

  const collabQ = useQuery({
    queryKey: ["eip", "task_collaborators-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("task_collaborator").select("task_id,user_id");
      if (error) throw error;
      return (data ?? []) as { task_id: string; user_id: string }[];
    },
  });



  // 顯示對照用：含已停用者，否則離職同仁的歷史任務會看不到負責人姓名
  const usersQ = useAllUsers();
  // 選人用：只在職，避免誤指派給已離職同仁
  const activeUsersQ = useActiveUsers();

  // 待重新指派的任務 id（RLS 已限定可見範圍，前端不再過濾）
  const reassignQ = useQuery({
    queryKey: ["eip", "handover", "pending-task-ids"],
    queryFn: async () => {
      const { data, error } = await supabaseAny
        .from("eip_handover_item")
        .select("entity_id")
        .eq("status", "pending")
        .in("entity_type", ["task", "task_collaborator"]);
      if (error) throw error;
      return new Set(((data ?? []) as { entity_id: string }[]).map((x) => x.entity_id));
    },
  });

  const deptsQ = useQuery({
    queryKey: ["eip", "departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("department").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Department[];
    },
  });

  const projectsQ = useQuery({
    queryKey: ["eip", "projects"],
    queryFn: async () => {
      const { data, error } = await supabase.from("project").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Project[];
    },
  });

  const typesQ = useQuery({
    queryKey: ["eip", "task_types"],
    queryFn: async () => {
      const { data, error } = await supabase.from("task_type").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as TaskType[];
    },
  });

  const userMap = useMemo(() => new Map((usersQ.data ?? []).map((u) => [u.id, u])), [usersQ.data]);
  const statusMap = useMemo(() => new Map((statusesQ.data ?? []).map((s) => [s.id, s])), [statusesQ.data]);
  const projectMap = useMemo(() => new Map((projectsQ.data ?? []).map((p) => [p.id, p])), [projectsQ.data]);
  const deptMap = useMemo(() => new Map((deptsQ.data ?? []).map((d) => [d.id, d])), [deptsQ.data]);
  const collabMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    (collabQ.data ?? []).forEach((r) => {
      const s = m.get(r.task_id) ?? new Set<string>();
      s.add(r.user_id);
      m.set(r.task_id, s);
    });
    return m;
  }, [collabQ.data]);



  const subtaskMap = useMemo(() => {
    const m = new Map<string, { total: number; done: number }>();
    (subtasksQ.data ?? []).forEach((s) => {
      m.set(s.task_id, { total: Number(s.total ?? 0), done: Number(s.done ?? 0) });
    });
    return m;
  }, [subtasksQ.data]);

  const filteredTasks = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return (tasksQ.data ?? []).filter((t) => {
      if (t.parent_task_id) return false; // 不在主清單顯示子任務
      if (filterDepts.length && !(t.department_id && filterDepts.includes(t.department_id))) return false;
      if (filterCollabs.length) {
        // 協作者名單是另一張表撈回來的（collabMap: task_id → user_id 集合）
        const set = collabMap.get(t.id);
        if (!set || !filterCollabs.some((uid) => set.has(uid))) return false;
      }
      if (filterProject !== "all" && t.project_id !== filterProject) return false;
      if (filterOwner !== "all" && t.owner_id !== filterOwner) return false;
      if (filterPriority !== "all" && t.priority !== filterPriority) return false;
      if (filterStatus !== "all" && t.status_id !== filterStatus) return false;
      if (onlyReassign && !reassignQ.data?.has(t.id)) return false;
      if (onlyMine && t.created_by !== appUser?.id) return false;
      if (dueFrom && (!t.due_date || t.due_date < dueFrom)) return false;
      if (dueTo && (!t.due_date || t.due_date > dueTo)) return false;
      if (kw) {
        const hay = `${t.title} ${t.description ?? ""}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [tasksQ.data, filterDepts, filterCollabs, collabMap, filterProject, filterOwner, filterPriority, filterStatus, dueFrom, dueTo, keyword, onlyReassign, reassignQ.data, onlyMine, appUser?.id]);

  const sourceMap = useTaskSources(filteredTasks);

  // 從 URL openTask=<id> 自動開啟對應任務詳情/編輯。
  // 看板預設只載「未完成 + 近 30 天完成」，所以清單裡找不到是常態
  // （從交接待辦、相關連結、LINE 推播點進來的舊任務都落在視窗外）。
  // 找不到就用 id 單筆補查一次，真的沒有才報錯 —— 原本是靜默 return，
  // 使用者按了「前往處理」畫面完全沒反應。
  useEffect(() => {
    const id = search.openTask;
    if (!id) return;
    if (tasksQ.isLoading) return;
    let alive = true;
    const clear = () => void navigate({ search: { openTask: undefined }, replace: true });
    const t = (tasksQ.data ?? []).find((x) => x.id === id);
    if (t) {
      setDetailTask(t);
      clear();
      return;
    }
    void (async () => {
      const { data, error } = await supabase.from("task").select("*").eq("id", id).maybeSingle();
      if (!alive) return;
      if (error) toast.error(humanizeError(error, "開啟任務"));
      else if (data) setDetailTask(data as Task);
      else toast.error("找不到該任務，或你沒有檢視權限");
      clear();
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.openTask, tasksQ.data, tasksQ.isLoading]);

  const moveMutation = useMutation({
    mutationFn: async (vars: { taskId: string; toStatusId: string; newPosition: number }) => {
      if (!appUser) throw new Error("尚未取得 EIP 身分");
      const status = (statusesQ.data ?? []).find((s) => s.id === vars.toStatusId);
      const patch: Database["public"]["Tables"]["task"]["Update"] = {
        status_id: vars.toStatusId,
        board_position: vars.newPosition,
      };
      if (status?.is_done_state) {
        patch.progress = 100;
        patch.completed_at = new Date().toISOString();
      } else {
        patch.completed_at = null;
      }
      // UPDATE 被 RLS 擋掉時 PostgREST 回 0 列而且 error 是 null，看起來像成功：
      // 卡片停在原欄、沒有任何訊息，使用者只會一直重拖。一定要 .select("id") 看筆數，
      // 0 列就 throw 出去讓 onError 統一提示並把看板拉回伺服器狀態。
      const { data: moved, error } = await supabase
        .from("task").update(patch).eq("id", vars.taskId).select("id");
      if (error) throw error;
      if (!moved?.length) throw new Error(MOVE_BLOCKED);
      // 狀態已經改成功了，歷程寫不進去不該讓整個動作看起來失敗，
      // 但也不能完全不講 —— 否則「執行歷程」缺一筆而且沒人知道。
      const { error: le } = await supabase.from("task_update").insert({
        task_id: vars.taskId,
        tenant_id: appUser.tenant_id,
        user_id: appUser.id,
        status_changed_to_id: vars.toStatusId,
        progress: status?.is_done_state ? 100 : null,
        comment: null,
      });
      if (le) toast.warning("狀態已更新，但執行歷程未寫入");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["eip", "tasks-full"] }),
    onError: (e) => {
      // 失敗時也要 invalidate：看板是直接畫 tasks-full 的資料，重新載入才會把卡片
      // 放回它在伺服器上真正的欄位與位置（有樂觀更新時這一步就是回滾）。
      void qc.invalidateQueries({ queryKey: ["eip", "tasks-full"] });
      if (e instanceof Error && e.message === MOVE_BLOCKED) {
        toast.error("移動失敗：你沒有變更這筆任務的權限，或這筆任務已被他人變更／刪除。卡片已回到原本的位置。");
        return;
      }
      toast.error(humanizeError(e, "更新"));
    },
  });

  const handleExport = () => {
    exportToExcel({
      filename: "EIP任務",
      sheetName: "任務",
      rows: filteredTasks,
      columns: [
        { header: "標題", key: "title" },
        { header: "狀態", key: "status_id", map: (r) => statusMap.get(r.status_id)?.name ?? "" },
        { header: "優先級", key: "priority", map: (r) => PRIORITY_LABEL[r.priority] ?? r.priority },
        { header: "進度(%)", key: "progress" },
        { header: "負責人", key: "owner_id", map: (r) => userMap.get(r.owner_id)?.name ?? "" },
        { header: "建立者", key: "created_by", map: (r) => userMap.get(r.created_by)?.name ?? "" },
        { header: "協作者", key: "id", map: (r) => Array.from(collabMap.get(r.id) ?? []).map((uid) => userMap.get(uid)?.name).filter(Boolean).join("、") },
        { header: "部門", key: "department_id", map: (r) => (r.department_id ? deptMap.get(r.department_id)?.name ?? "" : "") },
        { header: "專案", key: "project_id", map: (r) => (r.project_id ? projectMap.get(r.project_id)?.name ?? "" : "") },
        { header: "期限", key: "due_date", map: (r) => r.due_date ?? "" },
        { header: "建立時間", key: "created_at", map: (r) => new Date(r.created_at).toLocaleString("zh-TW") },
        { header: "描述", key: "description", map: (r) => r.description ?? "" },
      ],
    });
  };

  const anyLoadError = [statusesQ, tasksQ, subtasksQ, collabQ, usersQ, activeUsersQ, deptsQ, projectsQ, typesQ].some((q) => q && (q as any).isError);
  if (anyLoadError) {
    return (
      <div className="py-16 text-center space-y-3">
        <p className="text-sm text-muted-foreground">載入任務資料時發生錯誤，請稍後再試。</p>
        <button
          onClick={() => { statusesQ.refetch(); tasksQ.refetch(); subtasksQ.refetch(); collabQ.refetch(); usersQ.refetch(); activeUsersQ.refetch(); deptsQ.refetch(); projectsQ.refetch(); typesQ.refetch(); }}
          className="px-4 py-2 rounded-md border text-sm hover:bg-accent"
        >
          重新載入
        </button>
      </div>
    );
  }
  if (statusesQ.isLoading || tasksQ.isLoading) {
    return <div className="text-muted-foreground py-8">載入中…</div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="任務看板"
        description={
          SHOW_CALENDAR_TAB
            ? "全公司任務看板。支援看板 / 列表 / 行事曆三種視圖,所有篩選共用。"
            : "全公司任務看板。支援看板 / 列表兩種視圖,所有篩選共用；行事曆請看首頁。"
        }
        actions={
          <div className="flex items-center gap-2">
            {canExport && (
              <Button variant="outline" onClick={handleExport}>
                <Download className="w-4 h-4" /> 匯出 Excel
              </Button>
            )}
            {canCreate && appUser && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="w-4 h-4" /> 建立任務
              </Button>
            )}
          </div>
        }
      />

      <SharedFilters
        keyword={keyword} setKeyword={setKeyword}
        filterDepts={filterDepts} setFilterDepts={setFilterDepts}
        filterCollabs={filterCollabs} setFilterCollabs={setFilterCollabs}
        filterProject={filterProject} setFilterProject={setFilterProject}
        filterOwner={filterOwner} setFilterOwner={setFilterOwner}
        filterPriority={filterPriority} setFilterPriority={setFilterPriority}
        filterStatus={filterStatus} setFilterStatus={setFilterStatus}
        dueFrom={dueFrom} setDueFrom={setDueFrom}
        dueTo={dueTo} setDueTo={setDueTo}
        statuses={statusesQ.data ?? []}
        users={activeUsersQ.data ?? []}
        departments={deptsQ.data ?? []}
        projects={projectsQ.data ?? []}
        onlyReassign={onlyReassign} setOnlyReassign={setOnlyReassign}
        reassignCount={reassignQ.data?.size ?? 0}
        onlyMine={onlyMine} setOnlyMine={setOnlyMine}
        doneWindowDays={doneWindowDays} setDoneWindowDays={setDoneWindowDays}
      />

      <Tabs defaultValue="board">
        <TabsList>
          <TabsTrigger value="board">看板</TabsTrigger>
          <TabsTrigger value="list">列表</TabsTrigger>
          {SHOW_CALENDAR_TAB && <TabsTrigger value="calendar">行事曆</TabsTrigger>}
        </TabsList>

        <TabsContent value="board" className="mt-3">
          <BoardView
            tasks={filteredTasks}
            statuses={statusesQ.data ?? []}
            userMap={userMap}
            subtaskMap={subtaskMap}
            sourceMap={sourceMap}
            deptMap={deptMap}
            collabMap={collabMap}
            appUser={appUser}
            can={can}


            onMove={(taskId, toStatusId, newPosition) =>
              moveMutation.mutate({ taskId, toStatusId, newPosition })
            }
            onOpenDetail={(t) => setDetailTask(t)}
            onAskDelete={(t) => setDeleteTask(t)}
          />
        </TabsContent>

        <TabsContent value="list" className="mt-3">
          <ListView
            tasks={filteredTasks}
            statusMap={statusMap}
            userMap={userMap}
            projectMap={projectMap}
            sourceMap={sourceMap}
            deptMap={deptMap}
            subtaskMap={subtaskMap}
            statuses={statusesQ.data ?? []}
            users={activeUsersQ.data ?? []}
            appUser={appUser}
            canManage={can("eip_tasks", "edit") || can("eip_tasks", "delete")}
            onChanged={() => qc.invalidateQueries({ queryKey: ["eip", "tasks-full"] })}
            onOpenDetail={(t) => setDetailTask(t)}
          />
        </TabsContent>

        {SHOW_CALENDAR_TAB && (
          <TabsContent value="calendar" className="mt-3">
            <CalendarView tasks={filteredTasks} statusMap={statusMap} userMap={userMap} />
          </TabsContent>
        )}
      </Tabs>

      {createOpen && appUser && (
        <CreateTaskDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          appUser={appUser}
          statuses={statusesQ.data ?? []}
          users={activeUsersQ.data ?? []}
          departments={deptsQ.data ?? []}
          projects={projectsQ.data ?? []}
          types={typesQ.data ?? []}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ["eip", "tasks-full"] });
            // 建立時就能填協作者與子項，這兩份快取不刷的話卡片上的
            // 協作者標記與「3/5」會停在舊值
            void qc.invalidateQueries({ queryKey: ["eip", "task_collaborators-all"] });
            void qc.invalidateQueries({ queryKey: ["eip", "tasks-subcount"] });
          }}
        />
      )}

      {detailTask && (
        <EditTaskDialog
          key={detailTask.id}
          task={detailTask}
          readOnly={!canEditTask(detailTask, appUser, can, collabMap)}
          onClose={() => setDetailTask(null)}
          statuses={statusesQ.data ?? []}
          users={activeUsersQ.data ?? []}
          departments={deptsQ.data ?? []}
          projects={projectsQ.data ?? []}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["eip", "tasks-full"] });
            setDetailTask(null);
          }}
          onChecklistChange={() => {
            void qc.invalidateQueries({ queryKey: ["eip", "tasks-subcount"] });
          }}
        />
      )}

      <AlertDialog open={!!deleteTask} onOpenChange={(o) => !o && !deleting && setDeleteTask(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定刪除任務？</AlertDialogTitle>
            <AlertDialogDescription>
              即將刪除「{deleteTask?.title}」。刪除後無法復原。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault();
                if (!deleteTask) return;
                setDeleting(true);
                // 走 eip_soft_delete RPC，跟 ListView.bulkDelete 一致。
                // 不能用 .delete()：task 上的軟刪除 guard 是 BEFORE DELETE ... RETURN NULL，
                // ROW_COUNT 一律 0，所以「列數檢查」在這張表上不能用（會把成功報成失敗），
                // 而只看 error 又會把被 RLS 擋掉的情況報成成功。只有 RPC 會回明確結果。
                const { data, error } = await supabaseAny.rpc("eip_soft_delete", {
                  p_module: "eip_tasks",
                  p_id: deleteTask.id,
                });
                setDeleting(false);
                if (error) {
                  // purge_guard 之類的拒絕理由帶了協作者／變更紀錄／進度回報的筆數，
                  // 是後端刻意寫給使用者看的中文（SQLSTATE P0001）。humanizeError 對
                  // P0001 會原樣透出、連前綴都不加，所以這裡照樣是原訊息。
                  toast.error(humanizeError(error, "刪除"));
                  return;
                }
                if ((data as { ok?: boolean } | null)?.ok !== true) {
                  // 呼叫成功但後端明確拒絕（ok 不為 true）＝權限不足，不是連線問題
                  toast.error("刪除失敗：僅本人 / 本部門主管 / 管理者可刪除這筆任務");
                  return;
                }
                toast.success("任務已刪除");
                setDeleteTask(null);
                void qc.invalidateQueries({ queryKey: ["eip", "tasks-full"] });
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

/* ============ 共用篩選 ============ */
function SharedFilters(props: {
  keyword: string; setKeyword: (v: string) => void;
  filterDepts: string[]; setFilterDepts: (v: string[]) => void;
  filterCollabs: string[]; setFilterCollabs: (v: string[]) => void;
  filterProject: string; setFilterProject: (v: string) => void;
  filterOwner: string; setFilterOwner: (v: string) => void;
  filterPriority: string; setFilterPriority: (v: string) => void;
  filterStatus: string; setFilterStatus: (v: string) => void;
  dueFrom: string; setDueFrom: (v: string) => void;
  dueTo: string; setDueTo: (v: string) => void;
  statuses: Status[]; users: AppUser[]; departments: Department[]; projects: Project[];
  onlyReassign: boolean; setOnlyReassign: (v: boolean) => void; reassignCount: number;
  onlyMine: boolean; setOnlyMine: (v: boolean) => void;
  doneWindowDays: number | null; setDoneWindowDays: (v: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeCount = [
    props.filterStatus !== "all",
    props.filterPriority !== "all",
    props.filterDepts.length > 0,
    props.filterCollabs.length > 0,
    props.filterProject !== "all",
    props.filterOwner !== "all",
    !!props.dueFrom,
    !!props.dueTo,
    props.onlyReassign,
    props.onlyMine,
  ].filter(Boolean).length;

  const mineToggle = (
    <Button
      type="button"
      variant={props.onlyMine ? "default" : "outline"}
      className="h-9 justify-start"
      onClick={() => props.setOnlyMine(!props.onlyMine)}
      title="只顯示我建立的任務，包含指派給別人的"
    >
      <UserPen className="w-4 h-4 mr-1.5" />
      我建立的
    </Button>
  );

  // 已完成任務的載入範圍。預設 30 天，避免看板隨時間無限膨脹。
  const doneWindowSelect = (
    <MiniSelect
      value={props.doneWindowDays === null ? "all" : String(props.doneWindowDays)}
      onChange={(v) => props.setDoneWindowDays(v === "all" ? null : Number(v))}
      options={[
        { value: "30", label: "完成：近 30 天" },
        { value: "90", label: "完成：近 90 天" },
        { value: "365", label: "完成：近一年" },
        { value: "all", label: "完成：全部（較慢）" },
      ]}
    />
  );

  // 沒有任何待重新指派的任務時就不顯示這個切換，避免佔位
  const reassignToggle = props.reassignCount > 0 || props.onlyReassign ? (
    <Button
      type="button"
      variant={props.onlyReassign ? "default" : "outline"}
      className="h-9 justify-start"
      onClick={() => props.setOnlyReassign(!props.onlyReassign)}
      title="只顯示因人員停用而需要重新指派負責人的任務"
    >
      <UserMinus className="w-4 h-4 mr-1.5" />
      待重新指派
      {props.reassignCount > 0 && (
        <Badge variant="secondary" className="ml-1.5">{props.reassignCount}</Badge>
      )}
    </Button>
  ) : null;

  const filterFields = (
    <div className="grid gap-3">
      <MiniSelect value={props.filterStatus} onChange={props.setFilterStatus}
        options={[{ value: "all", label: "全部狀態" }, ...props.statuses.map((s) => ({ value: s.id, label: s.name }))]} />
      <MiniSelect value={props.filterPriority} onChange={props.setFilterPriority}
        options={[{ value: "all", label: "全部優先級" }, ...ALL_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))]} />
      <MultiSelect values={props.filterDepts} onChange={props.setFilterDepts} allLabel="全部部門" itemLabel="部門"
        options={props.departments.map((d) => ({ value: d.id, label: d.name }))} contentClassName="w-64" />
      <MiniSelect value={props.filterProject} onChange={props.setFilterProject}
        options={[{ value: "all", label: "全部專案" }, ...props.projects.map((p) => ({ value: p.id, label: p.name }))]} />
      <MiniSelect value={props.filterOwner} onChange={props.setFilterOwner}
        options={[{ value: "all", label: "全部負責人" }, ...props.users.map((u) => ({ value: u.id, label: u.name }))]} />
      <MultiSelect values={props.filterCollabs} onChange={props.setFilterCollabs} allLabel="全部協作者" itemLabel="協作者"
        options={props.users.map((u) => ({ value: u.id, label: u.name }))} contentClassName="w-64" />
      <div className="grid gap-1">
        <Input type="date" value={props.dueFrom} onChange={(e) => props.setDueFrom(e.target.value)} className="h-9 w-full" />
        <span className="text-xs text-muted-foreground text-center">至</span>
        <Input type="date" value={props.dueTo} onChange={(e) => props.setDueTo(e.target.value)} className="h-9 w-full" />
      </div>
      {doneWindowSelect}
      {mineToggle}
      {reassignToggle}
    </div>
  );

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        {/* < lg：搜尋 + 篩選按鈕(Sheet) */}
        <div className="flex gap-2 lg:hidden">
          <Input placeholder="搜尋標題 / 描述" value={props.keyword}
            onChange={(e) => props.setKeyword(e.target.value)} className="flex-1 min-w-0" />
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" className="shrink-0">
                <SlidersHorizontal className="w-4 h-4" />
                篩選{activeCount > 0 && <Badge variant="secondary" className="ml-1">{activeCount}</Badge>}
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[90vw] sm:w-[400px] overflow-y-auto">
              <SheetHeader><SheetTitle>篩選條件</SheetTitle></SheetHeader>
              <div className="mt-4">{filterFields}</div>
              <div className="mt-4 flex justify-end">
                <Button onClick={() => setOpen(false)}>完成</Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {/* ≥ lg：grid 完整展開 */}
        <div className="hidden lg:grid gap-3 lg:grid-cols-3 xl:grid-cols-5">
          <Input placeholder="搜尋標題 / 描述" value={props.keyword}
            onChange={(e) => props.setKeyword(e.target.value)} className="w-full" />
          <MiniSelect value={props.filterStatus} onChange={props.setFilterStatus}
            options={[{ value: "all", label: "全部狀態" }, ...props.statuses.map((s) => ({ value: s.id, label: s.name }))]} />
          <MiniSelect value={props.filterPriority} onChange={props.setFilterPriority}
            options={[{ value: "all", label: "全部優先級" }, ...ALL_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))]} />
          <MultiSelect values={props.filterDepts} onChange={props.setFilterDepts} allLabel="全部部門" itemLabel="部門"
            options={props.departments.map((d) => ({ value: d.id, label: d.name }))} contentClassName="w-64" />
          <MiniSelect value={props.filterProject} onChange={props.setFilterProject}
            options={[{ value: "all", label: "全部專案" }, ...props.projects.map((p) => ({ value: p.id, label: p.name }))]} />
          <MiniSelect value={props.filterOwner} onChange={props.setFilterOwner}
            options={[{ value: "all", label: "全部負責人" }, ...props.users.map((u) => ({ value: u.id, label: u.name }))]} />
          <MultiSelect values={props.filterCollabs} onChange={props.setFilterCollabs} allLabel="全部協作者" itemLabel="協作者"
            options={props.users.map((u) => ({ value: u.id, label: u.name }))} contentClassName="w-64" />
          <div className="flex items-center gap-1 xl:col-span-2 min-w-0">
            <Input type="date" value={props.dueFrom} onChange={(e) => props.setDueFrom(e.target.value)} className="h-9 w-full" />
            <span className="text-xs text-muted-foreground shrink-0">至</span>
            <Input type="date" value={props.dueTo} onChange={(e) => props.setDueTo(e.target.value)} className="h-9 w-full" />
          </div>
          {doneWindowSelect}
          {mineToggle}
          {reassignToggle}
        </div>
      </CardContent>
    </Card>
  );
}


function MiniSelect({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/* ============ 看板視圖 ============ */
function BoardView({
  tasks, statuses, userMap, subtaskMap, sourceMap, deptMap, collabMap, appUser, can, onMove, onOpenDetail, onAskDelete,

}: {
  tasks: Task[]; statuses: Status[];
  userMap: Map<string, AppUser>;
  subtaskMap: Map<string, { total: number; done: number }>;
  sourceMap: Map<string, TaskSource>;
  deptMap: Map<string, Department>;
  collabMap: Map<string, Set<string>>;
  appUser: AppUser | null;
  can: CanFn;

  onMove: (taskId: string, toStatusId: string, newPosition: number) => void;
  onOpenDetail: (t: Task) => void;
  onAskDelete: (t: Task) => void;
}) {

  const [dragId, setDragId] = useState<string | null>(null);
  // 完成欄預設收合。日常工作不需要看到一整個月完成的東西，
  // 收合後不渲染卡片，欄位再長也不影響畫面與效能。
  const [expandedDone, setExpandedDone] = useState<Set<string>>(new Set());
  const toggleDone = (id: string) =>
    setExpandedDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // 看板每欄的排序方式。預設「智慧」＝急件優先＋期限近的在上，一眼看到最該處理的。
  // 想手動微調就切「手動」（拖曳）；一拖曳也會自動切回手動，讓拖的結果立刻生效。
  const [boardSort, setBoardSort] = useState<"smart" | "due" | "priority" | "created" | "manual">("smart");

  // urgent 最高、low 最低（ALL_PRIORITIES = low<normal<high<urgent）
  const prioRank = (p: Priority) => ALL_PRIORITIES.indexOf(p);
  const DUE_MAX = "9999-12-31"; // 無期限排最後

  const boardCmp = (a: Task, b: Task) => {
    switch (boardSort) {
      case "manual":
        return a.board_position - b.board_position;
      case "due": {
        const av = a.due_date ?? DUE_MAX, bv = b.due_date ?? DUE_MAX;
        return av !== bv ? (av < bv ? -1 : 1) : a.board_position - b.board_position;
      }
      case "priority": {
        const d = prioRank(b.priority) - prioRank(a.priority);
        if (d !== 0) return d;
        const av = a.due_date ?? DUE_MAX, bv = b.due_date ?? DUE_MAX;
        return av < bv ? -1 : av > bv ? 1 : 0;
      }
      case "created":
        return (b.created_at ?? "").localeCompare(a.created_at ?? ""); // 新的在上
      case "smart":
      default: {
        const d = prioRank(b.priority) - prioRank(a.priority);
        if (d !== 0) return d;
        const av = a.due_date ?? DUE_MAX, bv = b.due_date ?? DUE_MAX;
        if (av !== bv) return av < bv ? -1 : 1;
        return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      }
    }
  };

  const colTasks = (statusId: string) =>
    tasks.filter((t) => t.status_id === statusId).slice().sort(boardCmp);

  const handleColumnDrop = (statusId: string, beforeId?: string) => {
    if (!dragId) return;
    const list = colTasks(statusId).filter((t) => t.id !== dragId);
    const idx = beforeId ? list.findIndex((t) => t.id === beforeId) : list.length;
    const prev = idx > 0 ? list[idx - 1].board_position : 0;
    const next = idx < list.length ? list[idx].board_position : prev + 2;
    const newPos = (prev + next) / 2;
    onMove(dragId, statusId, newPos);
    setDragId(null);
  };

  const countBadgeTone = (idx: number, isDone: boolean) => {
    if (isDone) return "bg-[hsl(var(--muted-foreground))] text-background";
    if (idx === 0) return "bg-primary text-primary-foreground";
    if (idx === 1) return "bg-accent text-accent-foreground";
    return "bg-[hsl(var(--muted-foreground))] text-background";
  };

  const SORT_LABEL: Record<typeof boardSort, string> = {
    smart: "智慧（急件＋期限）", due: "期限近的在上", priority: "優先級高的在上",
    created: "最新建立在上", manual: "手動拖曳",
  };

  return (
    <>
    <div className="flex items-center justify-end gap-2 pb-3">
      {boardSort !== "manual" && (
        <span className="text-[11.5px] text-muted-foreground/70 shrink-0">想手動調整順序？切成「手動拖曳」即可拖動卡片</span>
      )}
      <span className="text-xs text-muted-foreground shrink-0">每欄排序</span>
      <div className="w-[190px]">
        <MiniSelect
          value={boardSort}
          onChange={(v) => setBoardSort(v as typeof boardSort)}
          options={(Object.keys(SORT_LABEL) as (typeof boardSort)[]).map((k) => ({ value: k, label: SORT_LABEL[k] }))} />
      </div>
    </div>
    <div className="grid gap-6 overflow-x-auto pb-2"
      style={{ gridTemplateColumns: `repeat(${statuses.length}, minmax(280px, 1fr))` }}>
      {statuses.map((s, idx) => {
        const list = colTasks(s.id);
        const collapsed = !!s.is_done_state && !expandedDone.has(s.id) && list.length > 0;
        return (
          <div key={s.id}
            className="flex flex-col gap-5 min-h-[440px]"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleColumnDrop(s.id); }}>
            <div className="flex items-end justify-between px-1 pb-2 border-b-2 border-primary/10">
              <h2 className="text-xl font-semibold text-primary flex items-center gap-3 font-[family-name:Outfit,ui-sans-serif]">
                {s.name}
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-md tracking-tight tabular-nums ${countBadgeTone(idx, !!s.is_done_state)}`}>
                  {String(list.length).padStart(2, "0")}
                </span>
              </h2>
              {!!s.is_done_state && list.length > 0 && (
                <button type="button" onClick={() => toggleDone(s.id)}
                  className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline shrink-0 pb-1">
                  {collapsed ? "展開" : "收合"}
                </button>
              )}
            </div>
            <div className="space-y-4 max-h-[calc(100vh-320px)] overflow-y-auto pr-1 -mr-1">
              {collapsed && (
                <button type="button" onClick={() => toggleDone(s.id)}
                  className="w-full rounded-xl border border-dashed py-6 text-sm text-muted-foreground hover:bg-muted/40 transition-colors">
                  已完成 {list.length} 件・點此展開
                </button>
              )}
              {!collapsed && list.map((t) => (
                <div key={t.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleColumnDrop(s.id, t.id); }}>
                  <TaskCard task={t} owner={userMap.get(t.owner_id)}
                    creator={userMap.get(t.created_by)}
                    subtask={subtaskMap.get(t.id)}
                    source={sourceMap.get(t.id)}
                    deptMap={deptMap}
                    statuses={statuses}
                    canEdit={canEditTask(t, appUser, can, collabMap)}
                    canDelete={canDeleteTask(t, appUser, can, collabMap)}

                    canDrag={boardSort === "manual"}
                    onDragStart={() => setDragId(t.id)}
                    onOpenDetail={() => onOpenDetail(t)}
                    onAskDelete={() => onAskDelete(t)}
                    onChangeStatus={(sid) => {
                      const list = tasks.filter((x) => x.status_id === sid).sort((a, b) => a.board_position - b.board_position);
                      const last = list.length ? list[list.length - 1].board_position : 0;
                      onMove(t.id, sid, last + 1);
                    }} />

                </div>
              ))}
              {list.length === 0 && (
                <div className="text-xs text-muted-foreground px-2 py-10 text-center border border-dashed border-primary/15 rounded-2xl bg-card/40">
                  無任務
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
    </>
  );
}

function TaskCard({ task, owner, creator, subtask, source, deptMap, statuses, canEdit, canDelete, canDrag, onDragStart, onOpenDetail, onAskDelete, onChangeStatus }: {
  task: Task; owner?: AppUser; creator?: AppUser;
  subtask?: { total: number; done: number };
  source?: TaskSource;
  deptMap: Map<string, Department>;
  statuses: Status[];
  canEdit: boolean; canDelete: boolean;
  canDrag: boolean;
  onDragStart: () => void;
  onOpenDetail: () => void;
  onAskDelete: () => void;
  onChangeStatus: (statusId: string) => void;
}) {
  const [reportOpen, setReportOpen] = useState(false);
  const overdue = task.due_date &&
    new Date(task.due_date) < new Date(new Date().toDateString()) && task.progress < 100;
  const initial = owner?.name ? owner.name.slice(0, 1) : "?";
  const showMenu = canEdit || canDelete;
  const isDone = statuses.find((s) => s.id === task.status_id)?.is_done_state;
  const currentStatus = statuses.find((s) => s.id === task.status_id);
  const currentStatusIdx = statuses.findIndex((s) => s.id === task.status_id);

  // left priority accent bar
  const accentBar =
    task.priority === "urgent" ? "bg-destructive"
    : task.priority === "high" ? "bg-accent"
    : null;

  // status select tone by column position
  const statusTone =
    isDone ? "bg-[hsl(var(--muted-foreground))] text-background hover:opacity-90"
    : currentStatusIdx === 0 ? "bg-primary text-primary-foreground hover:opacity-90"
    : currentStatusIdx === 1 ? "bg-accent text-accent-foreground hover:opacity-90"
    : "bg-[hsl(var(--muted-foreground))] text-background hover:opacity-90";

  const fmtDate = (d: string) => new Date(d).toLocaleDateString("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit",
  }).replaceAll("/", " / ");
  const fmtShort = (d: string) => new Date(d).toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" });

  return (
    <Card
      draggable={canDrag}
      onDragStart={onDragStart}
      onClick={onOpenDetail}
      className={`group relative cursor-pointer rounded-xl border-border/70 bg-card overflow-hidden shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${task.progress >= 100 ? "opacity-70" : ""}`}
    >
      {accentBar && <div className={`absolute top-0 left-0 w-1 h-full ${accentBar}`} />}
      <CardContent className="p-3 space-y-2">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            {canDrag && (
              <GripVertical
                className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0 cursor-grab active:cursor-grabbing group-hover:text-accent transition-colors"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              />
            )}
            <Badge className={`text-[11px] rounded px-1.5 py-0 border-none ${PRIORITY_COLOR[task.priority]}`} variant="secondary">
              {PRIORITY_LABEL[task.priority]}
            </Badge>
            {source && <TaskSourceBadge source={source} />}
            {task.recurring_rule_id && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0">
                <Repeat className="w-2.5 h-2.5" /> 週期
              </span>
            )}
          </div>
          {showMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-primary hover:bg-muted transition-colors shrink-0"
                  aria-label="更多操作"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                {canEdit && (
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onOpenDetail(); }}>
                    <Pencil className="w-3.5 h-3.5 mr-2" /> 編輯
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={(e) => { e.stopPropagation(); onAskDelete(); }}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-2" /> 刪除
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Title */}
        <h3 className="text-sm font-semibold text-primary leading-snug font-[family-name:Outfit,ui-sans-serif] line-clamp-2">
          {task.title}
        </h3>

        {/* 精簡底列：截止日期 · 子任務 · 負責人 */}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <span className={`text-xs font-medium tabular-nums shrink-0 ${overdue ? "text-destructive" : "text-muted-foreground"}`}>
            {task.due_date ? fmtShort(task.due_date) : "無期限"}{overdue && " · 逾期"}
          </span>
          <div className="flex items-center gap-1.5 min-w-0">
            {subtask && subtask.total > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground shrink-0">
                <ListChecks className="w-3 h-3" /> {subtask.done}/{subtask.total}
              </span>
            )}
            {isDone && <Badge variant="secondary" className="text-[10px] rounded px-1.5 py-0">已完成</Badge>}
            <div className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold flex items-center justify-center shrink-0 border border-border">
              {initial}
            </div>
            <span className="text-xs font-medium text-primary truncate max-w-[84px]">{owner?.name ?? "未指派"}</span>
          </div>
        </div>

        {/* Progress */}
        {task.progress > 0 && task.progress < 100 && (
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${task.progress}%` }} />
          </div>
        )}
        {task.recurring_rule_id && task.progress < 100 && (
          <Button size="sm" variant="outline" className="w-full h-8 text-xs rounded-md"
            onClick={(e) => { e.stopPropagation(); setReportOpen(true); }}>
            週期回報
          </Button>
        )}
      </CardContent>
      {reportOpen && task.recurring_rule_id && (
        <RecurringReportDialog
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          taskId={task.id}
          recurringRuleId={task.recurring_rule_id}
          initialData={task.report_data as Record<string, unknown> | null}
        />
      )}
    </Card>
  );
}

/* ============ 列表視圖 ============ */
type SortKey = "title" | "owner" | "status" | "priority" | "progress" | "due" | "project";

/**
 * 列表視圖的「子項」欄。
 * 這裡刻意只顯示 n/m 與一條細進度條，不換算成百分比 ——
 * 訪談定案第 2 條：勾選＝今天有做，例行不談百分比；
 * 子項也是同一個語意（「不會說一項工作寫一大堆就完成 98%」）。
 */
function SubtaskCell({ sub }: { sub?: { total: number; done: number } }) {
  if (!sub || sub.total === 0) {
    return <div className="text-right pr-1 text-muted-foreground/50 text-xs">—</div>;
  }
  const pct = Math.round((sub.done / sub.total) * 100);
  const allDone = sub.done >= sub.total;
  return (
    <div className="text-right pr-1" title={`子項 ${sub.done}/${sub.total}`}>
      <div className={`tabular-nums text-xs ${allDone ? "text-muted-foreground" : "font-medium"}`}>
        {sub.done}/{sub.total}
      </div>
      <div className="h-1 mt-0.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full ${allDone ? "bg-muted-foreground" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ListView({
  tasks, statusMap, userMap, projectMap, sourceMap, deptMap, subtaskMap, statuses, users, appUser, canManage, onChanged, onOpenDetail,
}: {
  tasks: Task[];
  statusMap: Map<string, Status>; userMap: Map<string, AppUser>; projectMap: Map<string, Project>;
  sourceMap: Map<string, TaskSource>;
  deptMap: Map<string, Department>;
  subtaskMap: Map<string, { total: number; done: number }>;
  statuses: Status[]; users: AppUser[];
  appUser: AppUser | null; canManage: boolean;
  onChanged: () => void;
  onOpenDetail: (t: Task) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("due");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkOwner, setBulkOwner] = useState("");
  const [bulkDue, setBulkDue] = useState("");
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const sorted = useMemo(() => {
    const list = [...tasks];
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      const getVal = (t: Task): string | number => {
        switch (sortKey) {
          case "title": return t.title;
          case "owner": return userMap.get(t.owner_id)?.name ?? "";
          case "status": return statusMap.get(t.status_id)?.sort_order ?? 0;
          case "priority": return ALL_PRIORITIES.indexOf(t.priority);
          case "progress": return t.progress;
          case "due": return t.due_date ?? "9999-12-31";
          case "project": return t.project_id ? projectMap.get(t.project_id)?.name ?? "" : "";
        }
      };
      const va = getVal(a), vb = getVal(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return list;
  }, [tasks, sortKey, sortDir, userMap, statusMap, projectMap]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = sorted.slice((page - 1) * pageSize, page * pageSize);

  // 篩選/排序後清單改變時回到第 1 頁
  useEffect(() => { setPage(1); }, [sorted.length, pageSize]);

  // 勾選必須跟著篩選收斂：否則勾了 20 筆之後換部門篩選，工具列仍寫「已選 20 筆」，
  // 按下批次刪除會刪掉畫面上根本看不到的任務（確認框只顯示筆數）。
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const alive = new Set(tasks.map((t) => t.id));
      const next = new Set(Array.from(prev).filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [tasks]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };

  const allChecked = paged.length > 0 && paged.every((t) => selected.has(t.id));
  const toggleAll = () => {
    const s = new Set(selected);
    if (allChecked) paged.forEach((t) => s.delete(t.id));
    else paged.forEach((t) => s.add(t.id));
    setSelected(s);
  };

  const applyBulk = async () => {
    if (!selected.size) return toast.error("請先勾選任務");
    if (bulkBusy) return;
    const patch: Database["public"]["Tables"]["task"]["Update"] = {};
    if (bulkStatus) patch.status_id = bulkStatus;
    if (bulkOwner) patch.owner_id = bulkOwner;
    if (bulkDue) patch.due_date = bulkDue;
    if (!Object.keys(patch).length) return toast.error("請選擇要套用的欄位");
    // 批次改成「完成」類狀態時，必須跟單筆儲存與拖曳一致地補上 progress / completed_at，
    // 否則卡片仍顯示逾期與 0%、永遠不會被「完成：近 30 天」視窗收掉，
    // 績效儀表板的「期間完成」也算不到這些任務。
    if (bulkStatus) {
      if (statusMap.get(bulkStatus)?.is_done_state) {
        patch.progress = 100;
        patch.completed_at = new Date().toISOString();
      } else {
        patch.completed_at = null;
      }
    }
    const ids = Array.from(selected);
    setBulkBusy(true);
    const { data, error } = await supabase.from("task").update(patch).in("id", ids).select("id");
    setBulkBusy(false);
    if (error) return toast.error(humanizeError(error, "批次更新"));
    const n = data?.length ?? 0;
    // 全部被 RLS 擋掉時 data 是空陣列而不是 error —— 這時候報成功會讓人以為是畫面沒刷新
    if (n === 0) return toast.error("沒有任何任務被更新（可能是權限不足）");
    if (n < ids.length) toast.warning(`已更新 ${n} 筆；${ids.length - n} 筆因權限未更新`);
    else toast.success(`已更新 ${n} 筆`);
    setSelected(new Set()); setBulkStatus(""); setBulkOwner(""); setBulkDue("");
    onChanged();
  };

  const bulkDelete = async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setBulkDeleting(true);
    // 軟刪除 guard 是 BEFORE DELETE ... RETURN NULL，所以 DELETE 的 ROW_COUNT 一律是 0，
    // 原本的 .delete().select("id") 會拿到空陣列 → 明明刪掉了卻報「沒有可刪除的任務」。
    // 改走 eip_soft_delete RPC，它會明確回 { ok, deleted_at }（稽核 M9）。
    const results = await Promise.all(
      ids.map(async (id) => {
        const { data, error } = await supabaseAny.rpc("eip_soft_delete", {
          p_module: "eip_tasks",
          p_id: id,
        });
        // 「呼叫失敗」跟「後端明確拒絕」要分開報：前者是連線/函式問題，
        // 全部歸類成「權限不足」會讓使用者跟 IT 都往錯的方向查。
        if (error) return "failed" as const;
        return (data as { ok?: boolean } | null)?.ok === true ? ("ok" as const) : ("denied" as const);
      }),
    );
    setBulkDeleting(false);
    const deleted = results.filter((r) => r === "ok").length;
    const denied = results.filter((r) => r === "denied").length;
    const failed = results.filter((r) => r === "failed").length;
    if (deleted === 0 && failed > 0) {
      toast.error(`刪除失敗 ${failed} 筆（連線或伺服器錯誤，請重試）`);
    } else if (deleted === 0) {
      toast.error("沒有可刪除的任務（僅本人 / 本部門主管 / 管理者可刪）");
    } else if (denied > 0 || failed > 0) {
      toast.warning(
        `已刪除 ${deleted} 筆` +
          (denied > 0 ? `；${denied} 筆因權限未刪（非本人/本部門）` : "") +
          (failed > 0 ? `；${failed} 筆呼叫失敗，請重試` : ""),
      );
    } else {
      toast.success(`已刪除 ${deleted} 筆任務`);
    }
    setSelected(new Set());
    setBulkDeleteOpen(false);
    onChanged();
  };

  const canBulk = canManage;

  // 多一欄「子項」（規格書 E 章：列表視圖再加「子項 n/m ＋進度條」）
  const cols = canBulk
    ? "32px minmax(0,1fr) 96px 88px 84px 64px 72px 112px 132px"
    : "minmax(0,1fr) 96px 88px 84px 64px 72px 112px 132px";
  const arrow = (kk: SortKey) => (sortKey === kk ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : "");
  const Hd = ({ label, kk }: { label: string; kk: SortKey }) => (
    <button type="button" onClick={() => toggleSort(kk)} className="flex items-center hover:text-foreground truncate">
      {label}<span className="text-[11.5px]">{arrow(kk)}</span>
    </button>
  );
  const cbCls = "size-[18px] rounded-[6px] border-muted-foreground/30 shadow-none data-[state=checked]:bg-primary data-[state=checked]:border-primary transition-colors";

  return (
    <div className="space-y-4">
      {canBulk && selected.size > 0 && (
        <Card>
          <CardContent className="p-4 flex flex-wrap items-center gap-2.5">
            <span className="text-sm font-medium">已選 {selected.size} 筆</span>
            <Select value={bulkStatus} onValueChange={setBulkStatus}>
              <SelectTrigger className="h-9 w-36"><SelectValue placeholder="改狀態" /></SelectTrigger>
              <SelectContent>
                {statuses.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={bulkOwner} onValueChange={setBulkOwner}>
              <SelectTrigger className="h-9 w-40"><SelectValue placeholder="改負責人" /></SelectTrigger>
              <SelectContent>
                {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" value={bulkDue} onChange={(e) => setBulkDue(e.target.value)} className="h-9 w-40" placeholder="改期限" />
            <Button size="sm" onClick={applyBulk} disabled={bulkBusy}>
              {bulkBusy ? "套用中…" : "套用"}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setBulkDeleteOpen(true)}
              disabled={bulkDeleting}
            >
              {bulkDeleting ? "刪除中…" : "批次刪除"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>清除</Button>
          </CardContent>
        </Card>
      )}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={(o) => !bulkDeleting && setBulkDeleteOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定刪除選取的 {selected.size} 筆任務？</AlertDialogTitle>
            <AlertDialogDescription>
              任務會移入回收區（不會立刻永久刪除），子項、協作者與狀態紀錄一併保留。
              只有本人、本部門主管或管理者刪得掉，其餘會被跳過並回報筆數。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); bulkDelete(); }}
              disabled={bulkDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDeleting ? "刪除中…" : "確認刪除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <div style={{ minWidth: 860 }}>
            <div className="grid items-center gap-3 px-5 h-12 border-b bg-muted/50 text-xs font-semibold tracking-wide text-muted-foreground" style={{ gridTemplateColumns: cols }}>
              {canBulk && <Checkbox className={cbCls} checked={allChecked} onCheckedChange={toggleAll} />}
              <Hd label="標題" kk="title" />
              <Hd label="負責人" kk="owner" />
              <Hd label="狀態" kk="status" />
              <Hd label="優先級" kk="priority" />
              <Hd label="進度" kk="progress" />
              <div className="text-right pr-1" title="子項完成數（勾選＝今天有做，不是百分比）">子項</div>
              <Hd label="期限" kk="due" />
              <Hd label="專案" kk="project" />
            </div>
            {paged.map((t) => {
              const overdue = t.due_date && new Date(t.due_date) < new Date(new Date().toDateString()) && t.progress < 100;
              return (
                <div
                  key={t.id}
                  onClick={() => onOpenDetail(t)}
                  className={`grid items-center gap-3 px-5 min-h-[56px] py-2.5 border-b border-border/70 last:border-b-0 cursor-pointer transition-colors text-sm ${selected.has(t.id) ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-accent/40"} ${overdue ? "text-destructive" : ""}`}
                  style={{ gridTemplateColumns: cols }}
                >
                  {canBulk && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        className={cbCls}
                        checked={selected.has(t.id)}
                        onCheckedChange={(v) => {
                          const s = new Set(selected);
                          if (v) s.add(t.id); else s.delete(t.id);
                          setSelected(s);
                        }}
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate font-medium">{t.title}</span>
                    {sourceMap.get(t.id) && <TaskSourceBadge source={sourceMap.get(t.id)!} />}
                    <VisibilityBadge scope={t.visibility_scope} departmentId={t.department_id} deptMap={deptMap} />
                  </div>
                  <div className="truncate">{userMap.get(t.owner_id)?.name ?? "—"}</div>
                  <div className="truncate">{statusMap.get(t.status_id)?.name ?? "—"}</div>
                  <div>
                    <Badge variant="secondary" className={`text-[11.5px] rounded-full px-2 ${PRIORITY_COLOR[t.priority]}`}>
                      {PRIORITY_LABEL[t.priority]}
                    </Badge>
                  </div>
                  <div className="tabular-nums">{t.progress}%</div>
                  <SubtaskCell sub={subtaskMap.get(t.id)} />
                  <div className="truncate tabular-nums">{t.due_date ? new Date(t.due_date).toLocaleDateString("zh-TW") : "—"}</div>
                  <div className="truncate text-muted-foreground">{t.project_id ? projectMap.get(t.project_id)?.name ?? "—" : "—"}</div>
                </div>
              );
            })}
            {paged.length === 0 && (
              <div className="py-12 text-center text-muted-foreground text-sm">無符合條件的任務</div>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground pt-2">
        <div className="flex items-center gap-2">
          <span>每頁</span>
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger className="h-8 w-[72px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
          <span>筆</span>
        </div>
        {sorted.length > pageSize && (
          <div className="flex items-center gap-2">
            <span>第 {page} / {pageCount} 頁（共 {sorted.length} 筆）</span>
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一頁</Button>
            <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>下一頁</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ThSort({ label, k, sortKey, sortDir, onClick }: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: "asc" | "desc"; onClick: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <TableHead className="whitespace-nowrap">
      <button type="button" onClick={() => onClick(k)} className="flex items-center gap-1 hover:text-foreground">
        {label}
        {active && <span className="text-xs">{sortDir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </TableHead>
  );
}

/* ============ 行事曆視圖 ============ */
function CalendarView({ tasks, statusMap, userMap }: {
  tasks: Task[]; statusMap: Map<string, Status>; userMap: Map<string, AppUser>;
}) {
  const [month, setMonth] = useState(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
  });

  const start = useMemo(() => {
    const d = new Date(month);
    d.setDate(1 - d.getDay()); // 週日為起
    return d;
  }, [month]);

  const cells: { date: Date; tasks: Task[] }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    // 不能用 toISOString()：d 是「本地午夜」，在 UTC+8 轉 ISO 會退回前一天，
    // 整個行事曆會把任務畫到「到期日的隔天」格子裡（7/31 到期跑到 8/1）。
    // sv-SE 的 locale 格式就是 YYYY-MM-DD 且用本地時區。
    const ds = d.toLocaleDateString("sv-SE");
    const inDay = tasks.filter((t) => t.due_date === ds);
    cells.push({ date: d, tasks: inDay });
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);

  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">
            {month.getFullYear()} 年 {month.getMonth() + 1} 月
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => {
              const d = new Date(month); d.setMonth(d.getMonth() - 1); setMonth(d);
            }}>上月</Button>
            <Button size="sm" variant="outline" onClick={() => {
              const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); setMonth(d);
            }}>本月</Button>
            <Button size="sm" variant="outline" onClick={() => {
              const d = new Date(month); d.setMonth(d.getMonth() + 1); setMonth(d);
            }}>下月</Button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-px bg-border rounded-md overflow-hidden text-xs">
          {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
            <div key={d} className="bg-muted/60 p-2 text-center font-medium">{d}</div>
          ))}
          {cells.map(({ date, tasks: dayTasks }, i) => {
            const inMonth = date.getMonth() === month.getMonth();
            const isToday = date.getTime() === today.getTime();
            return (
              <div key={i}
                className={`bg-background min-h-[100px] p-1.5 ${inMonth ? "" : "text-muted-foreground/50"}`}>
                <div className={`text-[12.5px] mb-1 ${isToday ? "font-bold text-primary" : ""}`}>
                  {date.getDate()}
                </div>
                <div className="space-y-1">
                  {dayTasks.slice(0, 3).map((t) => (
                    <div key={t.id} title={`${t.title} - ${userMap.get(t.owner_id)?.name ?? ""}`}
                      className={`text-[11.5px] truncate px-1 py-0.5 rounded ${PRIORITY_COLOR[t.priority]}`}>
                      {t.title}
                    </div>
                  ))}
                  {dayTasks.length > 3 && (
                    <div className="text-[11.5px] text-muted-foreground">+{dayTasks.length - 3} 更多</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="text-xs text-muted-foreground">
          顯示有期限 (due_date) 的任務。
        </div>
      </CardContent>
    </Card>
  );
}

/* ============ 建立任務對話框 ============ */

// 建立時還沒有 task id，子項與連結只能先放在本地 state，任務建好才寫進 DB。
// key 只是 React 的 list key（用陣列 index 當 key 時刪掉中間一列會讓後面幾列的
// 輸入焦點與 IME 組字跑掉），不會送到後端。
type DraftChecklistRow = { key: string; title: string };
type DraftLinkRow = { key: string; label: string; url: string };
const draftKey = () => crypto.randomUUID();

// task_checklist / eip_url_link 都還沒進 types.ts，寫入用寬鬆 client（supabaseAny），
// 型別在這裡自己宣告，不要灑 any。
type TaskChecklistInsert = { task_id: string; title: string; sort_order: number };
type UrlLinkInsert = {
  entity_type: "task";
  entity_id: string;
  label: string | null;
  url: string;
};

function CreateTaskDialog({
  open, onClose, appUser, statuses, users, departments, projects, types, onCreated,
}: {
  open: boolean; onClose: () => void; appUser: AppUser;
  statuses: Status[]; users: AppUser[]; departments: Department[]; projects: Project[]; types: TaskType[];
  onCreated: () => void;
}) {
  const defaultStatusId = statuses.find((s) => !s.is_done_state)?.id ?? statuses[0]?.id ?? "";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [typeId, setTypeId] = useState("none");
  const [ownerId, setOwnerId] = useState(appUser.id);
  const [deptId, setDeptId] = useState<string | null>(appUser.department_id ?? null);
  const [scope, setScope] = useState<VisibilityScope>(appUser.department_id ? "department" : "company");
  const [projectId, setProjectId] = useState("none");
  const [priority, setPriority] = useState<Priority>("normal");
  const [dueDate, setDueDate] = useState("");
  const [collaborators, setCollaborators] = useState<string[]>([]);
  // 使用者回報「一開始建立畫面沒有連結、檔案、子項目清單欄位，要建立後再按編輯才能登打」
  const [checklist, setChecklist] = useState<DraftChecklistRow[]>([]);
  const [links, setLinks] = useState<DraftLinkRow[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) return toast.error("請輸入標題");
    const v = validateVisibility(scope, deptId);
    if (!v.ok) return toast.error(v.error);
    // 空白列直接丟掉，使用者按了「新增一列」又沒填不該擋住建立
    const checklistTitles = checklist.map((r) => r.title.trim()).filter(Boolean);
    const linkRows = links
      .map((r) => ({ label: r.label.trim(), url: r.url.trim() }))
      .filter((r) => r.label || r.url);
    // 連結格式在送出前就驗完：等 DB 回 23514（check constraint）時任務已經建好了，
    // 而且訊息看不出是哪一列有問題。判定沿用 UrlLinks 的 validateExternalUrl()。
    for (let i = 0; i < linkRows.length; i++) {
      const bad = validateExternalUrl(linkRows[i].url);
      if (bad) return toast.error(`相關連結第 ${i + 1} 列：${bad}`);
    }
    setBusy(true);
    try {
      const { data: created, error } = await supabase.from("task").insert({
        tenant_id: appUser.tenant_id ?? DEFAULT_TENANT_ID,
        title: title.trim(),
        description: description.trim() || null,
        type_id: typeId === "none" ? null : typeId,
        owner_id: ownerId,
        department_id: v.payload.department_id,
        visibility_scope: v.payload.visibility_scope,
        project_id: projectId === "none" ? null : projectId,
        priority,
        status_id: defaultStatusId,
        progress: 0,
        due_date: dueDate || null,
        created_by: appUser.id,
      }).select("*").single();
      if (error) throw error;
      const parentId = (created as Task).id;
      // 以下幾段是「附帶寫入」：失敗不該讓任務建立整個回滾（DB 沒有交易可用），
      // 但也絕對不能照樣跳成功 toast —— 使用者會以為協作者/子項/連結都進去了。
      const partial: string[] = [];
      if (collaborators.length) {
        const { error: ce } = await supabase.from("task_collaborator")
          .insert(collaborators.map((uid) => ({ task_id: parentId, user_id: uid })));
        if (ce) partial.push("協作者未加入");
      }
      if (checklistTitles.length) {
        // tenant_id / created_by 由 trg_task_checklist_defaults 補（見 TaskChecklist.tsx）。
        // sort_order 這裡明確給 1..n：批次 insert 交給 trigger 逐列補時，
        // 順序不保證跟畫面上排的一樣。
        const rows: TaskChecklistInsert[] = checklistTitles.map((t2, i) => ({
          task_id: parentId, title: t2, sort_order: i + 1,
        }));
        const { error: kle } = await supabaseAny.from("task_checklist").insert(rows);
        if (kle) partial.push("子項清單未建立");
      }
      if (linkRows.length) {
        const rows: UrlLinkInsert[] = linkRows.map((r) => ({
          entity_type: "task", entity_id: parentId, label: r.label || null, url: r.url,
        }));
        const { error: ue } = await supabaseAny.from("eip_url_link").insert(rows);
        if (ue) partial.push("相關連結未建立");
      }
      const t = types.find((x) => x.id === typeId);
      const steps = Array.isArray(t?.default_steps) ? (t!.default_steps as unknown as string[]) : [];
      if (steps.length) {
        const rows = steps.filter((s) => typeof s === "string" && s.trim()).map((s) => ({
          tenant_id: appUser.tenant_id, title: s, owner_id: ownerId,
          status_id: defaultStatusId, priority: "normal" as Priority, progress: 0,
          parent_task_id: parentId, project_id: projectId === "none" ? null : projectId,
          department_id: v.payload.department_id,
          visibility_scope: v.payload.visibility_scope,
          created_by: appUser.id,
        }));
        if (rows.length) {
          const { error: se } = await supabase.from("task").insert(rows);
          if (se) partial.push("預設步驟未建立");
        }
      }
      if (partial.length) toast.warning(`任務已建立，但${partial.join("、")}，請手動補上`);
      else toast.success("任務已建立");
      onCreated(); onClose();
    } catch (e) {
      toast.error(humanizeError(e, "建立"));

    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>建立任務</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <Field label="標題"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="任務標題" /></Field>
          <Field label="描述"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="類型">
              <Select value={typeId} onValueChange={setTypeId}>
                <SelectTrigger><SelectValue placeholder="選擇類型" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">無</SelectItem>
                  {types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="優先級">
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ALL_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="負責人">
              {/* 部門跟著「負責人」走：以前是取建立者的部門，指派給別部門同仁時
                  任務仍掛在建立者部門，該負責人的直屬主管就管不到自己部下的任務。 */}
              <Select
                value={ownerId}
                onValueChange={(v) => {
                  setOwnerId(v);
                  const d = users.find((u) => u.id === v)?.department_id ?? null;
                  if (d) { setDeptId(d); if (scope !== "members") setScope("department"); }
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="專案">
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">無</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="期限">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>
          <VisibilityScopeFields
            scope={scope}
            onScopeChange={setScope}
            deptId={deptId}
            onDeptIdChange={setDeptId}
            departments={departments}
          />

          <Field label="協作者">
            {/* 負責人預設就是自己，清單裡看不到自己時要講清楚原因，
                否則使用者會以為是「不能選我自己」的錯誤 */}
            <p className="text-[12.5px] text-muted-foreground">
              負責人（{users.find((u) => u.id === ownerId)?.name ?? "未指定"}）不需要重複加為協作者
            </p>
            <div className="flex flex-wrap gap-2 p-2 border rounded-md max-h-32 overflow-y-auto">
              {users.filter((u) => u.id !== ownerId).map((u) => {
                const on = collaborators.includes(u.id);
                return (
                  <button key={u.id} type="button"
                    onClick={() => setCollaborators((s) => on ? s.filter((x) => x !== u.id) : [...s, u.id])}
                    className={`text-xs px-2 py-1 rounded border ${on ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"}`}>
                    {u.name}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* 子項清單：建立時就能登打，不用先建立再進編輯（勾選要等建立後在詳情裡做） */}
          <div className="mt-1 border-t pt-3 space-y-2">
            <div className="text-sm font-medium flex items-center gap-1.5">
              <ListChecks className="w-3.5 h-3.5" />
              子項清單
            </div>
            {checklist.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">
                子項用來拆解這個任務要做的幾件事；建立後可在任務詳情裡勾選與排序。
              </p>
            ) : (
              <div className="space-y-1.5">
                {checklist.map((row, i) => (
                  <div key={row.key} className="flex items-center gap-2">
                    <Input
                      value={row.title}
                      placeholder={`子項 ${i + 1}`}
                      className="h-8 text-sm"
                      onChange={(e) =>
                        setChecklist((s) => s.map((x) => (x.key === row.key ? { ...x, title: e.target.value } : x)))
                      }
                    />
                    <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0 shrink-0"
                      onClick={() => setChecklist((s) => s.filter((x) => x.key !== row.key))}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Button type="button" size="sm" variant="outline" className="h-8"
              onClick={() => setChecklist((s) => [...s, { key: draftKey(), title: "" }])}>
              <Plus className="w-3.5 h-3.5 mr-1" />
              新增子項
            </Button>
          </div>

          {/* 相關連結：使用者說的「檔案」就是 NAS 上的路徑，用連結涵蓋。
              真正的檔案上傳屬文件中心，這裡不做。 */}
          {SHOW_URL_LINK_FIELD && (
          <div className="mt-1 border-t pt-3 space-y-2">
            <div className="text-sm font-medium flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5" />
              相關連結（檔案／NAS／網址）
            </div>
            {links.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">
                可以放 NAS 資料夾路徑（\\伺服器\分享資料夾\…）或網址。NAS 路徑瀏覽器不能直接開，
                之後在任務詳情點擊會複製路徑。
              </p>
            ) : (
              <div className="space-y-1.5">
                {links.map((row) => (
                  <div key={row.key} className="flex items-center gap-2">
                    <Input
                      value={row.label}
                      placeholder="標籤（選填）"
                      className="h-8 text-sm w-40 shrink-0"
                      onChange={(e) =>
                        setLinks((s) => s.map((x) => (x.key === row.key ? { ...x, label: e.target.value } : x)))
                      }
                    />
                    <Input
                      value={row.url}
                      placeholder="\\NAS\品保\2026\ 或 https://…"
                      className="h-8 text-sm font-mono"
                      onChange={(e) =>
                        setLinks((s) => s.map((x) => (x.key === row.key ? { ...x, url: e.target.value } : x)))
                      }
                    />
                    <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0 shrink-0"
                      onClick={() => setLinks((s) => s.filter((x) => x.key !== row.key))}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Button type="button" size="sm" variant="outline" className="h-8"
              onClick={() => setLinks((s) => [...s, { key: draftKey(), label: "", url: "" }])}>
              <Plus className="w-3.5 h-3.5 mr-1" />
              新增連結
            </Button>
          </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "建立中…" : "建立"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

/* ============ 任務詳情/編輯對話框 ============ */
type TaskUpdateRow = {
  id: string;
  created_at: string;
  comment: string | null;
  user_id: string;
};

// eip_task_timeline view：把欄位變更（task_change_log）、進度回報（task_update）、
// 子項完成（task_checklist）併成一份時間軸。view 是 security_invoker，
// 三個來源各自的 RLS 照常生效。
type TimelineRow = {
  task_id: string;
  kind: "field_change" | "progress" | "checklist_done" | string;
  at: string;
  actor_id: string | null;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  progress: number | null;
  comment: string | null;
};

export function EditTaskDialog({
  task, readOnly, onClose, onSaved, statuses, users, departments, projects, onChecklistChange,
}: {
  task: Task; readOnly: boolean;
  onClose: () => void; onSaved: () => void;
  statuses: Status[]; users: AppUser[]; departments: Department[]; projects: Project[];
  // 子項增減後要讓看板卡片的「3/5」重新計算
  onChecklistChange?: () => void;
}) {
  const { appUser } = useEipUser();
  const qc = useQueryClient();
  const userMap = useMemo(() => {
    const m = new Map<string, string>();
    users.forEach((u) => m.set(u.id, u.name));
    return m;
  }, [users]);

  /* ---- 協作者 ----
   * 原本編輯畫面完全沒有這個欄位，指派協作者只能在建立時做一次，之後要改沒有入口。
   * collabInitial 保留載入時的原狀，儲存時做差集（新增 insert / 移除 delete）——
   * 不能「先整批刪除再重新插入」：task_collaborator 上的 trg_task_collab_change
   * 會寫變更紀錄，全刪全插會在「執行歷程」時間軸上製造一堆假的移除／加入事件。
   */
  const [collabIds, setCollabIds] = useState<string[]>([]);
  const [collabInitial, setCollabInitial] = useState<string[]>([]);
  const [collabLoading, setCollabLoading] = useState(true);
  const [collabErr, setCollabErr] = useState<string | null>(null);
  // 跟 summaryLoaded 同一個道理：沒讀成功就不准算差集寫回去，
  // 否則會拿空的 collabInitial 當基準，把現有協作者當成「使用者移除的」全刪掉。
  const [collabLoaded, setCollabLoaded] = useState(false);
  // 協作者的寫入權限比「能編輯這筆任務」窄（見 canManageCollaborators 的說明）。
  // 在對話框內自己算而不是從外面傳 prop：這個對話框有三個呼叫端
  //（tasks／my-tasks／projects.$id），傳 prop 遲早會有一邊忘記或算得不一樣。
  const canEditCollab = !readOnly && canManageCollaborators(task, appUser);

  const loadCollaborators = async () => {
    setCollabLoading(true);
    const { data, error } = await supabase
      .from("task_collaborator")
      .select("user_id")
      .eq("task_id", task.id);
    setCollabLoading(false);
    if (error) { setCollabErr(formatErr(error)); setCollabLoaded(false); return; }
    setCollabErr(null);
    const ids = (data ?? []).map((r) => r.user_id);
    setCollabInitial(ids);
    setCollabIds(ids);
    setCollabLoaded(true);
  };
  useEffect(() => { void loadCollaborators(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [task.id]);

  const [notes, setNotes] = useState<TaskUpdateRow[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [notesErr, setNotesErr] = useState<string | null>(null);
  const [newNote, setNewNote] = useState("");
  const [postingNote, setPostingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [savingNoteEdit, setSavingNoteEdit] = useState(false);

  const startEditNote = (n: TaskUpdateRow) => {
    setEditingNoteId(n.id);
    setEditingNoteText(n.comment ?? "");
  };
  const cancelEditNote = () => {
    setEditingNoteId(null);
    setEditingNoteText("");
  };
  const saveEditNote = async (id: string) => {
    const text = editingNoteText.trim();
    if (!text) return;
    setSavingNoteEdit(true);
    // 補充說明的 RLS 只讓本人改。被擋掉時 PostgREST 回 0 列且 error 為 null，
    // 不看筆數會變成「按了儲存、畫面關掉、內容其實沒變」。
    // （task_update 沒有軟刪除 guard，所以這張表的列數是可信的）
    const { data, error } = await supabase
      .from("task_update")
      .update({ comment: text })
      .eq("id", id)
      .select("id");
    setSavingNoteEdit(false);
    if (error) { toast.error(humanizeError(error, "修改")); return; }
    if (!data?.length) { toast.error("修改失敗：只有這則補充說明的作者可以修改"); return; }
    cancelEditNote();
    void loadNotes();
  };
  const deleteNote = async (id: string) => {
    if (!confirm("確定要刪除這則補充說明？")) return;
    // 同上：DELETE 被 RLS 擋掉也是 0 列 + error 為 null，只看 error 會變成
    // 「按了沒反應也沒訊息」，使用者只會一直重按
    const { data, error } = await supabase
      .from("task_update").delete().eq("id", id).select("id");
    if (error) { toast.error(humanizeError(error, "刪除")); return; }
    if (!data?.length) { toast.error("刪除失敗：只有這則補充說明的作者可以刪除"); return; }
    void loadNotes();
  };

  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [timelineErr, setTimelineErr] = useState<string | null>(null);

  const loadTimeline = async () => {
    setTimelineLoading(true);
    const { data, error } = await supabaseAny
      .from("eip_task_timeline")
      .select("*")
      .eq("task_id", task.id)
      .order("at", { ascending: false });
    setTimelineLoading(false);
    // 失敗時不能靜默留在空陣列 —— 畫面會顯示「尚無執行歷程」，
    // 使用者以為紀錄不見了。改為記錯誤讓區塊顯示「載入失敗，重試」。
    if (error) { setTimelineErr(formatErr(error)); return; }
    setTimelineErr(null);
    setTimeline((data ?? []) as TimelineRow[]);
  };
  useEffect(() => { void loadTimeline(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [task.id]);

  const loadNotes = async () => {
    setNotesLoading(true);
    const { data, error } = await supabase
      .from("task_update")
      .select("id,created_at,comment,user_id")
      .eq("task_id", task.id)
      .not("comment", "is", null)
      .order("created_at", { ascending: true });
    setNotesLoading(false);
    if (error) { setNotesErr(formatErr(error)); return; }
    setNotesErr(null);
    setNotes((data ?? []) as TaskUpdateRow[]);
  };
  useEffect(() => { void loadNotes(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [task.id]);

  const postNote = async () => {
    const text = newNote.trim();
    if (!text || !appUser?.id) return;
    setPostingNote(true);
    const { error } = await supabase.from("task_update").insert({
      task_id: task.id,
      tenant_id: task.tenant_id,
      user_id: appUser.id,
      comment: text,
      progress: null,
      status_changed_to_id: null,
    });
    setPostingNote(false);
    if (error) { toast.error(humanizeError(error, "補充")); return; }
    setNewNote("");
    void loadNotes();
  };
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [statusId, setStatusId] = useState(task.status_id);
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [ownerId, setOwnerId] = useState(task.owner_id);
  const [deptId, setDeptId] = useState<string | null>(task.department_id ?? null);
  const [scope, setScope] = useState<VisibilityScope>(
    (task.visibility_scope as VisibilityScope) ?? (task.department_id ? "department" : "company"),
  );
  const [projectId, setProjectId] = useState(task.project_id ?? "none");
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [progress, setProgress] = useState<number>(task.progress);
  // closing_summary 不在主清單的 select 欄位裡（typed client 不認識新欄位），
  // 開啟詳情時單獨補讀一次。
  const [closingSummary, setClosingSummary] = useState("");
  // summaryLoaded：補讀完成前不准把 closing_summary 寫回 DB。
  // 否則在補讀回來之前按儲存，會用初值 "" 把主管寫過的結案摘要整段清掉，
  // 而且畫面上不會有任何提示（欄位還沒 render）。
  const [summaryLoaded, setSummaryLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    setSummaryLoaded(false);
    void (async () => {
      const { data, error } = await supabaseAny
        .from("task").select("closing_summary").eq("id", task.id).maybeSingle();
      if (!alive) return;
      if (error) { setSummaryLoaded(false); return; }
      setClosingSummary((data as { closing_summary: string | null } | null)?.closing_summary ?? "");
      setSummaryLoaded(true);
    })();
    return () => { alive = false; };
  }, [task.id]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 切到「已完成」類狀態時才要求結案摘要。
  // DB 沒有 NOT NULL（既有任務都沒摘要，強制會讓現有結案流程直接壞），
  // 所以這裡只做提示，不擋儲存。
  const willBeDone = !!statuses.find((s) => s.id === statusId)?.is_done_state;
  const wasDone = !!statuses.find((s) => s.id === task.status_id)?.is_done_state;

  const save = async () => {
    if (!title.trim()) { setErr("請輸入標題"); return; }
    const v = validateVisibility(scope, deptId);
    if (!v.ok) { setErr(v.error); return; }
    setBusy(true); setErr(null);
    const status = statuses.find((s) => s.id === statusId);
    const patch: Database["public"]["Tables"]["task"]["Update"] = {
      title: title.trim(),
      description: description.trim() || null,
      status_id: statusId,
      priority,
      owner_id: ownerId,
      department_id: v.payload.department_id,
      visibility_scope: v.payload.visibility_scope,
      project_id: projectId === "none" ? null : projectId,
      due_date: dueDate || null,
      progress: Math.max(0, Math.min(100, Number(progress) || 0)),
    };
    if (status?.is_done_state) {
      patch.progress = 100;
      patch.completed_at = new Date().toISOString();
    } else {
      patch.completed_at = null;
    }
    // closing_summary 還沒進 types.ts，走 any 版 client 才不會被型別擋掉。
    // 從已完成退回進行中時摘要保留，不無聲清掉使用者寫過的內容。
    // summaryLoaded 為 false（還在補讀或補讀失敗）時，整個欄位不進 patch，
    // 寧可這次不存摘要，也不要用空值蓋掉既有內容。
    // UPDATE 被 RLS 擋掉時 PostgREST 回 0 列且 error 為 null，看起來像成功。
    // 一定要 .select("id") 看筆數，否則使用者會拿到「已儲存」卻什麼都沒變。
    const { data: updated, error } = await supabaseAny
      .from("task")
      .update(summaryLoaded ? { ...patch, closing_summary: closingSummary.trim() || null } : patch)
      .eq("id", task.id)
      .select("id");
    if (error) { setBusy(false); setErr(humanizeError(error, "儲存")); return; }
    if (!(updated as { id: string }[] | null)?.length) {
      setBusy(false);
      // RETURNING 也受 SELECT 政策限制。把自己負責的任務可見範圍從「全公司」改成
      // 「部門＝別的部門」時，UPDATE 的 WITH CHECK 是過的（自己還是 owner），
      // **資料已經寫進去了**，只是 task_read 讓自己看不到這一列 → 回 0 列。
      //
      // 舊版在這裡 early return：onSaved() 沒被呼叫、對話框不關、看板不 invalidate、
      // 卡片停在舊值，看起來像沒存到。使用者按第二次時連 USING 都不過（他已經看不到
      // 這一列了），還是 0 列，於是永遠卡在同一段錯誤訊息。
      //
      // 所以這裡照樣收尾（刷新＋關閉），只把訊息降級成警告讓他自己去確認。
      toast.warning(
        "已送出，但這筆任務已不在你的可見範圍內（可能是可見範圍改成了你看不到的部門），請重新確認",
      );
      void qc.invalidateQueries({ queryKey: ["eip", "tasks-full"] });
      onSaved();
      return;
    }

    // 協作者是「附帶寫入」：任務本體已經存好了，這段失敗不該讓整個儲存看起來失敗，
    // 但也不能照樣跳成功 toast —— 沿用 CreateTaskDialog 的 partial 模式列出沒進去的項目。
    const partial: string[] = [];
    // 只有「使用者真的動過協作者」或「負責人真的變了」才做差集。
    //
    // 為什麼不能無條件做：下面的 filter(id !== ownerId) 是為了「編輯中把負責人改成
    // 原本的協作者」而寫的，但它不分使用者這次有沒有碰協作者。這輪之前編輯畫面根本
    // 沒有協作者欄位，所以正式庫裡本來就存在「負責人同時掛著協作者紀錄」的資料 ——
    // 無條件執行的話，任何人打開這種任務、只把進度從 40% 拉到 50% 按儲存，
    // toRemove 就會憑空多一個人 → DELETE → trg_task_collab_change 在「執行歷程」
    // 寫下一筆根本沒有人做過的「移除協作者」事件。
    const collabDirty =
      collabIds.length !== collabInitial.length ||
      collabIds.some((id) => !collabInitial.includes(id));
    const ownerChanged = ownerId !== task.owner_id;
    // 沒有協作者寫入權的人（例如協作者本人改了負責人）不要送註定失敗的 INSERT/DELETE，
    // 那只會換到一句「部分協作者未移除（權限不足）」的雜訊
    if (collabLoaded && canEditCollab && (collabDirty || ownerChanged)) {
      // 負責人用「當前表單值」判斷：編輯中可能剛把負責人改成原本的協作者，
      // 那個人就該從協作者名單移除，而不是同時掛兩個角色。
      const target = collabIds.filter((id) => id !== ownerId);
      const toAdd = target.filter((id) => !collabInitial.includes(id));
      const toRemove = collabInitial.filter((id) => !target.includes(id));
      if (toAdd.length) {
        const { error: ae } = await supabase
          .from("task_collaborator")
          .insert(toAdd.map((uid) => ({ task_id: task.id, user_id: uid })));
        if (ae) partial.push("協作者未加入");
      }
      if (toRemove.length) {
        // 同樣要看筆數才知道有沒有真的刪掉。task_collaborator 沒有 id 欄位
        // （PK 是 task_id + user_id），所以這裡 select("user_id")。
        const { data: removed, error: de } = await supabase
          .from("task_collaborator")
          .delete()
          .eq("task_id", task.id)
          .in("user_id", toRemove)
          .select("user_id");
        if (de) partial.push("協作者未移除");
        else if ((removed?.length ?? 0) < toRemove.length) partial.push("部分協作者未移除（權限不足）");
      }
      if (toAdd.length || toRemove.length) {
        // 看板卡片的協作者標記讀這支 query，不刷新的話畫面會停在舊名單
        void qc.invalidateQueries({ queryKey: ["eip", "task_collaborators-all"] });
      }
    }

    setBusy(false);
    if (partial.length) toast.warning(`任務已儲存，但${partial.join("、")}，請重新確認`);
    else toast.success("已儲存");
    onSaved();
  };


  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{readOnly ? "任務詳情" : "編輯任務"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground rounded-md border bg-muted/30 px-3 py-2">
            <span>建立者：<span className="text-foreground font-medium">{userMap.get(task.created_by) ?? "—"}</span></span>
            <span>建立時間：<span className="text-foreground font-medium">{new Date(task.created_at).toLocaleString("zh-TW")}</span></span>
            {task.updated_at && (
              <span>最後更新：<span className="text-foreground font-medium">{new Date(task.updated_at).toLocaleString("zh-TW")}</span></span>
            )}
          </div>
          <Field label="標題">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly} />
          </Field>
          <Field label="說明">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} disabled={readOnly} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="狀態">
              <Select value={statusId} onValueChange={setStatusId} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statuses.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="優先級">
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ALL_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="負責人">
              <Select
                value={ownerId}
                onValueChange={(v) => {
                  setOwnerId(v);
                  // 轉派負責人時部門一併跟著轉，否則新負責人的主管看不到這張任務
                  const d = users.find((u) => u.id === v)?.department_id ?? null;
                  if (d) { setDeptId(d); if (scope !== "members") setScope("department"); }
                }}
                disabled={readOnly}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="專案">
              <Select value={projectId} onValueChange={setProjectId} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">無</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="期限">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={readOnly} />
            </Field>
            <Field label="進度 (%)">
              <Input type="number" min={0} max={100} value={progress}
                onChange={(e) => setProgress(Number(e.target.value))} disabled={readOnly} />
            </Field>
          </div>
          <VisibilityScopeFields
            scope={scope}
            onScopeChange={setScope}
            deptId={deptId}
            onDeptIdChange={setDeptId}
            departments={departments}
            disabled={readOnly}
          />

          <Field label="協作者">
            {/* 這一行小字是給「為什麼協作者清單裡沒有我自己」的答案：
                負責人預設就是自己，本來就不必再加一次。 */}
            {canEditCollab && (
              <p className="text-[12.5px] text-muted-foreground">
                負責人（{ownerId ? (userMap.get(ownerId) ?? "已停用帳號") : "未指定"}）不需要重複加為協作者
              </p>
            )}
            {/* 能編輯任務、但沒有協作者寫入權（例如協作者本人）：講原因，不要給一個
                點得動卻一定被 RLS 擋掉的 picker */}
            {!readOnly && !canEditCollab && (
              <p className="text-[12.5px] text-muted-foreground">
                只有負責人、建立者或本部門主管可以調整協作者
              </p>
            )}
            {collabLoading ? (
              <div className="text-xs text-muted-foreground">載入中…</div>
            ) : collabErr ? (
              // 載入失敗不能只留空清單：那看起來像「這筆任務沒有協作者」，
              // 而且這種狀態下按儲存不會去動協作者（collabLoaded 為 false）
              <div className="text-xs">
                <span className="text-destructive">協作者載入失敗：{collabErr}</span>
                <Button size="sm" variant="ghost" className="h-6 ml-1 text-xs"
                  onClick={() => void loadCollaborators()}>重試</Button>
              </div>
            ) : !canEditCollab ? (
              collabIds.length === 0 ? (
                <div className="text-xs text-muted-foreground">無協作者</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {collabIds.map((id) => (
                    <Badge key={id} variant="secondary" className="text-xs font-normal">
                      {userMap.get(id) ?? "已停用帳號"}
                    </Badge>
                  ))}
                </div>
              )
            ) : (
              <div className="flex flex-wrap gap-2 p-2 border rounded-md max-h-32 overflow-y-auto">
                {users.filter((u) => u.id !== ownerId).map((u) => {
                  const on = collabIds.includes(u.id);
                  return (
                    <button key={u.id} type="button"
                      onClick={() => setCollabIds((s) => on ? s.filter((x) => x !== u.id) : [...s, u.id])}
                      className={`text-xs px-2 py-1 rounded border ${on ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"}`}>
                      {u.name}
                    </button>
                  );
                })}
              </div>
            )}
          </Field>

          {err && <div className="text-sm text-destructive">{err}</div>}

          {(willBeDone || (wasDone && closingSummary)) && (
            <Field label="結案摘要">
              <Textarea
                rows={3}
                value={closingSummary}
                onChange={(e) => setClosingSummary(e.target.value)}
                disabled={readOnly}
                placeholder="做了什麼、結果如何、後續要注意什麼"
              />
              {!readOnly && !wasDone && !closingSummary.trim() && (
                <div className="text-xs text-muted-foreground mt-1">
                  這筆任務要結案了，建議補一段摘要；留空也可以儲存。
                </div>
              )}
            </Field>
          )}

          {task.id && <EntityLinks entityType="task" entityId={task.id} readOnly={readOnly} />}
          {/* eip_link 是系統內實體關聯，NAS／網址是另一件事，走 eip_url_link */}
          {SHOW_URL_LINK_FIELD && task.id && (
            <UrlLinks entityType="task" entityId={task.id} readOnly={readOnly} title="檔案／NAS 連結" />
          )}

          {task.id && (
            <TaskChecklist
              taskId={task.id}
              readOnly={readOnly}
              nameOf={(id) => (id ? (userMap.get(id) ?? "") : "")}
              onCountChange={() => {
                // 子項勾選會進執行歷程，順手把時間軸也刷新
                void loadTimeline();
                onChecklistChange?.();
              }}
            />
          )}

          <div className="mt-2 border-t pt-3">
            <div className="text-sm font-medium mb-2">補充說明</div>
            {notesLoading ? (
              <div className="text-xs text-muted-foreground">載入中…</div>
            ) : notesErr ? (
              <div className="text-xs">
                <span className="text-destructive">補充說明載入失敗：{notesErr}</span>
                <Button size="sm" variant="ghost" className="h-6 ml-1 text-xs"
                  onClick={() => void loadNotes()}>重試</Button>
              </div>
            ) : notes.length === 0 ? (
              <div className="text-xs text-muted-foreground">尚無補充說明</div>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {notes.map((n) => {
                  const canModify = appUser?.id === n.user_id;
                  const isEditing = editingNoteId === n.id;
                  return (
                    <div key={n.id} className="rounded-md border bg-muted/30 p-2">
                      <div className="flex items-center justify-between text-[12.5px] text-muted-foreground">
                        <span className="font-medium text-foreground">{userMap.get(n.user_id) ?? "使用者"}</span>
                        <div className="flex items-center gap-2">
                          <span>{new Date(n.created_at).toLocaleString("zh-TW")}</span>
                          {canModify && !isEditing && (
                            <>
                              <button type="button" className="text-primary hover:underline" onClick={() => startEditNote(n)}>編輯</button>
                              <button type="button" className="text-destructive hover:underline" onClick={() => deleteNote(n.id)}>刪除</button>
                            </>
                          )}
                        </div>
                      </div>
                      {isEditing ? (
                        <div className="mt-1 flex flex-col gap-2">
                          <Textarea rows={2} value={editingNoteText} onChange={(e) => setEditingNoteText(e.target.value)} />
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={cancelEditNote} disabled={savingNoteEdit}>取消</Button>
                            <Button size="sm" onClick={() => saveEditNote(n.id)} disabled={savingNoteEdit || !editingNoteText.trim()}>
                              {savingNoteEdit ? "儲存中…" : "儲存"}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm whitespace-pre-wrap mt-1">{n.comment}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {appUser && (
              <div className="mt-2 flex flex-col gap-2">
                <Textarea
                  rows={2}
                  placeholder="輸入補充說明…"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                />
                <div className="flex justify-end">
                  <Button size="sm" onClick={postNote} disabled={postingNote || !newNote.trim()}>
                    {postingNote ? "送出中…" : "送出補充"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {task.id && (
            <div className="mt-2 border-t pt-3">
              <div className="text-sm font-medium mb-2">執行歷程</div>
              {timelineLoading ? (
                <div className="text-xs text-muted-foreground">載入中…</div>
              ) : timelineErr ? (
                <div className="text-xs">
                  <span className="text-destructive">執行歷程載入失敗：{timelineErr}</span>
                  <Button size="sm" variant="ghost" className="h-6 ml-1 text-xs"
                    onClick={() => void loadTimeline()}>重試</Button>
                </div>
              ) : timeline.length === 0 ? (
                <div className="text-xs text-muted-foreground">尚無執行歷程</div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {timeline.map((e, i) => {
                    const actor = e.actor_id == null ? "系統" : (userMap.get(e.actor_id) ?? "—");
                    let desc: string;
                    let tag: string;
                    if (e.kind === "checklist_done") {
                      tag = "子項";
                      desc = `完成子項：${e.new_value ?? ""}`;
                    } else if (e.kind === "progress") {
                      tag = "回報";
                      const bits: string[] = [];
                      if (e.progress != null) bits.push(`進度 ${e.progress}%`);
                      if (e.new_value) bits.push(`狀態改為「${e.new_value}」`);
                      if (e.comment) bits.push(e.comment);
                      desc = bits.join("・") || "進度回報";
                    } else {
                      tag = "變更";
                      desc =
                        e.old_value == null
                          ? `新增${e.field}：${e.new_value}`
                          : e.new_value == null
                            ? `移除${e.field}：${e.old_value}`
                            : `${e.field}：${e.old_value} → ${e.new_value}`;
                    }
                    return (
                      <div key={`${e.kind}-${e.at}-${i}`} className="rounded-lg border bg-muted/30 p-2">
                        <div className="text-sm">
                          <span className="text-[12.5px] text-muted-foreground mr-1.5">[{tag}]</span>
                          {desc}
                        </div>
                        <div className="flex items-center justify-between text-[12.5px] text-muted-foreground mt-1">
                          <span className="font-medium text-foreground">{actor}</span>
                          <span>{new Date(e.at).toLocaleString("zh-TW")}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {readOnly ? "關閉" : "取消"}
          </Button>
          {!readOnly && (
            <Button onClick={save} disabled={busy}>{busy ? "儲存中…" : "儲存"}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
