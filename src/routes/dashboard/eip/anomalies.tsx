import { EipUserPending } from "@/components/eip/EipUserPending";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldAlert, Inbox, Paperclip, Trash2, Plus, Download } from "lucide-react";

// eip_anomaly / eip_anomaly_attachment 尚未進 src/integrations/supabase/types.ts，
// 這裡用 any 形式的 client，型別在本檔自行宣告。
import { supabase } from "@/lib/supabase";
import { exportToExcel } from "@/lib/eip-export";
import { useAuth } from "@/lib/auth";
import { useEipUser } from "@/lib/eip-user";
import { useActiveUsers, useAllUsers } from "@/hooks/useUsers";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UrlLinks } from "@/components/eip/UrlLinks";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { humanizeError } from "@/lib/eip-error";

// 2026-08-17 依客戶要求隱藏「獨立網址／NAS 連結」欄；網址請直接貼在說明／執行內容欄。
// 既有連結資料保留於資料庫不刪，要恢復顯示只需把下方旗標改為 true。
const SHOW_URL_LINK_FIELD = false;

export const Route = createFileRoute("/dashboard/eip/anomalies")({
  component: AnomaliesPage,
});

/* ---------- 型別與文案 ---------- */

type Anomaly = {
  id: string;
  code: string | null;
  source: "self" | "supervisor" | string;
  subject_id: string;
  department_id: string | null;
  raised_by: string | null;
  raised_at: string;
  title: string;
  detail: string | null;
  severity: string;
  occurred_on: string | null;
  amount: number | string | null;
  fill_due_date: string | null;
  filled_at: string | null;
  filled_by: string | null;
  cause: string | null;
  action_taken: string | null;
  prevention: string | null;
  status: "pending_fill" | "filled" | "improving" | "closed" | "void" | string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  confirm_note: string | null;
  improve_due_date: string | null;
  closed_by: string | null;
  closed_at: string | null;
  close_note: string | null;
  void_reason: string | null;
};

// eip_anomaly_weekly_kpi 的回傳（含追加需求的 unfilled＝待填報件數）
type KpiRow = {
  department_id: string | null;
  department_name: string | null;
  total: number;
  unfilled: number;
  filled: number;
  improving: number;
  closed: number;
  voided: number;
  overdue_unfilled: number;
  total_amount: number | string | null;
  avg_close_days: number | string | null;
};

type Att = {
  id: string;
  anomaly_id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  file_size: number | null;
  uploaded_by: string | null;
};

/** eip_deleted_items RPC 回傳（回收區用，通用結構，與 quick-reports 一致） */
type DeletedItem = {
  module_key: string;
  label: string;
  item_id: string;
  title: string | null;
  deleted_at: string;
  deleted_by_name: string | null;
  can_purge: boolean;
  purge_block: string | null;
};

const STATUS_TABS = [
  { value: "pending_fill", label: "待填報" },
  { value: "filled", label: "待確認" },
  { value: "improving", label: "改善中" },
  { value: "closed", label: "已結案" },
  { value: "void", label: "已作廢" },
] as const;

const STATUS_LABEL: Record<string, string> = {
  pending_fill: "待填報",
  filled: "待確認",
  improving: "改善中",
  closed: "已結案",
  void: "已作廢",
};
const STATUS_COLOR: Record<string, string> = {
  pending_fill: "bg-rose-100 text-rose-700 border-rose-300",
  filled: "bg-amber-100 text-amber-700 border-amber-300",
  improving: "bg-blue-100 text-blue-700 border-blue-300",
  closed: "bg-emerald-100 text-emerald-700 border-emerald-300",
  void: "bg-slate-100 text-slate-600 border-slate-300",
};

const SEVERITY_LABEL: Record<string, string> = {
  low: "輕微",
  normal: "一般",
  high: "重大",
  critical: "嚴重",
};
const SEVERITY_COLOR: Record<string, string> = {
  low: "bg-slate-100 text-slate-600 border-slate-300",
  normal: "bg-slate-100 text-slate-700 border-slate-300",
  high: "bg-orange-100 text-orange-700 border-orange-300",
  critical: "bg-rose-100 text-rose-700 border-rose-300",
};

const SOURCE_LABEL: Record<string, string> = {
  supervisor: "主管開立",
  self: "自主填報",
};

const todayTW = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD
const fmtDateTime = (iso: string | null) =>
  !iso
    ? "—"
    : new Date(iso).toLocaleString("zh-TW", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
// 匯出的日期欄位只要日期。走 toLocaleDateString 是因為 toISOString() 在 UTC+8
// 的深夜時段會把日期退回前一天，帳面上會變成「結案日比開立日還早」。
const fmtDateOnly = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("sv-SE") : "");
const fmtSize = (n?: number | null) =>
  !n
    ? ""
    : n < 1024
      ? `${n}B`
      : n < 1048576
        ? `${(n / 1024).toFixed(0)}KB`
        : `${(n / 1048576).toFixed(1)}MB`;

/* ---------- 主頁面 ---------- */

