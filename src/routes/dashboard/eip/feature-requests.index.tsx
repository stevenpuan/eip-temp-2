import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Lightbulb, Search, Pencil, Trash2, Download } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { exportToExcel } from "@/lib/eip-export";
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
import { supabase } from "@/integrations/supabase/client";
import { supabase as supabaseAny } from "@/lib/supabase";
import { useEipUser } from "@/lib/eip-user";
import { useAllUsers } from "@/hooks/useUsers";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Database } from "@/integrations/supabase/types";
import { humanizeError } from "@/lib/eip-error";

export const Route = createFileRoute("/dashboard/eip/feature-requests/")({
  component: FeatureRequestsPage,
});

type FeatureRequest =
  Database["public"]["Tables"]["eip_feature_request"]["Row"];
type AppUser = Database["public"]["Tables"]["app_user"]["Row"];

const STATUS_LABEL: Record<string, string> = {
  pending: "待處理",
  evaluating: "評估中",
  preparing: "準備中",
  in_progress: "進行中",
  done: "已完成",
  rejected: "不採用",
};
const STATUS_ORDER = [
  "pending",
  "evaluating",
  "preparing",
  "in_progress",
  "done",
  "rejected",
];
const STATUS_COLOR: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700",
  evaluating: "bg-violet-100 text-violet-700",
  preparing: "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-700",
  done: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
};

const MONTHLY_QUOTA = 30;


