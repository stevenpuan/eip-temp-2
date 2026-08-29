import { createFileRoute } from "@tanstack/react-router";
import { RequirePerm } from "@/components/RequirePerm";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Folder, FolderPlus, FolderOpen, ChevronRight, ChevronDown, Plus,
  FileText, Search, Pencil, Trash2, History, RotateCcw, X,
  Bold, Italic, Underline, List, ListOrdered, Link as LinkIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { supabase as supabaseAny } from "@/lib/supabase";

import { useEipUser } from "@/lib/eip-user";
import { useActiveUsers, useAllUsers } from "@/hooks/useUsers";
import { useAuth } from "@/lib/auth";
import { DEFAULT_TENANT_ID } from "@/lib/eip-constants";
import { sanitizeHtml } from "@/lib/sanitize-html";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { humanizeError } from "@/lib/eip-error";

export const Route = createFileRoute("/dashboard/eip/documents")({
  component: () => (
    <RequirePerm module="eip_documents">
      <DocumentsPage />
    </RequirePerm>
  ),
});

type DocFolder = {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  tenant_id: string;
};

type Doc = {
  id: string;
  tenant_id: string;
  folder_id: string | null;
  title: string;
  doc_type: string;
  status: string;
  department_id: string | null;
  owner_id: string | null;
  current_version: number;
  summary: string | null;
  updated_at: string;
  created_by: string | null;
};

type Version = {
  id: string;
  document_id: string;
  version_no: number;
  content: string | null;
  file_url: string | null;
  file_name: string | null;
  storage_path: string | null;
  file_size: number | null;
  mime_type: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXT = [
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "png", "jpg", "jpeg", "gif", "webp", "txt", "csv", "zip",
];
const ALLOWED_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.zip";

function safeFileName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}
function getExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}
function humanSize(bytes: number | null | undefined): string {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
async function downloadFromStorage(storagePath: string) {
  const { data, error } = await supabase.storage.from("documents").createSignedUrl(storagePath, 60);
  if (error || !data?.signedUrl) {
    toast.error(error ? humanizeError(error, "下載") : "下載失敗：無法產生下載連結，請重新整理頁面再試");
    return;
  }
  window.open(data.signedUrl, "_blank");
}

const DOC_TYPE_LABEL: Record<string, string> = {
  sop: "SOP/流程", policy: "制度規章", form: "表單", guide: "指南", general: "一般",
};
const DOC_TYPES = Object.keys(DOC_TYPE_LABEL);

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿", published: "已發布", archived: "封存",
};
const STATUS_COLOR: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  published: "bg-emerald-100 text-emerald-700",
  archived: "bg-amber-100 text-amber-700",
};

type CanFn = (key: string, action?: "view" | "create" | "edit" | "delete" | "export") => boolean;

function canEditDoc(d: Doc, uid: string | undefined | null, can: CanFn): boolean {
  if (!uid) return false;
  if (d.owner_id === uid || d.created_by === uid) return true;
  return can("eip_documents", "edit");
}
function canDeleteDoc(d: Doc, uid: string | undefined | null, can: CanFn): boolean {
  if (!uid) return false;
  if (d.owner_id === uid) return true;
  return can("eip_documents", "delete");
}