function AnomaliesPage() {
  const qc = useQueryClient();
  const { loading: authLoading, permsLoaded, can } = useAuth();
  const { appUser } = useEipUser();

  const canView = can("eip_anomaly", "view");
  const canCreate = can("eip_anomaly", "create");
  const canExport = can("eip_anomaly", "export");

  const [tab, setTab] = useState<string>("pending_fill");
  const [keyword, setKeyword] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [openRow, setOpenRow] = useState<Anomaly | null>(null);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false); // 回收區檢視切換

  // 顯示對照用：含停用者，否則離職同仁的歷史缺失姓名會變空白
  const allUsersQ = useAllUsers();
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    (allUsersQ.data ?? []).forEach((u) => m.set(u.id, u.name ?? "—"));
    return (id: string | null) => (id ? (m.get(id) ?? "—") : "—");
  }, [allUsersQ.data]);

  // 只影響「動作按鈕要不要顯示」；真正的授權以 RLS 為準
  const supervisedQ = useQuery({
    queryKey: ["eip", "my-supervised-depts"],
    enabled: !!appUser,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("eip_my_supervised_departments");
      if (error) throw error;
      return new Set(((data ?? []) as { department_id: string }[]).map((r) => r.department_id));
    },
  });
  const isAdmin = can("eip_anomaly", "delete"); // admin/manager/dept_manager 才有刪除權
  const canManageRow = (r: Anomaly) =>
    isAdmin || (!!r.department_id && !!supervisedQ.data?.has(r.department_id));
  // 刪除（軟刪除→回收區）：對齊 RLS anomaly_delete —— 只有開立者本人或系統管理者(company_admin)可刪。
  // 不對齊 canManageRow（部門主管）是因為 RLS 不讓非開立者的主管刪別人的缺失，會回 ok=false。
  const canDeleteRow = (r: Anomaly) =>
    r.raised_by === appUser?.id || appUser?.role === "company_admin";

  // 能不能替別人開立缺失。一般同仁只會看到「填報異常」入口，
  // 不會看到選當事人的欄位 —— 之前的做法是大家都看到「開立缺失」，
  // 選了別人才被 RLS 擋下來，那是把授權錯誤當成 UI。
  const canRaiseForOthers = isAdmin || (supervisedQ.data?.size ?? 0) > 0;

  // RLS 已限定可見範圍（本人／開立者／部門主管／管理者），前端不再過濾人
  const listQ = useQuery({
    queryKey: ["eip", "anomalies", tab],
    enabled: !!appUser && canView,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eip_anomaly")
        .select("*")
        .eq("status", tab)
        .order("raised_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Anomaly[];
    },
  });

  const rows = useMemo(() => {
    const all = listQ.data ?? [];
    return all.filter((r) => {
      if (mineOnly && appUser && r.subject_id !== appUser.id) return false;
      if (keyword) {
        const kw = keyword.toLowerCase();
        const hay =
          `${r.code ?? ""} ${r.title} ${r.detail ?? ""} ${nameOf(r.subject_id)}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [listQ.data, mineOnly, keyword, appUser, nameOf]);

  // 缺失資料列只帶 department_id，匯出要印中文部門名稱才另外查一次。
  // 沒有匯出權限的人不需要這份對照，就不發這個請求。
  const deptsQ = useQuery({
    queryKey: ["eip", "departments"],
    enabled: !!appUser && canView && canExport,
    queryFn: async () => {
      const { data, error } = await supabase.from("department").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string | null }[];
    },
  });
  const deptNameOf = useMemo(() => {
    const m = new Map<string, string>();
    (deptsQ.data ?? []).forEach((d) => m.set(d.id, d.name ?? ""));
    return (id: string | null) => (id ? (m.get(id) ?? "") : "");
  }, [deptsQ.data]);

  const handleExport = () => {
    // 清單本身還沒好就不能說「沒有資料」，那會被當成真的一筆都沒有
    if (listQ.isLoading) {
      toast.info("清單還在載入，請稍候再匯出");
      return;
    }
    if (listQ.isError) {
      toast.error("清單載入失敗，無法匯出");
      return;
    }
    // 匯出的是畫面上這份清單（狀態分頁 + 只看我的 + 關鍵字），不是整個資料表
    if (rows.length === 0) {
      toast.info("目前篩選條件下沒有資料可匯出");
      return;
    }
    // 對照表載入失敗時照樣匯出，但要講明白哪一欄會空白，
    // 否則使用者會把空白的部門／姓名當成資料本身就沒填。
    if (deptsQ.isError) toast.warning("部門對照載入失敗，匯出檔的「部門」欄會留空");
    if (allUsersQ.isError) toast.warning("人員對照載入失敗，匯出檔的姓名欄會留空");

    exportToExcel({
      filename: `EIP異常缺失_${STATUS_LABEL[tab] ?? tab}`,
      sheetName: STATUS_LABEL[tab] ?? "異常缺失",
      rows,
      columns: [
        { header: "單號", key: "code", map: (r) => r.code ?? "" },
        { header: "開立日期", key: "raised_at", map: (r) => fmtDateOnly(r.raised_at) },
        { header: "發生日期", key: "occurred_on", map: (r) => r.occurred_on ?? "" },
        { header: "當事人", key: "subject_id", map: (r) => nameOf(r.subject_id) },
        { header: "部門", key: "department_id", map: (r) => deptNameOf(r.department_id) },
        { header: "標題", key: "title" },
        {
          header: "嚴重程度",
          key: "severity",
          map: (r) => SEVERITY_LABEL[r.severity] ?? r.severity,
        },
        { header: "狀態", key: "status", map: (r) => STATUS_LABEL[r.status] ?? r.status },
        // 未填金額留空，不要寫 0 —— 0 元異常和「不適用」是兩件事
        { header: "金額", key: "amount", map: (r) => (r.amount == null ? "" : Number(r.amount)) },
        { header: "填報期限", key: "fill_due_date", map: (r) => r.fill_due_date ?? "" },
        { header: "檢討原因", key: "cause", map: (r) => r.cause ?? "" },
        { header: "改善對策", key: "action_taken", map: (r) => r.action_taken ?? "" },
        { header: "預防再發", key: "prevention", map: (r) => r.prevention ?? "" },
        // 還沒確認就留空白，不要沿用畫面上的破折號
        {
          header: "確認人",
          key: "confirmed_by",
          map: (r) => (r.confirmed_by ? nameOf(r.confirmed_by) : ""),
        },
        { header: "結案日", key: "closed_at", map: (r) => fmtDateOnly(r.closed_at) },
      ],
    });
  };

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["eip", "anomalies"] });
    void qc.invalidateQueries({ queryKey: ["eip", "anomaly-kpi"] });
  };

  // 軟刪除：走 eip_soft_delete RPC（BEFORE DELETE 觸發器攔截、設 deleted_at，由 anomaly_delete RLS 把關）。
  // 不能直接 UPDATE deleted_at —— 會被 UPDATE 政策的 WITH CHECK 擋掉。RPC 回 { ok, reason? }。
  const handleSoftDelete = async (r: Anomaly) => {
    if (deletingId) return;
    if (!window.confirm(`確定刪除「${r.title}」（${r.code ?? ""}）？\n刪除後會移至回收區，可由管理者還原。`)) return;
    setDeletingId(r.id);
    const { data, error } = await supabase.rpc("eip_soft_delete", {
      p_module: "eip_anomaly",
      p_id: r.id,
    });
    setDeletingId(null);
    if (error) {
      toast.error(humanizeError(error, "刪除"));
      return;
    }
    const res = data as { ok?: boolean; reason?: string } | null;
    if (res && res.ok === false) {
      toast.error(`刪除失敗：${res.reason ?? "只有開立者本人或系統管理者可刪除"}`);
      return;
    }
    toast.success("已刪除，已移至回收區");
    setOpenRow(null);
    refresh();
  };

  // 回收區（已刪除）：走 SECURITY DEFINER 的 eip_deleted_items，RLS 已把軟刪除列隱形。
  const deletedQ = useQuery({
    queryKey: ["eip", "anomalies-deleted"],
    enabled: !!appUser && canView,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("eip_deleted_items", { p_module: "eip_anomaly" });
      if (error) throw error;
      return (data ?? []) as DeletedItem[];
    },
  });
  const deletedRows = deletedQ.data ?? [];

  const restoreAnomaly = async (item: DeletedItem) => {
    const { error } = await supabase.rpc("eip_restore_deleted", {
      p_module: "eip_anomaly",
      p_id: item.item_id,
    });
    if (error) return toast.error(humanizeError(error, "還原"));
    toast.success("已還原");
    void deletedQ.refetch();
    refresh();
  };

  const purgeAnomaly = async (item: DeletedItem) => {
    if (!window.confirm(`永久刪除「${item.title ?? ""}」？\n此動作無法復原。`)) return;
    const { error } = await supabase.rpc("eip_purge_deleted", {
      p_module: "eip_anomaly",
      p_id: item.item_id,
    });
    if (error) return toast.error(humanizeError(error, "永久刪除"));
    toast.success("已永久刪除");
    void deletedQ.refetch();
  };

  if (authLoading || !permsLoaded) return <div className="text-muted-foreground py-8">載入中…</div>;
  if (!canView) return <Navigate to="/dashboard/eip/my-tasks" replace />;
  if (!appUser) return <EipUserPending />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="異常缺失"
        description="主管開立缺失後會立即通知當事人並要求限期填報；填報完成由主管「確認並追蹤改善」，改善完成後結案。同仁也可以自己主動填報。"
        actions={
          canExport ? (
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="w-4 h-4 mr-1" />
              匯出 Excel
            </Button>
          ) : undefined
        }
      />

      <KpiCards canSeeKpi={isAdmin} />

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            {STATUS_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
                {t.value === tab && rows.length > 0 && (
                  <span className="ml-1.5 text-xs text-muted-foreground">{rows.length}</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex-1" />

        <Button
          variant={mineOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setMineOnly((v) => !v)}
        >
          只看我的
        </Button>
        <Input
          placeholder="搜尋單號 / 標題 / 當事人"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="w-56"
        />
        {canCreate && (
          <Button size="sm" onClick={() => setRaiseOpen(true)}>
            <Plus className="w-4 h-4 mr-1" />
            {canRaiseForOthers ? "開立缺失" : "填報異常"}
          </Button>
        )}
        <Button
          variant={showDeleted ? "default" : "outline"}
          size="sm"
          onClick={() => setShowDeleted((v) => !v)}
        >
          {showDeleted ? "← 返回清單" : `回收區${deletedRows.length ? ` (${deletedRows.length})` : ""}`}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {showDeleted ? (
            <DeletedList
              q={deletedQ}
              rows={deletedRows}
              onRestore={(d) => void restoreAnomaly(d)}
              onPurge={(d) => void purgeAnomaly(d)}
            />
          ) : listQ.isLoading ? (
            <div className="text-sm text-muted-foreground text-center py-10">載入中…</div>
          ) : listQ.isError ? (
            <div className="text-sm text-center py-10">
              <div className="text-destructive mb-2">載入失敗</div>
              <Button size="sm" variant="outline" onClick={() => listQ.refetch()}>
                重試
              </Button>
            </div>
          ) : !rows.length ? (
            <EmptyState tab={tab} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">單號</TableHead>
                  <TableHead className="w-24">來源</TableHead>
                  <TableHead>項目</TableHead>
                  <TableHead className="w-24">當事人</TableHead>
                  <TableHead className="w-20">程度</TableHead>
                  <TableHead className="w-28">期限</TableHead>
                  <TableHead className="w-40 text-right">動作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.code ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {SOURCE_LABEL[r.source] ?? r.source}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <button
                        className="text-left font-medium hover:underline"
                        onClick={() => setOpenRow(r)}
                      >
                        {r.title}
                      </button>
                      <div className="text-xs text-muted-foreground">
                        {nameOf(r.raised_by)} 於 {fmtDateTime(r.raised_at)} 開立
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{nameOf(r.subject_id)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={SEVERITY_COLOR[r.severity] ?? ""}>
                        {SEVERITY_LABEL[r.severity] ?? r.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      <DueCell row={r} />
                    </TableCell>
                    <TableCell className="text-right">
                      <RowActions
                        row={r}
                        meId={appUser.id}
                        canManage={canManageRow(r)}
                        canDelete={canDeleteRow(r)}
                        deleting={deletingId === r.id}
                        onDelete={() => void handleSoftDelete(r)}
                        onOpen={() => setOpenRow(r)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {openRow && (
        <DetailDialog
          row={openRow}
          meId={appUser.id}
          canManage={canManageRow(openRow)}
          canDelete={canDeleteRow(openRow)}
          nameOf={nameOf}
          onClose={() => setOpenRow(null)}
          onChanged={() => {
            refresh();
            setOpenRow(null);
          }}
        />
      )}

      {raiseOpen && (
        <RaiseDialog
          canRaiseForOthers={canRaiseForOthers}
          onClose={() => setRaiseOpen(false)}
          onCreated={(selfReport) => {
            refresh();
            setRaiseOpen(false);
            // 自主填報在 DB 端直接是 filled（見 eip_fill_anomaly_defaults），
            // 一律切到 pending_fill 會讓人在「待填報」找不到剛送出的那筆而重複填報。
            setTab(selfReport ? "filled" : "pending_fill");
          }}
        />
      )}
    </div>
  );
}

/* ---------- 期限顯示 ---------- */

function DueCell({ row }: { row: Anomaly }) {
  const today = todayTW();
  if (row.status === "pending_fill" && row.fill_due_date) {
    const late = row.fill_due_date < today;
    return (
      <span className={late ? "text-destructive font-medium" : ""}>
        填報 {row.fill_due_date.slice(5)}
        {late && "（逾期）"}
      </span>
    );
  }
  if (row.status === "improving" && row.improve_due_date) {
    const late = row.improve_due_date < today;
    return (
      <span className={late ? "text-destructive font-medium" : ""}>
        改善 {row.improve_due_date.slice(5)}
        {late && "（逾期）"}
      </span>
    );
  }
  if (row.status === "closed" && row.closed_at) {
    return <span className="text-muted-foreground">{fmtDateTime(row.closed_at)}</span>;
  }
  return <span className="text-muted-foreground">—</span>;
}

/* ---------- 列動作 ---------- */

function RowActions({
  row,
  meId,
  canManage,
  canDelete,
  deleting,
  onDelete,
  onOpen,
}: {
  row: Anomaly;
  meId: string;
  canManage: boolean;
  canDelete: boolean;
  deleting: boolean;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const isSubject = row.subject_id === meId;
  let label: string | null = null;
  if (isSubject && row.status === "pending_fill") label = "填報";
  else if (canManage && row.status === "filled") label = "確認";
  else if (canManage && row.status === "improving") label = "結案";

  return (
    <div className="flex items-center justify-end gap-1.5">
      {label && (
        <Button size="sm" onClick={onOpen}>
          {label}
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={onOpen}>
        詳情
      </Button>
      {canDelete && (
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          disabled={deleting}
          title="刪除（移至回收區）"
          onClick={onDelete}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  );
}

/* ---------- KPI 卡片（含追加需求的「未填寫」） ---------- */

function KpiCards({ canSeeKpi }: { canSeeKpi: boolean }) {
  const [days, setDays] = useState("7");

  const kpiQ = useQuery({
    queryKey: ["eip", "anomaly-kpi", days],
    enabled: canSeeKpi,
    queryFn: async () => {
      const to = todayTW();
      const from = new Date(Date.now() - Number(days) * 86400000).toLocaleDateString("sv-SE");
      const { data, error } = await supabase.rpc("eip_anomaly_weekly_kpi", {
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return (data ?? []) as KpiRow[];
    },
  });

  if (!canSeeKpi) return null;

  const sum = (k: keyof KpiRow) => (kpiQ.data ?? []).reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const amount = (kpiQ.data ?? []).reduce((a, r) => a + Number(r.total_amount ?? 0), 0);

  const cards = [
    { label: "總件數", v: sum("total"), tone: "" },
    { label: "未填寫", v: sum("unfilled"), tone: "text-rose-600" },
    { label: "逾期未填", v: sum("overdue_unfilled"), tone: "text-destructive" },
    { label: "待確認", v: sum("filled"), tone: "text-amber-600" },
    { label: "改善中", v: sum("improving"), tone: "text-blue-600" },
    { label: "已結案", v: sum("closed"), tone: "text-emerald-600" },
  ];

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">彙整</span>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-28 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">近 7 天</SelectItem>
              <SelectItem value="30">近 30 天</SelectItem>
              <SelectItem value="90">近 90 天</SelectItem>
            </SelectContent>
          </Select>
          {amount > 0 && (
            <span className="text-xs text-muted-foreground ml-2">
              異常金額合計 {amount.toLocaleString("zh-TW")} 元
            </span>
          )}
        </div>
        {kpiQ.isLoading ? (
          <div className="text-xs text-muted-foreground">載入中…</div>
        ) : kpiQ.isError ? (
          // 沒有這個分支的話 sum() 會把失敗算成 0，主管會誤判「本週沒有異常」
          <div className="text-xs flex items-center gap-2">
            <span className="text-destructive">彙整載入失敗，數字不可信</span>
            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => void kpiQ.refetch()}>
              重試
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {cards.map((c) => (
              <div key={c.label} className="rounded-md border px-3 py-2">
                <div className="text-xs text-muted-foreground">{c.label}</div>
                <div className={`text-xl font-semibold ${c.tone}`}>{c.v}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------- 開立缺失（主管） ---------- */

function RaiseDialog({
  canRaiseForOthers,
  onClose,
  onCreated,
}: {
  canRaiseForOthers: boolean;
  onClose: () => void;
  onCreated: (selfReport: boolean) => void;
}) {
  const { appUser } = useEipUser();
  // 選人一律用只含在職者的版本
  const usersQ = useActiveUsers();

  const [subjectId, setSubjectId] = useState("");
  // 不能替別人開立的人，一律鎖成自主填報，也不顯示切換
  const [selfReport, setSelfReport] = useState(!canRaiseForOthers);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [severity, setSeverity] = useState("normal");
  const [occurredOn, setOccurredOn] = useState(todayTW());
  const [amount, setAmount] = useState("");
  const [fillDue, setFillDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  const effectiveSubject = selfReport ? (appUser?.id ?? "") : subjectId;

  const submit = async () => {
    if (!effectiveSubject) return toast.error("請選擇當事人");
    if (!title.trim()) return toast.error("請填寫項目標題");
    setBusy(true);

    const payload: Record<string, unknown> = {
      source: selfReport ? "self" : "supervisor",
      subject_id: effectiveSubject,
      title: title.trim(),
      detail: detail.trim() || null,
      severity,
      occurred_on: occurredOn || null,
      amount: amount.trim() === "" ? null : Number(amount),
    };
    // 不填就由 DB 補「開立日 + 3 天」，不要在前端算
    if (!selfReport && fillDue) payload.fill_due_date = fillDue;

    const { data, error } = await supabase
      .from("eip_anomaly")
      .insert(payload)
      .select("id")
      .maybeSingle();

    if (error) {
      setBusy(false);
      toast.error(humanizeError(error, "開立"));
      return;
    }

    const newId = (data as { id: string } | null)?.id;
    if (newId && files.length) {
      await uploadFiles(newId, files);
    }
    setBusy(false);
    toast.success(selfReport ? "已送出自主填報" : "已開立缺失，已通知當事人");
    // insert 的 returning 若被 SELECT 政策擋掉，newId 會是 undefined，附件就整批沒上傳。
    // 這種情況一定要講出來，不能只跳成功 toast，否則使用者以為現場照片已經附上去了。
    if (!newId && files.length) {
      toast.warning(`缺失已開立，但 ${files.length} 個附件沒有上傳成功，請開啟詳情重新上傳`);
    }
    onCreated(selfReport);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{selfReport ? "自主填報異常" : "開立異常缺失"}</DialogTitle>
          <DialogDescription>
            {selfReport
              ? "自己主動記錄的異常會直接進入「待確認」，由主管確認後追蹤改善。"
              : "開立後會立即通知當事人（緊急推播），並要求在期限內完成填報。不填期限預設為開立日 + 3 天。"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {canRaiseForOthers && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selfReport}
                onChange={(e) => setSelfReport(e.target.checked)}
              />
              這是我自己要主動填報的異常
            </label>
          )}

          {!selfReport && (
            <div className="space-y-1.5">
              <Label>當事人</Label>
              <Select value={subjectId} onValueChange={setSubjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="選擇同仁" />
                </SelectTrigger>
                <SelectContent>
                  {(usersQ.data ?? []).map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>項目標題</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例：冷藏庫溫度記錄未簽核"
            />
          </div>

          <div className="space-y-1.5">
            <Label>說明</Label>
            <Textarea
              rows={3}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="發生什麼、在哪裡、影響為何"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>嚴重程度</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">輕微</SelectItem>
                  <SelectItem value="normal">一般</SelectItem>
                  <SelectItem value="high">重大</SelectItem>
                  <SelectItem value="critical">嚴重</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>發生日期</Label>
              <Input
                type="date"
                value={occurredOn}
                onChange={(e) => setOccurredOn(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>
                異常金額 <span className="text-xs text-muted-foreground">（選填）</span>
              </Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="不適用可留空"
              />
            </div>
            {!selfReport && (
              <div className="space-y-1.5">
                <Label>
                  填報期限 <span className="text-xs text-muted-foreground">（預設 +3 天）</span>
                </Label>
                <Input type="date" value={fillDue} onChange={(e) => setFillDue(e.target.value)} />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>截圖 / 附件</Label>
            <Input
              type="file"
              multiple
              accept="image/*,.pdf"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            {files.length > 0 && (
              <div className="text-xs text-muted-foreground">
                已選 {files.length} 個檔案：{files.map((f) => f.name).join("、")}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "送出中…" : selfReport ? "送出填報" : "開立並通知"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- 附件上傳（共用） ---------- */

async function uploadFiles(anomalyId: string, files: File[]) {
  let ok = 0;
  for (const f of files) {
    if (f.size > 10 * 1024 * 1024) {
      toast.error(`${f.name} 超過 10MB`);
      continue;
    }
    const path = `${anomalyId}/${crypto.randomUUID()}`;
    const up = await supabase.storage
      .from("anomaly")
      .upload(path, f, { contentType: f.type || undefined, upsert: false });
    if (up.error) {
      toast.error(`${f.name}：${humanizeError(up.error, "上傳")}`);
      continue;
    }
    const ins = await supabase.from("eip_anomaly_attachment").insert({
      anomaly_id: anomalyId,
      file_name: f.name,
      storage_path: path,
      mime_type: f.type || null,
      file_size: f.size,
    });
    if (ins.error) {
      toast.error(`${f.name}：${humanizeError(ins.error, "登錄附件")}`);
      await supabase.storage.from("anomaly").remove([path]);
      continue;
    }
    ok += 1;
  }
  if (ok) toast.success(`已上傳 ${ok} 個檔案`);
}

function Attachments({ anomalyId, canEdit }: { anomalyId: string; canEdit: boolean }) {
  const [list, setList] = useState<Att[]>([]);
  const [busy, setBusy] = useState(false);

  const [loadErr, setLoadErr] = useState<string | null>(null);

  const load = async () => {
    const { data, error } = await supabase
      .from("eip_anomaly_attachment")
      .select("*")
      .eq("anomaly_id", anomalyId)
      .order("created_at");
    // 失敗時不能靜默顯示「尚無附件」——使用者會以為檔案不見了
    if (error) { setLoadErr(humanizeError(error, "附件載入")); return; }
    setLoadErr(null);
    setList((data ?? []) as Att[]);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anomalyId]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (!picked.length) return;
    setBusy(true);
    await uploadFiles(anomalyId, picked);
    setBusy(false);
    e.target.value = "";
    void load();
  };

  const open = async (a: Att) => {
    const { data, error } = await supabase.storage
      .from("anomaly")
      .createSignedUrl(a.storage_path, 60);
    if (error) return toast.error(humanizeError(error, "開啟附件"));
    if (!data?.signedUrl) return toast.error("無法取得檔案連結");
    // 先試開新視窗；被行動瀏覽器攔掉（await 之後開窗常被視為非使用者手勢）
    // 才退回同分頁導轉。原本直接改 location 會把整個 SPA 導走，
    // 看完圖片按上一頁要重載，分頁與篩選全部歸零。
    const w = window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    if (!w) window.location.href = data.signedUrl;
  };

  const remove = async (a: Att) => {
    if (!window.confirm(`刪除「${a.file_name}」？`)) return;
    // 順序很重要：先刪資料列、成功後才刪檔案。
    // 反過來的話 RLS 擋住 delete 時檔案已經沒了、紀錄還在，
    // 清單上留下一筆永遠打不開的附件。
    const { error } = await supabase.from("eip_anomaly_attachment").delete().eq("id", a.id);
    if (error) return toast.error(humanizeError(error, "刪除附件"));
    const rm = await supabase.storage.from("anomaly").remove([a.storage_path]);
    if (rm.error) toast.warning("紀錄已刪除，但實體檔案未刪成功（不影響使用）");
    void load();
  };

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium flex items-center gap-1.5">
        <Paperclip className="w-3.5 h-3.5" />
        截圖 / 附件
      </div>
      {loadErr ? (
        <div className="text-xs flex items-center gap-2">
          <span className="text-destructive">附件載入失敗：{loadErr}</span>
          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => void load()}>重試</Button>
        </div>
      ) : (
        list.length === 0 && <div className="text-xs text-muted-foreground">尚無附件</div>
      )}
      {list.map((a) => (
        <div key={a.id} className="flex items-center gap-2 text-sm">
          <button
            className="hover:underline text-left flex-1 truncate"
            onClick={() => void open(a)}
          >
            {a.file_name}
          </button>
          <span className="text-xs text-muted-foreground">{fmtSize(a.file_size)}</span>
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={() => void remove(a)}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      ))}
      {canEdit && (
        <Input type="file" multiple accept="image/*,.pdf" disabled={busy} onChange={onPick} />
      )}
    </div>
  );
}

/* ---------- 詳情 / 填報 / 確認 / 結案 ---------- */

function DetailDialog({
  row,
  meId,
  canManage,
  canDelete,
  nameOf,
  onClose,
  onChanged,
}: {
  row: Anomaly;
  meId: string;
  canManage: boolean;
  canDelete: boolean;
  nameOf: (id: string | null) => string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const isSubject = row.subject_id === meId;
  const canFill = isSubject && ["pending_fill", "filled", "improving"].includes(row.status);

  const [cause, setCause] = useState(row.cause ?? "");
  const [action, setAction] = useState(row.action_taken ?? "");
  const [prevention, setPrevention] = useState(row.prevention ?? "");
  const [confirmNote, setConfirmNote] = useState(row.confirm_note ?? "");
  const [improveDue, setImproveDue] = useState(row.improve_due_date ?? "");
  const [closeNote, setCloseNote] = useState(row.close_note ?? "");
  const [voidReason, setVoidReason] = useState("");
  const [busy, setBusy] = useState(false);

  const patch = async (payload: Record<string, unknown>, okMsg: string) => {
    setBusy(true);
    const { data, error } = await supabase
      .from("eip_anomaly").update(payload).eq("id", row.id).select("id");
    setBusy(false);
    if (error) return toast.error(humanizeError(error, "更新"));
    // 被 RLS 擋掉時回 0 列而 error 是 null。這支同時負責填報、確認、結案、作廢，
    // 沒有這道檢查就會把「沒寫進去」報成成功。
    if (!data?.length) { onChanged(); return toast.error("更新失敗：沒有權限執行這個動作，或缺失狀態已經被別人變更"); }
    toast.success(okMsg);
    onChanged();
  };

  // 軟刪除（→回收區）：走 eip_soft_delete RPC，由 anomaly_delete RLS 把關（開立者本人或管理者）。
  const softDelete = async () => {
    if (busy) return;
    if (!window.confirm(`確定刪除「${row.title}」（${row.code ?? ""}）？\n刪除後會移至回收區，可由管理者還原。`)) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("eip_soft_delete", {
      p_module: "eip_anomaly",
      p_id: row.id,
    });
    setBusy(false);
    if (error) return toast.error(humanizeError(error, "刪除"));
    const res = data as { ok?: boolean; reason?: string } | null;
    if (res && res.ok === false)
      return toast.error(`刪除失敗：${res.reason ?? "只有開立者本人或系統管理者可刪除"}`);
    toast.success("已刪除，已移至回收區");
    onChanged();
  };

  const submitFill = () => {
    if (!cause.trim() || !action.trim()) {
      toast.error("請至少填寫原因與立即處理方式");
      return;
    }
    void patch(
      {
        cause: cause.trim(),
        action_taken: action.trim(),
        prevention: prevention.trim() || null,
        // 只有從「待填報」才推進狀態；已填報後的補充編輯不重複發通知
        ...(row.status === "pending_fill" ? { status: "filled" } : {}),
      },
      row.status === "pending_fill" ? "已送出填報，已通知主管確認" : "已更新填報內容",
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm text-muted-foreground">{row.code}</span>
            {row.title}
            <Badge variant="outline" className={STATUS_COLOR[row.status] ?? ""}>
              {STATUS_LABEL[row.status] ?? row.status}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {SOURCE_LABEL[row.source] ?? row.source}・當事人 {nameOf(row.subject_id)}・
            {nameOf(row.raised_by)} 於 {fmtDateTime(row.raised_at)} 開立
            {row.occurred_on && `・發生日 ${row.occurred_on}`}
            {row.amount != null && `・金額 ${Number(row.amount).toLocaleString("zh-TW")} 元`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {row.detail && (
            <div>
              <div className="text-sm font-medium mb-1">說明</div>
              <div className="text-sm whitespace-pre-wrap text-muted-foreground">{row.detail}</div>
            </div>
          )}

          <Attachments anomalyId={row.id} canEdit={canFill || canManage} />

          {/* 檔案不一定要上傳進系統；規格書 G 章的「連結」欄位走 eip_url_link */}
          {SHOW_URL_LINK_FIELD && (
            <UrlLinks
              entityType="anomaly"
              entityId={row.id}
              readOnly={!(canFill || canManage)}
              title="檔案／NAS 連結"
            />
          )}

          {/* 填報區（CAPA） */}
          <div className="border-t pt-3 space-y-3">
            <div className="text-sm font-medium">填報內容</div>
            {canFill ? (
              <>
                <div className="space-y-1.5">
                  <Label>發生原因</Label>
                  <Textarea rows={2} value={cause} onChange={(e) => setCause(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>立即處理</Label>
                  <Textarea rows={2} value={action} onChange={(e) => setAction(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>
                    預防再發 <span className="text-xs text-muted-foreground">（選填）</span>
                  </Label>
                  <Textarea
                    rows={2}
                    value={prevention}
                    onChange={(e) => setPrevention(e.target.value)}
                  />
                </div>
                <Button size="sm" onClick={submitFill} disabled={busy}>
                  {row.status === "pending_fill" ? "送出填報" : "更新填報"}
                </Button>
              </>
            ) : (
              <div className="text-sm space-y-2">
                <ReadField label="發生原因" value={row.cause} />
                <ReadField label="立即處理" value={row.action_taken} />
                <ReadField label="預防再發" value={row.prevention} />
                {row.filled_at && (
                  <div className="text-xs text-muted-foreground">
                    {nameOf(row.filled_by)} 於 {fmtDateTime(row.filled_at)} 填報
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 主管動作 */}
          {canManage && row.status === "filled" && (
            <div className="border-t pt-3 space-y-3">
              <div className="text-sm font-medium">確認並追蹤改善</div>
              <div className="space-y-1.5">
                <Label>確認意見</Label>
                <Textarea
                  rows={2}
                  value={confirmNote}
                  onChange={(e) => setConfirmNote(e.target.value)}
                  placeholder="對填報內容的意見、要追蹤的重點"
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  改善期限 <span className="text-xs text-muted-foreground">（選填）</span>
                </Label>
                <Input
                  type="date"
                  value={improveDue}
                  onChange={(e) => setImproveDue(e.target.value)}
                  className="w-48"
                />
              </div>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void patch(
                    {
                      status: "improving",
                      confirm_note: confirmNote.trim() || null,
                      improve_due_date: improveDue || null,
                    },
                    "已確認，進入改善追蹤",
                  )
                }
              >
                確認並追蹤改善
              </Button>
            </div>
          )}

          {canManage && row.status === "improving" && (
            <div className="border-t pt-3 space-y-3">
              <div className="text-sm font-medium">結案</div>
              {row.confirm_note && (
                <div className="text-xs text-muted-foreground">
                  確認意見：{row.confirm_note}
                  {row.improve_due_date && `・改善期限 ${row.improve_due_date}`}
                </div>
              )}
              <div className="space-y-1.5">
                <Label>結案說明</Label>
                <Textarea
                  rows={2}
                  value={closeNote}
                  onChange={(e) => setCloseNote(e.target.value)}
                  placeholder="改善結果、驗證方式"
                />
              </div>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void patch({ status: "closed", close_note: closeNote.trim() || null }, "已結案")
                }
              >
                確認改善完成並結案
              </Button>
            </div>
          )}

          {row.status === "closed" && (
            <div className="border-t pt-3 text-sm space-y-1">
              <ReadField label="確認意見" value={row.confirm_note} />
              <ReadField label="結案說明" value={row.close_note} />
              <div className="text-xs text-muted-foreground">
                {nameOf(row.closed_by)} 於 {fmtDateTime(row.closed_at)} 結案
              </div>
            </div>
          )}

          {row.status === "void" && (
            <div className="border-t pt-3 text-sm">
              <ReadField label="作廢原因" value={row.void_reason} />
            </div>
          )}

          {canManage && !["closed", "void"].includes(row.status) && (
            <div className="border-t pt-3 space-y-2">
              <div className="text-sm font-medium text-muted-foreground">作廢</div>
              <div className="flex items-center gap-2">
                <Input
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="作廢原因（必填）"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !voidReason.trim()}
                  onClick={() =>
                    void patch({ status: "void", void_reason: voidReason.trim() }, "已作廢")
                  }
                >
                  作廢
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {canDelete && (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive mr-auto"
              disabled={busy}
              onClick={() => void softDelete()}
            >
              <Trash2 className="w-4 h-4 mr-1" />
              刪除
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            關閉
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReadField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <span className="text-xs text-muted-foreground">{label}：</span>
      <span className="whitespace-pre-wrap">{value || "—"}</span>
    </div>
  );
}

/* ---------- 回收區（已刪除）清單 ---------- */

function DeletedList({
  q,
  rows,
  onRestore,
  onPurge,
}: {
  q: { isLoading: boolean; isError: boolean; refetch: () => void };
  rows: DeletedItem[];
  onRestore: (d: DeletedItem) => void;
  onPurge: (d: DeletedItem) => void;
}) {
  if (q.isLoading)
    return <div className="text-sm text-muted-foreground text-center py-10">載入中…</div>;
  if (q.isError)
    return (
      <div className="text-sm text-center py-10">
        <div className="text-destructive mb-2">回收區載入失敗</div>
        <Button size="sm" variant="outline" onClick={() => q.refetch()}>
          重試
        </Button>
      </div>
    );
  if (!rows.length)
    return (
      <div className="text-center py-12 px-6 text-sm text-muted-foreground max-w-md mx-auto">
        回收區沒有已刪除的異常缺失。刪除的缺失會移到這裡，可還原；有協同紀錄者僅管理者可永久刪除。
      </div>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>項目</TableHead>
          <TableHead className="w-40">刪除時間</TableHead>
          <TableHead className="w-28">刪除人</TableHead>
          <TableHead className="w-44 text-right">動作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((d) => (
          <TableRow key={d.item_id}>
            <TableCell className="text-sm">{d.title ?? "（無標題）"}</TableCell>
            <TableCell className="text-sm whitespace-nowrap">{fmtDateTime(d.deleted_at)}</TableCell>
            <TableCell className="text-sm">{d.deleted_by_name ?? "—"}</TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-1.5">
                <Button size="sm" variant="outline" onClick={() => onRestore(d)}>
                  還原
                </Button>
                {d.can_purge ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onPurge(d)}
                  >
                    永久刪除
                  </Button>
                ) : d.purge_block ? (
                  <span className="text-xs text-muted-foreground" title={d.purge_block}>
                    不可永久刪除
                  </span>
                ) : null}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/* ---------- 空狀態 ---------- */

function EmptyState({ tab }: { tab: string }) {
  const msg: Record<string, string> = {
    pending_fill: "目前沒有待填報的缺失。主管開立缺失後會出現在這裡，並立即通知當事人。",
    filled: "沒有待確認的填報。同仁填報完成後會列在這裡等主管確認。",
    improving: "沒有正在追蹤改善的項目。",
    closed: "還沒有已結案的缺失。",
    void: "沒有已作廢的缺失。",
  };
  const Icon = tab === "pending_fill" ? ShieldAlert : Inbox;
  return (
    <div className="text-center py-12 px-6">
      <Icon className="w-8 h-8 mx-auto text-muted-foreground/50 mb-3" />
      <div className="text-sm text-muted-foreground max-w-md mx-auto">
        {msg[tab] ?? "沒有資料。"}
      </div>
    </div>
  );
}