function FeatureRequestsPage() {
  const qc = useQueryClient();
  const { appUser } = useEipUser();
  const { can } = useAuth();
  const canManage = can("eip_feature_pool", "edit");
  const canExport = can("eip_feature_pool", "export");

  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [excludeDone, setExcludeDone] = useState(false);
  const [excludeRejected, setExcludeRejected] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["eip", "feature-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eip_feature_request")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as FeatureRequest[];
    },
  });

  // 顯示對照用：含已停用者，保留離職同仁的提交紀錄姓名
  const usersQ = useAllUsers();
  const userMap = useMemo(
    () => new Map((usersQ.data ?? []).map((u) => [u.id, u])),
    [usersQ.data],
  );

  const now = new Date();
  const monthlyUsed = useMemo(() => {
    const y = now.getFullYear();
    const m = now.getMonth();
    return (listQ.data ?? [])
      .filter((r) => {
        const d = new Date(r.created_at);
        return d.getFullYear() === y && d.getMonth() === m;
      })
      .reduce((sum, r) => sum + (r.points_cost ?? 0), 0);
  }, [listQ.data]);
  const remaining = Math.max(0, MONTHLY_QUOTA - monthlyUsed);
  const period = `${now.getFullYear()}/${now.getMonth() + 1}`;

  const rows = listQ.data ?? [];

  const stats = useMemo(() => {
    const pendingSet = ["pending", "evaluating", "preparing", "in_progress"];
    const processingSet = ["evaluating", "preparing", "in_progress"];
    const pending = rows.filter((r) => pendingSet.includes(r.status)).length;
    const done = rows.filter((r) => r.status === "done").length;
    const processing = rows.filter((r) =>
      processingSet.includes(r.status),
    ).length;
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recent = rows.filter(
      (r) => r.completed_at && new Date(r.completed_at).getTime() >= cutoff,
    );
    const avg =
      recent.length === 0
        ? 0
        : recent.reduce((s, r) => {
            const d =
              (new Date(r.completed_at!).getTime() -
                new Date(r.created_at).getTime()) /
              (24 * 60 * 60 * 1000);
            return s + d;
          }, 0) / recent.length;
    return { pending, done, processing, avg };
  }, [rows]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (excludeDone && r.status === "done") return false;
      if (excludeRejected && r.status === "rejected") return false;
      if (kw) {
        const sub = r.submitter_id
          ? userMap.get(r.submitter_id)?.name ?? ""
          : "";
        const hay = `${r.title} ${r.area ?? ""} ${sub}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [rows, keyword, statusFilter, excludeDone, excludeRejected, userMap]);

  const updateStatus = async (id: string, status: string) => {
    const patch: Database["public"]["Tables"]["eip_feature_request"]["Update"] =
      { status };
    if (status === "done") patch.completed_at = new Date().toISOString();
    const { error } = await supabase
      .from("eip_feature_request")
      .update(patch)
      .eq("id", id);
    if (error) {
      toast.error(humanizeError(error, "更新狀態"));
    } else {
      toast.success("狀態已更新");
      qc.invalidateQueries({ queryKey: ["eip", "feature-requests"] });
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    // eip_feature_request 掛了 BEFORE DELETE 的軟刪除 guard，.delete() 的 ROW_COUNT
    // 一律 0、error 一律 null，所以原本無論有沒有權限都跳「已刪除需求」。
    // 改走 eip_soft_delete RPC，靠回傳的 {ok, reason} 如實回報。
    const { data, error } = await supabaseAny.rpc("eip_soft_delete", {
      p_module: "eip_feature_requests",
      p_id: deleteId,
    });
    if (error) {
      toast.error(humanizeError(error, "刪除"));
    } else if ((data as { ok?: boolean; reason?: string } | null)?.ok !== true) {
      toast.error(
        (data as { reason?: string } | null)?.reason
          ?? "刪除失敗：僅提交者本人或管理者可刪除這筆需求",
      );
    } else {
      toast.success("已刪除需求");
      qc.invalidateQueries({ queryKey: ["eip", "feature-requests"] });
    }
    setDeleteId(null);
  };

  if (listQ.isLoading)
    return <div className="text-muted-foreground py-8">載入中…</div>;

  return (
    <div className="space-y-4">
      <PageHeader
        title="需求許願池"
        description="提出系統功能新增或修改的需求"
        actions={
          <div className="flex items-center gap-2">
            {canExport && (
              <Button variant="outline" onClick={() => exportToExcel({
                filename: "需求許願池", sheetName: "需求", rows: filtered,
                columns: [
                  { header: "標題", key: "title" },
                  { header: "應用範圍", key: "scope", map: (r) => r.scope ?? "" },
                  { header: "需求類型", key: "request_type", map: (r) => r.request_type ?? "" },
                  { header: "區塊", key: "area", map: (r) => r.area ?? "" },
                  { header: "點數", key: "points_cost" },
                  { header: "狀態", key: "status", map: (r) => STATUS_LABEL[r.status] ?? r.status },
                  { header: "提交者", key: "submitter_id", map: (r) => r.submitter_id ? userMap.get(r.submitter_id)?.name ?? "" : "" },
                  { header: "建立時間", key: "created_at", map: (r) => new Date(r.created_at).toLocaleString("zh-TW") },
                  { header: "完成時間", key: "completed_at", map: (r) => r.completed_at ? new Date(r.completed_at).toLocaleString("zh-TW") : "" },
                ],
              })}>
                <Download className="w-4 h-4" /> 匯出 Excel
              </Button>
            )}
            {appUser && (
              <Button asChild>
                <Link to="/dashboard/eip/feature-requests/new">
                  <Plus className="w-4 h-4" />
                  新增需求
                </Link>
              </Button>
            )}
          </div>
        }
      />

      <Card>
        <CardContent className="p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-md bg-amber-100 text-amber-700 flex items-center justify-center">
            <Lightbulb className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="text-xs text-muted-foreground">
              本月許願點數({period})
            </div>
            <div className="text-sm">
              剩{" "}
              <span className="font-semibold text-foreground">{remaining}</span>{" "}
              / {MONTHLY_QUOTA} 點
              <span className="text-muted-foreground ml-2">
                (已用 {monthlyUsed})
              </span>
            </div>
          </div>
          <div className="w-48 h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-amber-500"
              style={{
                width: `${Math.min(100, (monthlyUsed / MONTHLY_QUOTA) * 100)}%`,
              }}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="待處理" value={stats.pending} tone="slate" />
        <StatCard label="已完成" value={stats.done} tone="emerald" />
        <StatCard label="進行中評估" value={stats.processing} tone="amber" />
        <StatCard
          label="平均處理時長(近 30 天)"
          value={stats.avg > 0 ? `${stats.avg.toFixed(1)} 天` : "—"}
          tone="violet"
        />
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜尋標題 / 區塊 / 提交者"
                className="pl-8"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={excludeDone}
                onCheckedChange={(v) => setExcludeDone(Boolean(v))}
              />
              排除已完成
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={excludeRejected}
                onCheckedChange={(v) => setExcludeRejected(Boolean(v))}
              />
              排除不採用
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip
              label="全部"
              active={statusFilter === "all"}
              onClick={() => setStatusFilter("all")}
            />
            {STATUS_ORDER.map((s) => (
              <FilterChip
                key={s}
                label={STATUS_LABEL[s]}
                active={statusFilter === s}
                onClick={() => setStatusFilter(s)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>標題</TableHead>
                <TableHead className="w-24">應用範圍</TableHead>
                <TableHead className="w-28">需求類型</TableHead>
                <TableHead className="w-32">區塊</TableHead>
                <TableHead className="w-16 text-center">點數</TableHead>
                <TableHead className="w-36">狀態</TableHead>
                <TableHead className="w-28">提交者</TableHead>
                <TableHead className="w-40">建立時間</TableHead>
                <TableHead className="w-24 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium text-sm">
                    <Link
                      to="/dashboard/eip/feature-requests/$id"
                      params={{ id: r.id }}
                      className="hover:text-primary hover:underline"
                    >
                      {r.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{r.scope ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {r.request_type ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">{r.area ?? "—"}</TableCell>
                  <TableCell className="text-center text-sm">
                    {r.points_cost}
                  </TableCell>
                  <TableCell>
                    {canManage ? (
                      <Select
                        value={r.status}
                        onValueChange={(v) => updateStatus(r.id, v)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_ORDER.map((k) => (
                            <SelectItem key={k} value={k}>
                              {STATUS_LABEL[k]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge
                        variant="secondary"
                        className={`text-[12.5px] ${STATUS_COLOR[r.status] ?? ""}`}
                      >
                        {STATUS_LABEL[r.status] ?? r.status}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.submitter_id
                      ? (userMap.get(r.submitter_id)?.name ?? "—")
                      : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("zh-TW")}
                  </TableCell>
                  <TableCell className="text-right">
                    {(canManage || (appUser && r.submitter_id === appUser.id)) ? (
                      <div className="flex justify-end gap-1">
                        <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                          <Link
                            to="/dashboard/eip/feature-requests/$id/edit"
                            params={{ id: r.id }}
                          >
                            <Pencil className="w-4 h-4" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteId(r.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-12 text-center">
                    <div className="space-y-3">
                      <div className="text-sm text-muted-foreground">
                        目前沒有需求,點「新增需求」提出第一個想法。
                      </div>
                      {appUser && (
                        <Button size="sm" asChild>
                          <Link to="/dashboard/eip/feature-requests/new">
                            <Plus className="w-4 h-4" /> 新增需求
                          </Link>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定刪除此需求?</AlertDialogTitle>
            <AlertDialogDescription>刪除後將無法復原。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              刪除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: "slate" | "emerald" | "amber" | "violet";
}) {
  const toneMap: Record<string, string> = {
    slate: "text-slate-700",
    emerald: "text-emerald-700",
    amber: "text-amber-700",
    violet: "text-violet-700",
  };
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold mt-1 ${toneMap[tone]}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs border transition ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background hover:bg-muted border-border text-muted-foreground"
      }`}
    >
      {label}
    </button>
  );
}
