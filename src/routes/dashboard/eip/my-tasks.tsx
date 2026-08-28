import { EipUserPending } from "@/components/eip/EipUserPending";
import { createFileRoute } from "@tanstack/react-router";
import { RequirePerm } from "@/components/RequirePerm";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useEipUser } from "@/lib/eip-user";
import { useAuth } from "@/lib/auth";
// eip_deleted_items / eip_restore_deleted / eip_purge_deleted 尚未進 types.ts
import { supabase as supabaseAny } from "@/lib/supabase";
import { useActiveUsers } from "@/hooks/useUsers";
import { PRIORITY_COLOR, PRIORITY_LABEL } from "@/lib/eip-constants";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  TaskSourceBadge,
  useTaskSources,
  TASK_SOURCE_LABEL,
  TASK_SOURCE_HINT,
  type TaskSource,
} from "@/components/eip/TaskSourceBadge";
import { TodayRoutineCard } from "@/components/eip/TodayRoutineCard";
import { HandoverInboxCard } from "@/components/eip/HandoverInboxCard";
import { EditTaskDialog, canEditTask, canDeleteTask } from "@/routes/dashboard/eip/tasks";
import type { Database } from "@/integrations/supabase/types";
import { humanizeError } from "@/lib/eip-error";

export const Route = createFileRoute("/dashboard/eip/my-tasks")({ component: () => (
    <RequirePerm module="eip_my_tasks">
      <MyTasksPage />
    </RequirePerm>
  ) });

type Task = Database["public"]["Tables"]["task"]["Row"];
type Status = Database["public"]["Tables"]["task_status"]["Row"];
type AppUser = Database["public"]["Tables"]["app_user"]["Row"];
type SourceFilter = "all" | "normal" | "recurring" | "project" | "meeting";

type DeletedItem = {
  module_key: string;
  label: string;
  item_id: string;
  title: string | null;
  deleted_at: string;
  deleted_by_name: string | null;
  can_purge: boolean;
  // 有協作者／變更紀錄／進度回報的任務屬共同產出，不給永久刪（L1 定案）。
  // 非 null 就是不能刪的原因，直接顯示給使用者，不要讓他按下去才吃例外。
  purge_block: string | null;
};