function DocumentsPage() {
  const qc = useQueryClient();
  const { appUser } = useEipUser();
  const { can } = useAuth();
  const isManager = can("eip_documents", "edit");
  const canCreate = can("eip_documents", "create");

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [editingDoc, setEditingDoc] = useState<Doc | "new" | null>(null);
  const [detailDocId, setDetailDocId] = useState<string | null>(null);
  const [deleteDoc, setDeleteDoc] = useState<Doc | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 資料夾
  const foldersQ = useQuery({
    queryKey: ["eip_doc_folder"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eip_doc_folder")
        .select("*")
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return (data ?? []) as DocFolder[];
    },
  });

  // 文件
  const docsQ = useQuery({
    queryKey: ["eip_document"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eip_document")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Doc[];
    },
  });

  // 成員 / 部門(編輯用)
  // 顯示對照用：含已停用者，保留離職同仁的歷史姓名
  const usersQ = useAllUsers();
  // 選人用：只在職（文件負責人 Select）
  const activeUsersQ = useActiveUsers();
  const deptQ = useQuery({
    queryKey: ["department_options"],
    queryFn: async () => {
      const { data } = await supabase.from("department").select("id,name").order("name");
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });

  const userMap = useMemo(() => {
    const m = new Map<string, string>();
    (usersQ.data ?? []).forEach((u) => m.set(u.id, u.name ?? u.email ?? "—"));
    return m;
  }, [usersQ.data]);

  const filteredDocs = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return (docsQ.data ?? []).filter((d) => {
      if (selectedFolderId !== null && d.folder_id !== selectedFolderId) return false;
      if (typeFilter !== "all" && d.doc_type !== typeFilter) return false;
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (kw) {
        const hit = d.title.toLowerCase().includes(kw) || (d.summary ?? "").toLowerCase().includes(kw);
        if (!hit) return false;
      }
      return true;
    });
  }, [docsQ.data, selectedFolderId, typeFilter, statusFilter, search]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="文件中心"
        description="公司文件歸檔 / SOP / 版本管理"
        actions={
          canCreate ? (
            <Button onClick={() => setEditingDoc("new")}>
              <Plus className="w-4 h-4 mr-1" /> 新增文件
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* 左:資料夾樹 */}
        <Card className="lg:sticky lg:top-4 self-start">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium">資料夾</div>
              {isManager && (
                <button
                  className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                  title="新增根資料夾"
                  onClick={() => promptCreateFolder(null, appUser?.tenant_id ?? DEFAULT_TENANT_ID, qc)}
                >
                  <FolderPlus className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="text-sm">
              <FolderRow
                folder={null}
                active={selectedFolderId === null}
                onSelect={() => setSelectedFolderId(null)}
                count={(docsQ.data ?? []).length}
                isManager={false}
                tenantId={appUser?.tenant_id ?? DEFAULT_TENANT_ID}
              />
              {foldersQ.isLoading ? (
                <div className="text-muted-foreground py-2 px-2">載入中…</div>
              ) : (
                <FolderTree
                  folders={foldersQ.data ?? []}
                  docs={docsQ.data ?? []}
                  parentId={null}
                  depth={0}
                  selectedId={selectedFolderId}
                  onSelect={setSelectedFolderId}
                  isManager={isManager}
                  tenantId={appUser?.tenant_id ?? DEFAULT_TENANT_ID}
                />
              )}
            </div>
          </CardContent>
        </Card>

        {/* 右:文件清單 */}
        <div className="space-y-3 min-w-0">
          <Card>
            <CardContent className="p-3 flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="搜尋標題 / 摘要…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[140px]"><SelectValue placeholder="類型" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部類型</SelectItem>
                  {DOC_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{DOC_TYPE_LABEL[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]"><SelectValue placeholder="狀態" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部狀態</SelectItem>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0 overflow-x-auto">
              {docsQ.isLoading ? (
                <div className="text-muted-foreground py-12 text-center">載入中…</div>
              ) : filteredDocs.length === 0 ? (
                <div className="py-12 text-center space-y-3">
                  <div className="text-sm text-muted-foreground">
                    {search || typeFilter !== "all" || statusFilter !== "all"
                      ? "沒有符合篩選條件的文件。"
                      : "此資料夾沒有文件,點「新增文件」上傳第一份文件。"}
                  </div>
                  {canCreate && !(search || typeFilter !== "all" || statusFilter !== "all") && (
                    <Button size="sm" onClick={() => setEditingDoc("new")}>
                      <Plus className="w-4 h-4 mr-1" /> 新增文件
                    </Button>
                  )}
                </div>
              ) : (
                <div className="divide-y">
                  {filteredDocs.map((d) => {
                    const cE = canEditDoc(d, appUser?.id, can);
                    const cD = canDeleteDoc(d, appUser?.id, can);

                    return (
                      <div key={d.id} className="relative">
                        <button
                          onClick={() => setDetailDocId(d.id)}
                          className="w-full text-left p-4 hover:bg-accent/50 flex items-start gap-3"
                        >
                          <FileText className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
                          <div className="min-w-0 flex-1 pr-10">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium truncate">{d.title}</span>
                              <Badge variant="secondary" className="text-[11.5px]">v{d.current_version}</Badge>
                              <span className={cn("text-[11.5px] px-2 py-0.5 rounded-full", STATUS_COLOR[d.status])}>
                                {STATUS_LABEL[d.status] ?? d.status}
                              </span>
                              <span className="text-[11.5px] text-muted-foreground">
                                {DOC_TYPE_LABEL[d.doc_type] ?? d.doc_type}
                              </span>
                            </div>
                            {d.summary && (
                              <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{d.summary}</div>
                            )}
                            <div className="text-[12.5px] text-muted-foreground mt-1">
                              負責人:{userMap.get(d.owner_id ?? "") ?? "—"} · 更新於 {new Date(d.updated_at).toLocaleString()}
                            </div>
                          </div>
                        </button>
                        {(cE || cD) && (
                          <div className="absolute top-3 right-3">
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
                                {cE && (
                                  <DropdownMenuItem onClick={() => setEditingDoc(d)}>
                                    <Pencil className="w-3.5 h-3.5 mr-2" /> 編輯
                                  </DropdownMenuItem>
                                )}
                                {cD && (
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => setDeleteDoc(d)}
                                  >
                                    <Trash2 className="w-3.5 h-3.5 mr-2" /> 刪除
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 文件詳情 */}
      {detailDocId && (
        <DocDetailDialog
          docId={detailDocId}
          onClose={() => setDetailDocId(null)}
          onEdit={(doc) => { setDetailDocId(null); setEditingDoc(doc); }}
          onAskDelete={(doc) => { setDetailDocId(null); setDeleteDoc(doc); }}
          userMap={userMap}
          appUser={appUser}
        />
      )}

      {/* 新增 / 編輯 */}
      {editingDoc && (
        <DocEditorDialog
          mode={editingDoc === "new" ? "new" : "edit"}
          doc={editingDoc === "new" ? null : editingDoc}
          folders={foldersQ.data ?? []}
          users={activeUsersQ.data ?? []}
          departments={deptQ.data ?? []}
          defaultFolderId={selectedFolderId}
          tenantId={appUser?.tenant_id ?? DEFAULT_TENANT_ID}
          currentUserId={appUser?.id ?? null}
          onClose={() => setEditingDoc(null)}
        />
      )}

      <AlertDialog open={!!deleteDoc} onOpenChange={(o) => !o && !deleting && setDeleteDoc(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定刪除文件？</AlertDialogTitle>
            <AlertDialogDescription>
              即將刪除「{deleteDoc?.title}」,所有版本將一併移除。刪除後無法復原。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault();
                if (!deleteDoc) return;
                setDeleting(true);
                // eip_document 掛了 BEFORE DELETE 的軟刪除 guard（RETURN NULL），所以
                // .delete() 的 ROW_COUNT 一律是 0、error 一律是 null —— 有沒有權限從前端
                // 完全分不出來，原本因此一律跳「文件已刪除」。改走 eip_soft_delete RPC，
                // 它會回 {ok:false, reason} 讓我們如實回報（與任務／異常缺失一致）。
                // 版本表那句原本是死碼（eip_document_version 沒有 DELETE 政策），一併移除。
                const { data, error } = await supabaseAny.rpc("eip_soft_delete", {
                  p_module: "eip_documents",
                  p_id: deleteDoc.id,
                });
                setDeleting(false);
                if (error) { toast.error(humanizeError(error, "刪除")); return; }
                if ((data as { ok?: boolean; reason?: string } | null)?.ok !== true) {
                  toast.error(
                    (data as { reason?: string } | null)?.reason
                      ?? "刪除失敗：僅文件負責人 / 該部門主管 / 管理者可刪除這份文件",
                  );
                  return;
                }
                toast.success("文件已刪除");
                setDeleteDoc(null);
                qc.invalidateQueries({ queryKey: ["eip_document"] });
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

// ============ 資料夾樹 ============

async function promptCreateFolder(parentId: string | null, tenantId: string, qc: ReturnType<typeof useQueryClient>) {
  const name = window.prompt("資料夾名稱");
  if (!name?.trim()) return;
  // docfolder_write 政策要 created_by = auth.uid()，這裡沒帶的話建出來的資料夾
  // 除了系統設計師以外沒有任何人改得動（現有 8 筆就是這樣來的）。
  const { data: au } = await supabase.auth.getUser();
  const { error } = await supabase.from("eip_doc_folder").insert({
    tenant_id: tenantId, name: name.trim(), parent_id: parentId, sort_order: 0,
    created_by: au?.user?.id ?? null,
  });
  if (error) return toast.error(humanizeError(error, "建立資料夾"));
  toast.success("已新增資料夾");
  qc.invalidateQueries({ queryKey: ["eip_doc_folder"] });
}

function FolderTree({
  folders, docs, parentId, depth, selectedId, onSelect, isManager, tenantId,
}: {
  folders: DocFolder[]; docs: Doc[]; parentId: string | null; depth: number;
  selectedId: string | null; onSelect: (id: string | null) => void;
  isManager: boolean; tenantId: string;
}) {
  const items = folders.filter((f) => f.parent_id === parentId);
  if (items.length === 0) return null;
  return (
    <div>
      {items.map((f) => {
        const childCount = folders.filter((x) => x.parent_id === f.id).length;
        const docCount = docs.filter((d) => d.folder_id === f.id).length;
        return (
          <FolderNode
            key={f.id}
            folder={f}
            depth={depth}
            hasChildren={childCount > 0}
            docCount={docCount}
            active={selectedId === f.id}
            onSelect={onSelect}
            isManager={isManager}
            tenantId={tenantId}
          >
            <FolderTree
              folders={folders} docs={docs} parentId={f.id} depth={depth + 1}
              selectedId={selectedId} onSelect={onSelect} isManager={isManager} tenantId={tenantId}
            />
          </FolderNode>
        );
      })}
    </div>
  );
}

function FolderNode({
  folder, depth, hasChildren, docCount, active, onSelect, isManager, tenantId, children,
}: {
  folder: DocFolder; depth: number; hasChildren: boolean; docCount: number;
  active: boolean; onSelect: (id: string) => void;
  isManager: boolean; tenantId: string; children: React.ReactNode;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);

  const rename = async () => {
    const name = window.prompt("新名稱", folder.name);
    if (!name?.trim() || name === folder.name) return;
    const { data, error } = await supabase
      .from("eip_doc_folder").update({ name: name.trim() }).eq("id", folder.id).select("id");
    if (error) return toast.error(humanizeError(error, "重新命名"));
    // 被 RLS 擋掉時 PostgREST 回 0 列而 error 是 null，沒有這道檢查就會把「沒改到」報成「已更新」。
    if (!data?.length) return toast.error("重新命名失敗：沒有權限修改這個資料夾");
    toast.success("已更新");
    qc.invalidateQueries({ queryKey: ["eip_doc_folder"] });
  };
  const remove = async () => {
    if (!window.confirm(`確定刪除資料夾「${folder.name}」?(子資料夾與文件需先移走)`)) return;
    const { data, error } = await supabase
      .from("eip_doc_folder").delete().eq("id", folder.id).select("id");
    if (error) return toast.error(humanizeError(error, "刪除資料夾"));
    if (!data?.length) return toast.error("刪除失敗：沒有權限刪除這個資料夾，或裡面還有子資料夾／文件");
    toast.success("已刪除");
    qc.invalidateQueries({ queryKey: ["eip_doc_folder"] });
  };

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 px-2 py-1 rounded hover:bg-accent cursor-pointer",
          active && "bg-accent font-medium",
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onSelect(folder.id)}
      >
        <button
          className="p-0.5 text-muted-foreground"
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
          aria-label={open ? "收合" : "展開"}
        >
          {hasChildren ? (open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />) : <span className="inline-block w-3" />}
        </button>
        {active ? <FolderOpen className="w-4 h-4 text-primary" /> : <Folder className="w-4 h-4 text-muted-foreground" />}
        <span className="truncate flex-1">{folder.name}</span>
        <span className="text-[11.5px] text-muted-foreground">{docCount}</span>
        {isManager && (
          <span className="lg:opacity-0 lg:group-hover:opacity-100 flex items-center gap-0.5">
            <button title="新增子資料夾" className="p-0.5 hover:text-foreground" onClick={(e) => { e.stopPropagation(); void promptCreateFolder(folder.id, tenantId, qc); }}>
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
            <button title="改名" className="p-0.5 hover:text-foreground" onClick={(e) => { e.stopPropagation(); void rename(); }}>
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button title="刪除" className="p-0.5 hover:text-destructive" onClick={(e) => { e.stopPropagation(); void remove(); }}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </span>
        )}
      </div>
      {open && children}
    </div>
  );
}

function FolderRow({
  folder, active, onSelect, count,
}: {
  folder: DocFolder | null; active: boolean; onSelect: () => void; count: number;
  isManager: boolean; tenantId: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 py-1 rounded hover:bg-accent cursor-pointer",
        active && "bg-accent font-medium",
      )}
      onClick={onSelect}
    >
      <span className="inline-block w-3" />
      <Folder className="w-4 h-4 text-muted-foreground" />
      <span className="flex-1">{folder?.name ?? "全部文件"}</span>
      <span className="text-[11.5px] text-muted-foreground">{count}</span>
    </div>
  );
}

// ============ 詳情對話框 ============

function DocDetailDialog({
  docId, onClose, onEdit, onAskDelete, userMap, appUser,
}: {
  docId: string; onClose: () => void; onEdit: (d: Doc) => void; onAskDelete: (d: Doc) => void;
  userMap: Map<string, string>; appUser: { id: string; role: string } | null;
}) {
  const qc = useQueryClient();
  const { can } = useAuth();

  const [showHistory, setShowHistory] = useState(false);
  const [viewVersionId, setViewVersionId] = useState<string | null>(null);

  const docQ = useQuery({
    queryKey: ["eip_document", docId],
    queryFn: async () => {
      const { data, error } = await supabase.from("eip_document").select("*").eq("id", docId).maybeSingle();
      if (error) throw error;
      return data as Doc | null;
    },
  });
  const versionsQ = useQuery({
    queryKey: ["eip_document_version", docId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eip_document_version")
        .select("*").eq("document_id", docId)
        .order("version_no", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Version[];
    },
  });

  const doc = docQ.data ?? null;
  const versions = versionsQ.data ?? [];
  const viewing = viewVersionId
    ? versions.find((v) => v.id === viewVersionId)
    : versions.find((v) => v.version_no === doc?.current_version) ?? versions[0];
  const canEdit = doc ? canEditDoc(doc, appUser?.id, can) : false;
  const canDelete = doc ? canDeleteDoc(doc, appUser?.id, can) : false;


  const publish = async (status: string) => {
    if (!doc) return;
    const { data, error } = await supabase
      .from("eip_document").update({ status }).eq("id", doc.id).select("id");
    if (error) return toast.error(humanizeError(error, "更新狀態"));
    if (!data?.length) return toast.error("更新失敗：沒有權限變更這份文件的狀態");
    toast.success("已更新狀態");
    qc.invalidateQueries({ queryKey: ["eip_document"] });
    qc.invalidateQueries({ queryKey: ["eip_document", doc.id] });
  };

  const restore = async (v: Version) => {
    if (!doc) return;
    if (!window.confirm(`確定以版本 v${v.version_no} 的內容建立新版本?`)) return;
    const newVer = (doc.current_version ?? 0) + 1;
    const oldVer = doc.current_version ?? 0;
    // 順序很重要：主檔的 update 與版本表的 insert 是兩條不同的 RLS 政策，條件並不一致。
    // 先插版本再更新主檔的話，主檔被擋掉（0 列、error 為 null）時會留下一筆版號比
    // current_version 還大的孤兒版本，重按就會插出重複版號 → 之後讀現行版本會撞
    // PGRST116，這份文件的儲存會被前端防呆永久擋死。所以先驗主檔寫不寫得動。
    const { data: dRows, error: dErr } = await supabase
      .from("eip_document").update({ current_version: newVer }).eq("id", doc.id).select("id");
    if (dErr) return toast.error(humanizeError(dErr, "更新版號"));
    if (!dRows?.length) return toast.error("還原失敗：沒有權限修改這份文件");
    const { error: vErr } = await supabase.from("eip_document_version").insert({
      tenant_id: doc.tenant_id, document_id: doc.id, version_no: newVer,
      content: v.content, file_url: v.file_url, file_name: v.file_name,
      storage_path: v.storage_path, file_size: v.file_size, mime_type: v.mime_type,
      note: `還原自 v${v.version_no}`,
    });
    if (vErr) {
      // 版本沒插成功就把版號改回去，不要讓 current_version 指向不存在的版本
      await supabase.from("eip_document").update({ current_version: oldVer }).eq("id", doc.id);
      return toast.error(humanizeError(vErr, "還原版本"));
    }
    toast.success(`已還原為 v${v.version_no}(產生 v${newVer})`);
    qc.invalidateQueries({ queryKey: ["eip_document"] });
    qc.invalidateQueries({ queryKey: ["eip_document", doc.id] });
    qc.invalidateQueries({ queryKey: ["eip_document_version", doc.id] });
    setViewVersionId(null);
  };

  // 刪除走父層 AlertDialog,由 onAskDelete 觸發



  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        {docQ.isLoading || !doc ? (
          <div className="py-12 text-center text-muted-foreground">載入中…</div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                <span>{doc.title}</span>
                <Badge variant="secondary" className="text-[11.5px]">v{doc.current_version}</Badge>
                <span className={cn("text-[11.5px] px-2 py-0.5 rounded-full", STATUS_COLOR[doc.status])}>
                  {STATUS_LABEL[doc.status]}
                </span>
                <span className="text-[11.5px] text-muted-foreground font-normal">
                  {DOC_TYPE_LABEL[doc.doc_type]}
                </span>
              </DialogTitle>
            </DialogHeader>

            {doc.summary && <p className="text-sm text-muted-foreground">{doc.summary}</p>}
            <div className="text-xs text-muted-foreground">
              負責人:{userMap.get(doc.owner_id ?? "") ?? "—"} · 更新於 {new Date(doc.updated_at).toLocaleString()}
            </div>

            {viewing && (
              <div className="border rounded-md p-4 bg-card">
                {viewVersionId && (
                  <div className="mb-2 text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded inline-flex items-center gap-2">
                    檢視歷史版本 v{viewing.version_no}
                    <button onClick={() => setViewVersionId(null)} className="hover:text-foreground">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
                {(viewing.storage_path || viewing.file_url) && (
                  <div className="mb-3 text-sm flex items-center gap-2 flex-wrap">
                    <span className="text-muted-foreground">附檔:</span>
                    <span className="font-medium">{viewing.file_name ?? "附檔"}</span>
                    {viewing.file_size != null && (
                      <span className="text-xs text-muted-foreground">({humanSize(viewing.file_size)})</span>
                    )}
                    {viewing.storage_path ? (
                      <Button size="sm" variant="outline" onClick={() => void downloadFromStorage(viewing.storage_path!)}>
                        下載
                      </Button>
                    ) : viewing.file_url ? (
                      <a href={viewing.file_url} target="_blank" rel="noreferrer" className="text-primary underline text-xs">
                        開啟連結
                      </a>
                    ) : null}
                  </div>
                )}
                {viewing.content ? (
                  <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeHtml(viewing.content) }} />
                ) : (
                  <div className="text-sm text-muted-foreground">(本版本無內文)</div>
                )}
              </div>
            )}

            <div>
              <button
                className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                onClick={() => setShowHistory((v) => !v)}
              >
                <History className="w-4 h-4" /> 版本歷程({versions.length})
                {showHistory ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>
              {showHistory && (
                <div className="mt-2 border rounded-md divide-y text-sm">
                  {versions.map((v) => (
                    <div key={v.id} className="p-2 flex items-center gap-2">
                      <Badge variant="secondary" className="text-[11.5px]">v{v.version_no}</Badge>
                      {v.version_no === doc.current_version && <span className="text-[11.5px] text-emerald-700">(目前)</span>}
                      <span className="text-xs text-muted-foreground flex-1 truncate">
                        {v.note ?? "—"} · {userMap.get(v.created_by ?? "") ?? "—"} · {new Date(v.created_at).toLocaleString()}
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => setViewVersionId(v.id)}>檢視</Button>
                      {canEdit && v.version_no !== doc.current_version && (
                        <Button size="sm" variant="ghost" onClick={() => void restore(v)}>
                          <RotateCcw className="w-3 h-3 mr-1" /> 還原
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 flex-wrap">
              {canEdit && doc.status === "draft" && (
                <Button variant="outline" onClick={() => void publish("published")}>發布</Button>
              )}
              {canEdit && doc.status === "published" && (
                <Button variant="outline" onClick={() => void publish("archived")}>封存</Button>
              )}
              {canEdit && doc.status === "archived" && (
                <Button variant="outline" onClick={() => void publish("published")}>還原為已發布</Button>
              )}
              {canEdit && <Button onClick={() => onEdit(doc)}><Pencil className="w-4 h-4 mr-1" /> 編輯內容</Button>}
              {canDelete && <Button variant="destructive" onClick={() => onAskDelete(doc)}><Trash2 className="w-4 h-4 mr-1" /> 刪除</Button>}
              <Button variant="ghost" onClick={onClose}>關閉</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============ 新增 / 編輯對話框 ============

function DocEditorDialog({
  mode, doc, folders, users, departments, defaultFolderId, tenantId, currentUserId, onClose,
}: {
  mode: "new" | "edit";
  doc: Doc | null;
  folders: DocFolder[];
  users: Array<{ id: string; name: string | null; email: string | null }>;
  departments: Array<{ id: string; name: string }>;
  defaultFolderId: string | null;
  tenantId: string;
  currentUserId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(doc?.title ?? "");
  const [folderId, setFolderId] = useState<string | null>(doc?.folder_id ?? defaultFolderId);
  const [docType, setDocType] = useState(doc?.doc_type ?? "general");
  const [summary, setSummary] = useState(doc?.summary ?? "");
  const [ownerId, setOwnerId] = useState<string | null>(doc?.owner_id ?? currentUserId);
  const [departmentId, setDepartmentId] = useState<string | null>(doc?.department_id ?? null);
  const [fileUrl, setFileUrl] = useState("");
  // 既有附檔(編輯時從目前版本讀)
  const [existingStoragePath, setExistingStoragePath] = useState<string | null>(null);
  const [existingFileName, setExistingFileName] = useState<string | null>(null);
  const [existingFileSize, setExistingFileSize] = useState<number | null>(null);
  const [existingMimeType, setExistingMimeType] = useState<string | null>(null);
  // 本次選擇要上傳的新檔
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [versionNote, setVersionNote] = useState("");
  const [busy, setBusy] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 編輯時:載入目前版本內容到編輯器
  const curVerQ = useQuery({
    queryKey: ["eip_document_version", "current", doc?.id, doc?.current_version],
    enabled: mode === "edit" && !!doc,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eip_document_version")
        .select("*").eq("document_id", doc!.id).eq("version_no", doc!.current_version)
        .maybeSingle();
      if (error) throw error; // 不吞錯：載入失敗要讓 submit 擋下，避免用空白覆蓋整份文件
      return data as Version | null;
    },
  });

  useEffect(() => {
    if (!editorRef.current) return;
    if (mode === "edit" && curVerQ.data) {
      editorRef.current.innerHTML = curVerQ.data.content ?? "";
      setFileUrl(curVerQ.data.file_url ?? "");
      setExistingStoragePath(curVerQ.data.storage_path ?? null);
      setExistingFileName(curVerQ.data.file_name ?? null);
      setExistingFileSize(curVerQ.data.file_size ?? null);
      setExistingMimeType(curVerQ.data.mime_type ?? null);
    } else if (mode === "new") {
      editorRef.current.innerHTML = "";
    }
  }, [mode, curVerQ.data]);

  const exec = (cmd: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
  };
  const insertLink = () => {
    const url = window.prompt("請輸入連結網址", "https://");
    if (url) exec("createLink", url);
  };

  const validateFile = (f: File): string | null => {
    if (f.size > MAX_UPLOAD_BYTES) return "檔案不可超過 50MB";
    const ext = getExt(f.name);
    if (!ALLOWED_ACCEPT.split(",").map((s) => s.replace(/^\./, "")).includes(ext)) {
      return "不支援的檔案類型(僅支援 PDF / Office / 圖片 / txt / csv / zip)";
    }
    return null;
  };

  const onPick = (f: File | null) => {
    setFileError(null);
    if (!f) { setPickedFile(null); return; }
    const err = validateFile(f);
    if (err) { setFileError(err); setPickedFile(null); return; }
    setPickedFile(f);
  };

  const removeExistingAttachment = async () => {
    if (!existingStoragePath) return;
    if (!window.confirm("確定移除目前附檔?新版本將不含附檔,舊版本仍可下載。")) return;
    // 原本在這裡就直接 storage.remove()，但：(a) 訊息說「將於儲存後生效」卻是立刻刪，
    // 使用者按取消也救不回來；(b) storage_path 是各版本共用的同一個物件，刪掉會讓
    // 所有舊版本的下載變成 404。這裡只清掉表單狀態，實體檔案保留給舊版本使用。
    setExistingStoragePath(null);
    setExistingFileName(null);
    setExistingFileSize(null);
    setExistingMimeType(null);
    toast.success("已移除附檔(儲存後新版本將不含附檔)");
  };

  // 上傳檔案到 documents bucket;回傳要寫入版本表的欄位
  const uploadIfNeeded = async (documentId: string): Promise<{
    storage_path: string | null;
    file_name: string | null;
    file_size: number | null;
    mime_type: string | null;
  }> => {
    if (pickedFile) {
      const safe = safeFileName(pickedFile.name) || `file_${Date.now()}`;
      const path = `${tenantId}/${documentId}/${Date.now()}_${safe}`;
      const { error } = await supabase.storage.from("documents").upload(path, pickedFile, {
        upsert: false,
        contentType: pickedFile.type || undefined,
      });
      if (error) throw new Error(humanizeError(error, "附檔上傳"));
      return {
        storage_path: path,
        file_name: pickedFile.name,
        file_size: pickedFile.size,
        mime_type: pickedFile.type || null,
      };
    }
    // 沿用既有(編輯時若未換檔)
    return {
      storage_path: existingStoragePath,
      file_name: existingFileName,
      file_size: existingFileSize,
      mime_type: existingMimeType,
    };
  };

  const submit = async () => {
    if (!title.trim()) return toast.error("請輸入標題");
    if (fileError) return toast.error(fileError);
    const html = editorRef.current?.innerHTML ?? "";
    setBusy(true);
    try {
      if (mode === "new") {
        const { data: ins, error } = await supabase
          .from("eip_document")
          .insert({
            tenant_id: tenantId, title: title.trim(), folder_id: folderId,
            doc_type: docType, summary: summary.trim() || null,
            owner_id: ownerId, department_id: departmentId,
            status: "draft", current_version: 1,
          })
          .select("id").single();
        if (error) throw error;
        const att = await uploadIfNeeded(ins.id);
        const { error: vErr } = await supabase.from("eip_document_version").insert({
          tenant_id: tenantId, document_id: ins.id, version_no: 1,
          content: html || null,
          file_url: fileUrl || null,
          file_name: att.file_name,
          storage_path: att.storage_path,
          file_size: att.file_size,
          mime_type: att.mime_type,
          note: versionNote || "初版",
        });
        if (vErr) throw vErr;
        toast.success("已建立文件");
      } else if (doc) {
        // 防止用空白覆蓋：現行版本內文尚未載入完成或載入失敗時，不可儲存新版本。
        if (curVerQ.isLoading) throw new Error("現行版本內容尚未載入完成，請稍候再儲存");
        if (curVerQ.isError) throw new Error("現行版本內容載入失敗，為避免覆蓋成空白已中止儲存，請關閉後重新開啟編輯");
        const att = await uploadIfNeeded(doc.id);
        const { data: dRows, error: dErr } = await supabase.from("eip_document")
          .update({
            title: title.trim(), folder_id: folderId, doc_type: docType,
            summary: summary.trim() || null, owner_id: ownerId, department_id: departmentId,
            current_version: doc.current_version + 1,
          })
          .eq("id", doc.id)
          .select("id");
        if (dErr) throw dErr;
        // document_update 與 docver_insert 是兩條條件不一樣的政策：主檔被擋掉（0 列、
        // error 為 null）而版本仍插得進去時，畫面會說「已儲存為 vN」但文件還停在舊版，
        // 重按就插出重複版號讓這份文件再也打不開。0 列一律中止，不要碰版本表。
        if (!dRows?.length) throw new Error("儲存失敗：沒有權限修改這份文件，內容未寫入");
        const { error: vErr } = await supabase.from("eip_document_version").insert({
          tenant_id: doc.tenant_id, document_id: doc.id,
          version_no: doc.current_version + 1,
          content: html || null,
          file_url: fileUrl || null,
          file_name: att.file_name,
          storage_path: att.storage_path,
          file_size: att.file_size,
          mime_type: att.mime_type,
          note: versionNote || `編輯於 ${new Date().toLocaleString()}`,
        });
        if (vErr) throw vErr;
        toast.success(`已儲存為 v${doc.current_version + 1}`);
      }
      qc.invalidateQueries({ queryKey: ["eip_document"] });
      onClose();
    } catch (e) {
      toast.error(humanizeError(e, "儲存文件"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "new" ? "新增文件" : `編輯文件(將寫入 v${(doc?.current_version ?? 0) + 1})`}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          <Field label="標題" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>

          <div className="grid md:grid-cols-2 gap-3">
            <Field label="所屬資料夾">
              <Select value={folderId ?? "__none"} onValueChange={(v) => setFolderId(v === "__none" ? null : v)}>
                <SelectTrigger><SelectValue placeholder="未分類" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">(未分類)</SelectItem>
                  {folders.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="類型">
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{DOC_TYPE_LABEL[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <Field label="負責人">
              <Select value={ownerId ?? "__none"} onValueChange={(v) => setOwnerId(v === "__none" ? null : v)}>
                <SelectTrigger><SelectValue placeholder="未指派" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">(未指派)</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name ?? u.email ?? u.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="部門">
              <Select value={departmentId ?? "__none"} onValueChange={(v) => setDepartmentId(v === "__none" ? null : v)}>
                <SelectTrigger><SelectValue placeholder="不指定" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">(不指定)</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="摘要">
            <Textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </Field>

          <Field label="內容">
            <div className="border rounded-md overflow-hidden">
              <div className="flex flex-wrap items-center gap-1 border-b bg-muted/40 px-2 py-1">
                <ToolBtn onClick={() => exec("bold")} title="粗體"><Bold className="w-4 h-4" /></ToolBtn>
                <ToolBtn onClick={() => exec("italic")} title="斜體"><Italic className="w-4 h-4" /></ToolBtn>
                <ToolBtn onClick={() => exec("underline")} title="底線"><Underline className="w-4 h-4" /></ToolBtn>
                <div className="w-px h-4 bg-border mx-1" />
                <ToolBtn onClick={() => exec("formatBlock", "<h2>")} title="標題">H2</ToolBtn>
                <ToolBtn onClick={() => exec("formatBlock", "<h3>")} title="子標題">H3</ToolBtn>
                <ToolBtn onClick={() => exec("formatBlock", "<p>")} title="一般段落">P</ToolBtn>
                <div className="w-px h-4 bg-border mx-1" />
                <ToolBtn onClick={() => exec("insertUnorderedList")} title="項目清單"><List className="w-4 h-4" /></ToolBtn>
                <ToolBtn onClick={() => exec("insertOrderedList")} title="編號清單"><ListOrdered className="w-4 h-4" /></ToolBtn>
                <div className="w-px h-4 bg-border mx-1" />
                <ToolBtn onClick={insertLink} title="插入連結"><LinkIcon className="w-4 h-4" /></ToolBtn>
              </div>
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                className="min-h-[260px] p-3 text-sm focus:outline-none prose prose-sm max-w-none"
              />
            </div>
          </Field>

          <Field label="附檔(上傳檔案)">
            <div className="space-y-2">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0] ?? null;
                  onPick(f);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "border-2 border-dashed rounded-md p-4 text-center cursor-pointer transition-colors",
                  dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50",
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept={ALLOWED_ACCEPT}
                  onChange={(e) => onPick(e.target.files?.[0] ?? null)}
                />
                {pickedFile ? (
                  <div className="text-sm">
                    <div className="font-medium truncate">{pickedFile.name}</div>
                    <div className="text-xs text-muted-foreground">{humanSize(pickedFile.size)} · 點擊更換</div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    <div>拖放檔案到此或<span className="text-primary">點擊選檔</span></div>
                    <div className="text-xs mt-1">PDF / Word / Excel / PowerPoint / 圖片 / txt / csv / zip · 單檔上限 50MB</div>
                  </div>
                )}
              </div>
              {fileError && <div className="text-xs text-destructive">{fileError}</div>}
              {pickedFile && (
                <Button type="button" variant="ghost" size="sm" onClick={() => { setPickedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}>
                  取消選擇
                </Button>
              )}
              {!pickedFile && existingStoragePath && (
                <div className="flex items-center gap-2 flex-wrap text-sm border rounded p-2 bg-muted/30">
                  <span className="font-medium truncate">{existingFileName ?? "已上傳附檔"}</span>
                  <span className="text-xs text-muted-foreground">({humanSize(existingFileSize)})</span>
                  <Button type="button" size="sm" variant="outline" onClick={() => void downloadFromStorage(existingStoragePath)}>下載</Button>
                  <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => void removeExistingAttachment()}>刪除附檔</Button>
                </div>
              )}
            </div>
          </Field>

          <Field label="或貼外部連結(選填)">
            <Input value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="https://…(雲端硬碟連結等)" />
          </Field>


          <Field label={mode === "new" ? "版本備註" : "本次修改說明"}>
            <Input value={versionNote} onChange={(e) => setVersionNote(e.target.value)} placeholder={mode === "new" ? "例:初版建立" : "例:更新章節三、修正錯字"} />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "儲存中…" : "儲存"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ utilities ============

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-sm">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      {children}
    </div>
  );
}

function ToolBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      className="h-7 min-w-7 px-1 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground text-xs font-semibold"
    >
      {children}
    </button>
  );
}