function MyTasksPage() {
  const { appUser } = useEipUser();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all"); // all | open | <status_id>
  const [groupBy, setGroupBy] = useState<"none" | "source" | "project">("none");
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const statusesQ = useQuery({
    queryKey: ["eip", "task_status"],
    queryFn: async () => {
      const { data, error } = await supabase.from("task_status").select("*").order("sort_order");
      if (error) throw error;
      return (data ?? []) as Status[];
    },
  });

  const ownedQ = useQuery({
    enabled: !!appUser?.id,
    queryKey: ["eip", "my-owned", appUser?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task")
        .select("*")
        .eq("owner_id", appUser!.id)
        .order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Task[];
    },
  });

  // 我建立但指派給別人的任務。建立者在交接機制裡是有責任的角色
  // （離職轉派、交接待辦都通知建立者），因此需要一個看得到自己建了什麼的入口。
  const createdQ = useQuery({
    enabled: !!appUser?.id,
    queryKey: ["eip", "my-created", appUser?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task")
        .select("*")
        .eq("created_by", appUser!.id)
        .neq("owner_id", appUser!.id) // 自己指派給自己的已經在「我負責」了
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Task[];
    },
  });

  // 我建立且已被刪除的（回收區）。走 SECURITY DEFINER 的 RPC，
  // 因為 RLS 已在資料庫層把軟刪除的資料隱形了。
  const deletedQ = useQuery({
    enabled: !!appUser?.id,
    queryKey: ["eip", "my-deleted-tasks", appUser?.id],
    queryFn: async () => {
      const { data, error } = await supabaseAny.rpc("eip_deleted_items", { p_module: "eip_tasks" });
      if (error) throw error;
      return (data ?? []) as DeletedItem[];
    },
  });

  const collabQ = useQuery({
    enabled: !!appUser?.id,
    queryKey: ["eip", "my-collab", appUser?.id],
    queryFn: async () => {
      const { data: links, error } = await supabase
        .from("task_collaborator")
        .select("task_id")
        .eq("user_id", appUser!.id);
      if (error) throw error;
      const ids = (links ?? []).map((l) => l.task_id);
      if (!ids.length) return [] as Task[];
      const { data, error: e2 } = await supabase
        .from("task")
        .select("*")
        .in("id", ids)
        .order("due_date", { ascending: true, nullsFirst: false });
      if (e2) throw e2;
      return (data ?? []) as Task[];
    },
  });

  // 選人用：只在職（傳給任務編輯對話框的負責人下拉）
  const usersQ = useActiveUsers();
  const deptsQ = useQuery({
    queryKey: ["eip", "departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("department").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const projectsQ = useQuery({
    queryKey: ["eip", "projects"],
    queryFn: async () => {
      const { data, error } = await supabase.from("project").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const statusMap = useMemo(() => {
    const m = new Map<string, Status>();
    (statusesQ.data ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [statusesQ.data]);

  // 三個分頁的任務都要餵進來源查詢。原本只餵「我負責 + 我協作」，
  // 於是「我建立但指派給別人」的任務在 sourceMap 裡永遠是 undefined ——
  // 一套來源篩選就把「我建立的」整片濾掉，來源徽章也不會顯示。
  const allMy = useMemo(() => {
    const seen = new Set<string>();
    const out: Task[] = [];
    [...(ownedQ.data ?? []), ...(collabQ.data ?? []), ...(createdQ.data ?? [])].forEach((t) => {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        out.push(t);
      }
    });
    return out;
  }, [ownedQ.data, collabQ.data, createdQ.data]);

  const sourceMap = useTaskSources(allMy);

  // 給 canEditTask() 判斷「我是不是這筆任務的協作者」用的對照表。
  // collabQ 撈回來的每一筆都是「我協作」的任務，所以只需要記自己，
  // 不必再去查全公司的 task_collaborator（任務看板那頁才需要整份）。
  const collabMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    if (!appUser?.id) return m;
    (collabQ.data ?? []).forEach((t) => m.set(t.id, new Set([appUser.id])));
    return m;
  }, [collabQ.data, appUser?.id]);

  // 分頁改成受控：還原完最後一筆之後，「已刪除」的觸發器會消失，但 Tabs 的 value
  // 仍停在 deleted，畫面只剩一個空框、也沒有分頁可以按回去。
  const [tab, setTab] = useState("owned");
  useEffect(() => {
    if (tab === "deleted" && (deletedQ.data?.length ?? 0) === 0) setTab("owned");
  }, [tab, deletedQ.data]);

  const sortedStatuses = useMemo(
    () => [...(statusesQ.data ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [statusesQ.data],
  );

  const applyFilters = (list: Task[]) =>
    list.filter((t) => {
      if (sourceFilter !== "all") {
        const s = sourceMap.get(t.id);
        if (s?.type !== sourceFilter) return false;
      }
      if (statusFilter === "open") {
        if (statusMap.get(t.status_id)?.is_done_state) return false;
      } else if (statusFilter !== "all") {
        if (t.status_id !== statusFilter) return false;
      }
      return true;
    });

  if (!appUser) return <EipUserPending />;

  const owned = applyFilters(ownedQ.data ?? []);
  const collab = applyFilters(collabQ.data ?? []);
  const created = applyFilters(createdQ.data ?? []);
  const deletedRows = deletedQ.data ?? [];

  const restore = async (id: string) => {
    const { error } = await supabaseAny.rpc("eip_restore_deleted", {
      p_module: "eip_tasks",
      p_id: id,
    });
    if (error) return toast.error(humanizeError(error, "還原"));
    toast.success("已還原");
    void deletedQ.refetch();
    void createdQ.refetch();
    refetch();
  };
  const purge = async (id: string, title: string | null) => {
    if (!window.confirm(`永久刪除「${title ?? "此任務"}」？\n這筆沒有協作者也沒有變更歷程，刪掉之後無法復原。`))
      return;
    const { error } = await supabaseAny.rpc("eip_purge_deleted", {
      p_module: "eip_tasks",
      p_id: id,
    });
    if (error) return toast.error(humanizeError(error, "永久刪除"));
    toast.success("已永久刪除");
    void deletedQ.refetch();
  };

  const refetch = () => {
    qc.invalidateQueries({ queryKey: ["eip", "my-owned", appUser.id] });
    qc.invalidateQueries({ queryKey: ["eip", "my-collab", appUser.id] });
  };

  // 可否刪除與「任務看板」共用同一支判斷（見 tasks.tsx canDeleteTask）。
  // 原本這頁自己寫 `t.owner_id === appUser.id`，於是同一筆「我建立、指派給別人」
  // 的任務在任務看板看得到垃圾桶、在這裡看不到 —— 跟先前 canEditTask 同一類的不一致。
  const canDelete = (t: Task) => canDeleteTask(t, appUser, can, collabMap);
  const handleDelete = async (t: Task) => {
    // 文案更正：這不是永久刪除，會進回收區（原本寫「無法復原」是錯的）
    if (!window.confirm(`確定刪除任務「${t.title}」？會移到回收區，可在「已刪除」分頁還原。`))
      return;
    setDeleting(t.id);
    // 走 eip_soft_delete RPC，跟 tasks.tsx 的單筆／批次刪除一致。
    // 不能用 .delete()：task 上的軟刪除 guard 是 BEFORE DELETE ... RETURN NULL，
    // ROW_COUNT 一律 0，所以列數檢查在這張表上會把成功報成失敗；
    // 而只看 error 又會把被 RLS 擋掉的情況報成成功 —— 原本就是這個 bug。
    const { data, error } = await supabaseAny.rpc("eip_soft_delete", {
      p_module: "eip_tasks",
      p_id: t.id,
    });
    setDeleting(null);
    if (error) {
      // 後端訊息原封不動顯示：purge_guard 的拒絕理由帶了協作者／變更紀錄／
      // 進度回報的筆數，是刻意寫給使用者看的。
      toast.error(humanizeError(error, "刪除"));
      return;
    }
    if ((data as { ok?: boolean } | null)?.ok !== true) {
      toast.error("刪除失敗：僅本人 / 本部門主管 / 管理者可刪除這筆任務");
      return;
    }
    toast.success("已移到回收區，可在「已刪除」分頁還原");
    refetch();
    // deletedQ 宣告在頁面層級、observer 一直掛著，切分頁不會重新 mount。
    // 少了這一行，剛刪掉的任務要等視窗失焦再回來才會出現在「已刪除」，
    // 使用者照著上面那句 toast 切過去看到空的，會以為真的永久刪掉了。
    void deletedQ.refetch();
  };

  return (
    <div>
      <PageHeader
        title="我的工作"
        description="單一入口。上面是今天要做的例行與待我接手的代辦，下面是與我相關的任務。來源分四類：常態工作（每日自動產生）、任務看板（有人直接指派）、會議決議、專案任務。"
      />

      {/* ① 個人例行＋② 常態工作：不是任務，所以獨立一塊，勾選直接寫進今天的日誌 */}
      <TodayRoutineCard />

      {/* ⑥ 代理事項：離職交接只提示與跳轉；請假代辦就地勾完成；同時是請假申請入口 */}
      <HandoverInboxCard meId={appUser.id} />

      <Card className="mb-3">
        <CardContent className="p-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">來源</span>
            <Tabs value={sourceFilter} onValueChange={(v) => setSourceFilter(v as SourceFilter)}>
              <TabsList className="h-8">
                <TabsTrigger value="all" className="text-xs">
                  全部
                </TabsTrigger>
                {/* 順序照整合架構圖的 ②③④⑤，標籤用來源本身的名字 */}
                <TabsTrigger value="recurring" className="text-xs" title={TASK_SOURCE_HINT.recurring}>
                  {TASK_SOURCE_LABEL.recurring}
                </TabsTrigger>
                <TabsTrigger value="normal" className="text-xs" title={TASK_SOURCE_HINT.normal}>
                  {TASK_SOURCE_LABEL.normal}
                </TabsTrigger>
                <TabsTrigger value="meeting" className="text-xs" title={TASK_SOURCE_HINT.meeting}>
                  {TASK_SOURCE_LABEL.meeting}
                </TabsTrigger>
                <TabsTrigger value="project" className="text-xs" title={TASK_SOURCE_HINT.project}>
                  {TASK_SOURCE_LABEL.project}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">狀態</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="all">全部狀態</option>
              <option value="open">未完成</option>
              {sortedStatuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">分組</span>
            <Tabs value={groupBy} onValueChange={(v) => setGroupBy(v as typeof groupBy)}>
              <TabsList className="h-8">
                <TabsTrigger value="none" className="text-xs">
                  無
                </TabsTrigger>
                <TabsTrigger value="source" className="text-xs">
                  依來源
                </TabsTrigger>
                <TabsTrigger value="project" className="text-xs">
                  依專案
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="owned">我負責 ({owned.length})</TabsTrigger>
          <TabsTrigger value="collab">我協作 ({collab.length})</TabsTrigger>
          <TabsTrigger value="created">我建立的 ({created.length})</TabsTrigger>
          {deletedRows.length > 0 && (
            <TabsTrigger value="deleted">已刪除 ({deletedRows.length})</TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="owned" className="mt-3">
          <Grouped
            tasks={owned}
            sourceMap={sourceMap}
            statusMap={statusMap}
            sortedStatuses={sortedStatuses}
            groupBy={groupBy}
            onOpen={setEditTask}
            canDelete={canDelete}
            onDelete={handleDelete}
            deleting={deleting}
          />
        </TabsContent>
        <TabsContent value="collab" className="mt-3">
          <Grouped
            tasks={collab}
            sourceMap={sourceMap}
            statusMap={statusMap}
            sortedStatuses={sortedStatuses}
            groupBy={groupBy}
            onOpen={setEditTask}
            canDelete={canDelete}
            onDelete={handleDelete}
            deleting={deleting}
          />
        </TabsContent>
        <TabsContent value="created" className="mt-3">
          {created.length === 0 ? (
            <p className="text-sm text-muted-foreground px-1 py-6">
              沒有「我建立但指派給別人」的任務。自己指派給自己的會顯示在「我負責」。
            </p>
          ) : (
            <Grouped
              tasks={created}
              sourceMap={sourceMap}
              statusMap={statusMap}
              sortedStatuses={sortedStatuses}
              groupBy={groupBy}
              onOpen={setEditTask}
              canDelete={canDelete}
              onDelete={handleDelete}
              deleting={deleting}
            />
          )}
        </TabsContent>
        <TabsContent value="deleted" className="mt-3">
          <div className="rounded-2xl border bg-card overflow-hidden">
            <p className="text-xs text-muted-foreground px-4 py-2.5 border-b bg-muted/30">
              被刪除的任務不會真的消失，變更歷程都保留著。是否要永久清除，由建立者決定。
            </p>
            {deletedRows.map((d) => (
              <div
                key={d.item_id}
                className="flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 text-sm"
              >
                <span className="flex-1 min-w-0 truncate">{d.title ?? "（無標題）"}</span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(d.deleted_at).toLocaleString("zh-TW", {
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {d.deleted_by_name && `・${d.deleted_by_name} 刪除`}
                </span>
                <Button size="sm" variant="outline" onClick={() => void restore(d.item_id)}>
                  還原
                </Button>
                {d.can_purge && !d.purge_block && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => void purge(d.item_id, d.title)}
                  >
                    永久刪除
                  </Button>
                )}
                {d.can_purge && d.purge_block && (
                  <span
                    className="text-xs text-muted-foreground whitespace-nowrap cursor-help"
                    title={d.purge_block}
                  >
                    不可永久刪除
                  </span>
                )}
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* 可否編輯與「任務看板」共用同一支判斷（見 tasks.tsx canEditTask）。
          原本寫 readOnly={editTask.owner_id !== appUser.id}，只認負責人 ——
          協作者與建立者在這頁被鎖成唯讀，跳到任務看板卻可以編，同一筆任務兩種行為。
          後端 task_update_policy 本來就認協作者與建立者，是這裡少判斷。 */}
      {editTask && (
        <EditTaskDialog
          key={editTask.id}
          task={editTask}
          readOnly={!canEditTask(editTask, appUser, can, collabMap)}
          onClose={() => setEditTask(null)}
          statuses={statusesQ.data ?? []}
          users={usersQ.data ?? []}
          departments={(deptsQ.data ?? []) as any}
          projects={(projectsQ.data ?? []) as any}
          onSaved={() => {
            refetch();
            setEditTask(null);
          }}
        />
      )}
    </div>
  );
}

function Grouped({
  tasks,
  sourceMap,
  statusMap,
  sortedStatuses,
  groupBy,
  onOpen,
  canDelete,
  onDelete,
  deleting,
}: {
  tasks: Task[];
  sourceMap: Map<string, TaskSource>;
  statusMap: Map<string, Status>;
  sortedStatuses: Status[];
  groupBy: "none" | "source" | "project";
  onOpen: (t: Task) => void;
  canDelete: (t: Task) => boolean;
  onDelete: (t: Task) => void;
  deleting: string | null;
}) {
  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const ad = a.due_date ?? "9999-12-31";
      const bd = b.due_date ?? "9999-12-31";
      return ad < bd ? -1 : ad > bd ? 1 : 0;
    });
  }, [tasks]);

  if (!sorted.length) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">目前沒有任務</CardContent>
      </Card>
    );
  }

  if (groupBy === "none") {
    return (
      <TaskList
        tasks={sorted}
        sourceMap={sourceMap}
        statusMap={statusMap}
        sortedStatuses={sortedStatuses}
        onOpen={onOpen}
        canDelete={canDelete}
        onDelete={onDelete}
        deleting={deleting}
      />
    );
  }

  const groups = new Map<string, Task[]>();
  sorted.forEach((t) => {
    const s = sourceMap.get(t.id);
    // 分組標題也用同一組來源名稱，不要出現「一般任務」這種說不出內容的字
    let key = TASK_SOURCE_LABEL.normal;
    if (groupBy === "source") {
      if (s?.type === "meeting") key = `${TASK_SOURCE_LABEL.meeting}：${s.label}`;
      else if (s?.type === "recurring") key = `${TASK_SOURCE_LABEL.recurring}（例行）`;
      else if (s?.type === "project") key = `${TASK_SOURCE_LABEL.project}：${s.label}`;
    } else {
      // groupBy === project
      if (s?.type === "project") key = `${TASK_SOURCE_LABEL.project}：${s.label}`;
      else if (s?.type === "meeting") key = `${TASK_SOURCE_LABEL.meeting}：${s.label}`;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  });

  return (
    <div className="space-y-4">
      {Array.from(groups.entries()).map(([key, list]) => (
        <div key={key} className="space-y-2">
          <div className="text-sm font-semibold text-muted-foreground">
            {key} ({list.length})
          </div>
          <TaskList
            tasks={list}
            sourceMap={sourceMap}
            statusMap={statusMap}
            sortedStatuses={sortedStatuses}
            onOpen={onOpen}
            canDelete={canDelete}
            onDelete={onDelete}
            deleting={deleting}
          />
        </div>
      ))}
    </div>
  );
}

function TaskList({
  tasks,
  sourceMap,
  statusMap,
  sortedStatuses,
  onOpen,
  canDelete,
  onDelete,
  deleting,
}: {
  tasks: Task[];
  sourceMap: Map<string, TaskSource>;
  statusMap: Map<string, Status>;
  sortedStatuses: Status[];
  onOpen: (t: Task) => void;
  canDelete: (t: Task) => boolean;
  onDelete: (t: Task) => void;
  deleting: string | null;
}) {
  const statusTone = (s: Status | undefined) => {
    if (!s) return "bg-muted text-muted-foreground";
    if (s.is_done_state) return "bg-[hsl(var(--muted-foreground))] text-background";
    const idx = sortedStatuses.findIndex((x) => x.id === s.id);
    if (idx === 0) return "bg-primary text-primary-foreground";
    if (idx === 1) return "bg-accent text-accent-foreground";
    return "bg-[hsl(var(--muted-foreground))] text-background";
  };
  return (
    <div className="space-y-2">
      {tasks.map((t) => {
        const status = statusMap.get(t.status_id);
        const overdue =
          t.due_date &&
          new Date(t.due_date) < new Date(new Date().toDateString()) &&
          t.progress < 100;
        const src = sourceMap.get(t.id);
        const removable = canDelete(t);
        return (
          <Card
            key={t.id}
            className="group cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => onOpen(t)}
          >
            <CardContent className="p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate flex items-center gap-2">
                  <span className="truncate">{t.title}</span>
                  {src && <TaskSourceBadge source={src} />}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                  {status ? (
                    <Badge className={`text-[11.5px] ${statusTone(status)}`}>{status.name}</Badge>
                  ) : (
                    <span>—</span>
                  )}
                  {t.due_date && (
                    <span className={overdue ? "text-destructive font-medium" : ""}>
                      期限 {new Date(t.due_date).toLocaleDateString("zh-TW")}
                    </span>
                  )}
                </div>
              </div>
              <div className="w-32 hidden md:block">
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${t.progress}%` }}
                  />
                </div>
                <div className="text-[11.5px] text-muted-foreground mt-0.5 text-right">
                  {t.progress}%
                </div>
              </div>
              <Badge className={`text-[11.5px] ${PRIORITY_COLOR[t.priority]}`} variant="secondary">
                {PRIORITY_LABEL[t.priority]}
              </Badge>
              {removable && (
                <button
                  type="button"
                  title="刪除任務"
                  disabled={deleting === t.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(t);
                  }}
                  className="p-1.5 rounded-md text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0 disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
