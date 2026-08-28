import { createFileRoute } from "@tanstack/react-router";
import { RequirePerm } from "@/components/RequirePerm";
import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pin, Megaphone, Download, MoreHorizontal, Pencil, Trash2, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAuth } from "@/lib/auth";
import { exportToExcel } from "@/lib/eip-export";
import { supabase } from "@/integrations/supabase/client";
import { useEipUser } from "@/lib/eip-user";
import { useActiveUsers, useAllUsers } from "@/hooks/useUsers";
import { DEFAULT_TENANT_ID } from "@/lib/eip-constants";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Database } from "@/integrations/supabase/types";
import { humanizeError } from "@/lib/eip-error";

export const Route = createFileRoute("/dashboard/eip/announcements")({
  // 從行事曆等處帶 ?open=<公告id> 進來時，自動展開並捲到該則公告
  validateSearch: (s: Record<string, unknown>): { open?: string } => ({
    open: typeof s.open === "string" ? s.open : undefined,
  }),
  component: () => (
    <RequirePerm module="eip_announcements">
      <AnnouncementsPage />
    </RequirePerm>
  ),
});

type Announcement = Database["public"]["Tables"]["announcement"]["Row"];
type AppUser = Database["public"]["Tables"]["app_user"]["Row"];
type Department = Database["public"]["Tables"]["department"]["Row"];
type Audience = Database["public"]["Enums"]["announcement_audience"];

const AUDIENCE_LABEL: Record<Audience, string> = { all: "全公司", department: "指定部門", users: "指定人員" };

type CanFn = (key: string, action?: "view" | "create" | "edit" | "delete" | "export") => boolean;

function canEditAnnouncement(a: Announcement, u: AppUser | null, can: CanFn): boolean {
  if (!u) return false;
  if (a.created_by === u.id) return true;
  return can("eip_announcements", "edit");
}
function canDeleteAnnouncement(a: Announcement, u: AppUser | null, can: CanFn): boolean {
  if (!u) return false;
  if (a.created_by === u.id && can("eip_announcements", "delete")) return true;
  return can("eip_announcements", "delete") && u.role === "company_admin";
}


function AnnouncementsPage() {
  const qc = useQueryClient();
  const { appUser } = useEipUser();
  const { can } = useAuth();
  const canPublish = can("eip_announcements", "create");
  const [openCreate, setOpenCreate] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const listQ = useQuery({
    queryKey: ["eip", "announcements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("announcement").select("*")
        .order("is_pinned", { ascending: false })
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Announcement[];
    },
  });

  // 顯示對照用：含已停用者，保留離職同仁的歷史姓名（建立者、未讀名單）
  const usersQ = useAllUsers();
  // 選人用：只在職（指定人員 chip、audience_type="all" 的對象展開）
  const activeUsersQ = useActiveUsers();

  const deptsQ = useQuery({
    queryKey: ["eip", "departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("department").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Department[];
    },
  });

  const userMap = useMemo(() => new Map((usersQ.data ?? []).map((u) => [u.id, u])), [usersQ.data]);

  // 帶 ?open=<id> 進來：展開該公告並捲動、短暫高亮。只做一次，之後清掉網址參數，
  // 避免後續任何列表 refetch（置頂／發布／刪除／編輯）又重複捲動與高亮。
  const { open: openId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const handledOpenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!openId || !listQ.data) return;
    if (handledOpenRef.current === openId) return;
    if (!listQ.data.some((a) => a.id === openId)) return;
    handledOpenRef.current = openId;
    setExpandedIds((prev) => (prev.has(openId) ? prev : new Set(prev).add(openId)));
    const t = setTimeout(() => {
      const el = document.getElementById(`ann-${openId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-primary", "rounded-lg");
        setTimeout(() => el.classList.remove("ring-2", "ring-primary", "rounded-lg"), 2200);
      }
      void navigate({ search: { open: undefined }, replace: true });
    }, 100);
    return () => clearTimeout(t);
  }, [openId, listQ.data, navigate]);

  const refetchList = () => qc.invalidateQueries({ queryKey: ["eip", "announcements"] });

  const doDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    // 先清相關 target / read,避免 FK 阻擋。這兩句失敗就不要往下走，
    // 否則下一句會撞 FK,使用者只會看到難懂的 23503。
    const { error: tErr } = await supabase
      .from("announcement_target").delete().eq("announcement_id", deleting.id);
    if (tErr) { setDeleteBusy(false); toast.error(humanizeError(tErr, "刪除")); return; }
    const { error: rErr } = await supabase
      .from("announcement_read").delete().eq("announcement_id", deleting.id);
    if (rErr) { setDeleteBusy(false); toast.error(humanizeError(rErr, "刪除")); return; }
    const { error } = await supabase.from("announcement").delete().eq("id", deleting.id);
    setDeleteBusy(false);
    if (error) { toast.error(humanizeError(error, "刪除")); return; }
    toast.success("公告已刪除");
    setExpandedIds((prev) => { const n = new Set(prev); n.delete(deleting.id); return n; });
    setDeleting(null);
    refetchList();
  };

  if (listQ.isLoading) return <div className="text-muted-foreground py-8">載入中…</div>;

  return (
    <div>
      <PageHeader title="公告"
        description="發布公司或部門公告，並追蹤已讀狀態。"
        actions={
          <div className="flex items-center gap-2">
            <ExportAnnouncementsBtn rows={listQ.data ?? []} userMap={userMap} />
            {canPublish && appUser && (
              <Button onClick={() => setOpenCreate(true)}><Plus className="w-4 h-4" />發布公告</Button>
            )}
          </div>
        }
      />
      <div className="space-y-2">
        {(listQ.data ?? []).map((a) => (
          <div key={a.id} id={`ann-${a.id}`} className="transition-shadow">
          <AnnouncementRow
            announcement={a}
            appUser={appUser ?? null}
            users={activeUsersQ.data ?? []}
            userMap={userMap}
            expanded={expandedIds.has(a.id)}
            onToggle={() => toggleExpand(a.id)}
            onEdit={() => setEditing(a)}
            onDelete={() => setDeleting(a)}
            onChanged={refetchList}
          />
          </div>
        ))}
        {(listQ.data ?? []).length === 0 && (
          <Card>
            <CardContent className="py-12 text-center space-y-3">
              <div className="text-sm text-muted-foreground">
                {canPublish
                  ? "目前沒有公告,點右上「發布公告」建立第一則公告。"
                  : "目前沒有公告。"}
              </div>
              {canPublish && appUser && (
                <Button size="sm" onClick={() => setOpenCreate(true)}>
                  <Plus className="w-4 h-4" /> 發布公告
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {openCreate && appUser && (
        <AnnouncementFormDialog
          mode="create"
          open={openCreate} onClose={() => setOpenCreate(false)} appUser={appUser}
          users={activeUsersQ.data ?? []} departments={deptsQ.data ?? []}
          onSaved={refetchList}
        />
      )}
      {editing && appUser && (
        <AnnouncementFormDialog
          mode="edit"
          announcement={editing}
          open={!!editing} onClose={() => setEditing(null)} appUser={appUser}
          users={activeUsersQ.data ?? []} departments={deptsQ.data ?? []}
          onSaved={refetchList}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && !deleteBusy && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定刪除公告？</AlertDialogTitle>
            <AlertDialogDescription>
              即將刪除「{deleting?.title}」,相關已讀紀錄與發送對象也會一併移除。刪除後無法復原。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteBusy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); void doDelete(); }}
            >
              {deleteBusy ? "刪除中…" : "確認刪除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AnnouncementFormDialog({
  mode, announcement, open, onClose, appUser, users, departments, onSaved,
}: {
  mode: "create" | "edit";
  announcement?: Announcement;
  open: boolean; onClose: () => void; appUser: AppUser;
  users: AppUser[]; departments: Department[]; onSaved: () => void;
}) {
  const isDeptMgr = appUser.role === "dept_manager";
  const isEdit = mode === "edit" && !!announcement;

  // 載入既有對象（編輯模式）
  const targetsQ = useQuery({
    enabled: isEdit,
    queryKey: ["eip", "ann-targets", announcement?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("announcement_target").select("*").eq("announcement_id", announcement!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const [title, setTitle] = useState(announcement?.title ?? "");
  const [body, setBody] = useState(announcement?.body ?? "");
  const [audience, setAudience] = useState<Audience>(
    announcement?.audience_type ?? (isDeptMgr ? "department" : "all"),
  );
  const [pinned, setPinned] = useState(announcement?.is_pinned ?? false);
  const [publish, setPublish] = useState(
    isEdit ? !!announcement?.published_at : true,
  );
  const [targetDepts, setTargetDepts] = useState<string[]>(
    isDeptMgr && appUser.department_id && !isEdit ? [appUser.department_id] : [],
  );
  const [targetUsers, setTargetUsers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isEdit && targetsQ.data) {
      setTargetDepts(targetsQ.data.map((t: any) => t.department_id).filter(Boolean));
      setTargetUsers(targetsQ.data.map((t: any) => t.user_id).filter(Boolean));
    }
  }, [isEdit, targetsQ.data]);

  const toggle = (list: string[], setList: (v: string[]) => void, id: string) =>
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const submit = async () => {
    if (!title.trim() || !body.trim()) return toast.error("請輸入標題與內文");
    // 選了「指定部門／指定人員」卻沒勾任何對象時，後端 eip_can_see_announcement()
    // 找不到 target 就誰都看不到 —— 等於發出一則沒人收得到、也不會產生通知的公告。
    if (audience === "department" && targetDepts.length === 0)
      return toast.error("請至少選擇一個部門，否則這則公告沒有人看得到");
    if (audience === "users" && targetUsers.length === 0)
      return toast.error("請至少選擇一位收件人，否則這則公告沒有人看得到");
    setBusy(true);
    try {
      let aid: string;
      if (isEdit) {
        const payload: any = {
          title: title.trim(),
          body: body.trim(),
          audience_type: audience,
          is_pinned: pinned,
        };
        // 發布狀態切換：未發布→發布給予 published_at;發布→撤回則清空
        if (publish && !announcement!.published_at) payload.published_at = new Date().toISOString();
        if (!publish && announcement!.published_at) payload.published_at = null;
        const { error } = await supabase.from("announcement").update(payload).eq("id", announcement!.id);
        if (error) throw error;
        aid = announcement!.id;
        // 重設對象。這句被擋掉時若照插新對象，會變成「舊對象＋新對象」並存
        // （公告仍發給已經移除的部門／人員），所以一定要接錯誤。
        const { error: dErr } = await supabase
          .from("announcement_target").delete().eq("announcement_id", aid);
        if (dErr) throw dErr;
      } else {
        const { data: created, error } = await supabase.from("announcement").insert({
          tenant_id: appUser.tenant_id ?? DEFAULT_TENANT_ID,
          title: title.trim(), body: body.trim(),
          audience_type: audience, is_pinned: pinned,
          published_at: publish ? new Date().toISOString() : null,
          created_by: appUser.id,
        }).select("*").single();
        if (error) throw error;
        aid = (created as Announcement).id;
      }

      if (audience === "department" && targetDepts.length) {
        const { error: tErr } = await supabase.from("announcement_target")
          .insert(targetDepts.map((d) => ({ announcement_id: aid, department_id: d })));
        if (tErr) throw tErr;
      } else if (audience === "users" && targetUsers.length) {
        const { error: tErr } = await supabase.from("announcement_target")
          .insert(targetUsers.map((u) => ({ announcement_id: aid, user_id: u })));
        if (tErr) throw tErr;
      }
      toast.success(isEdit ? "已儲存" : (publish ? "已發布" : "已存為草稿"));
      onSaved(); onClose();
    } catch (e) { toast.error(humanizeError(e, "儲存公告")); }
    finally { setBusy(false); }
  };

  // 部門清單一律列出全部（主管已可發全公司，指定部門不應更嚴）；後端 RLS 仍以「公告建立者」把關。
  const visibleDepts = departments;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{isEdit ? "編輯公告" : "發布公告"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <Field label="標題"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="內文"><Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          <Field label="對象">
            <Select value={audience} onValueChange={(v) => setAudience(v as Audience)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{AUDIENCE_LABEL.all}</SelectItem>
                <SelectItem value="department">{AUDIENCE_LABEL.department}</SelectItem>
                <SelectItem value="users">{AUDIENCE_LABEL.users}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {audience === "department" && (
            <Field label="部門">
              <div className="flex flex-wrap gap-2 p-2 border rounded-md">
                {visibleDepts.map((d) => (
                  <button key={d.id} type="button" onClick={() => toggle(targetDepts, setTargetDepts, d.id)}
                    className={`text-xs px-2 py-1 rounded-md border ${targetDepts.includes(d.id) ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>
                    {d.name}
                  </button>
                ))}
              </div>
            </Field>
          )}
          {audience === "users" && (
            <Field label="人員">
              <div className="flex flex-wrap gap-2 p-2 border rounded-md max-h-32 overflow-y-auto">
                {users.map((u) => (
                  <button key={u.id} type="button" onClick={() => toggle(targetUsers, setTargetUsers, u.id)}
                    className={`text-xs px-2 py-1 rounded-md border ${targetUsers.includes(u.id) ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>
                    {u.name}
                  </button>
                ))}
              </div>
            </Field>
          )}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={pinned} onCheckedChange={(v) => setPinned(!!v)} /> 置頂
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={publish} onCheckedChange={(v) => setPublish(!!v)} />
              {isEdit ? "發布狀態（取消勾選則回到草稿）" : "立即發布（取消勾選則存為草稿）"}
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={submit} disabled={busy}>
            {isEdit ? "儲存" : (publish ? "發布" : "存草稿")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AnnouncementRow({
  announcement: a, appUser, users, userMap, expanded, onToggle, onEdit, onDelete, onChanged,
}: {
  announcement: Announcement;
  appUser: AppUser | null;
  users: AppUser[];
  userMap: Map<string, AppUser>;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canEdit = canEditAnnouncement(a, appUser, can);
  const canDel = canDeleteAnnouncement(a, appUser, can);

  const isOwnerOrAdmin = !!appUser && (appUser.role === "company_admin" || appUser.id === a.created_by);

  // 展開時若已發布且當前使用者尚未讀，標為已讀
  useEffect(() => {
    if (!expanded || !appUser || !a.published_at) return;
    void supabase.from("announcement_read")
      .upsert({ announcement_id: a.id, user_id: appUser.id }, { onConflict: "announcement_id,user_id" });
  }, [expanded, a.id, a.published_at, appUser?.id]);

  const readsQ = useQuery({
    enabled: expanded && isOwnerOrAdmin,
    queryKey: ["eip", "ann-reads", a.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("announcement_read").select("user_id,read_at").eq("announcement_id", a.id);
      if (error) throw error;
      return (data ?? []) as { user_id: string; read_at: string }[];
    },
  });

  const targetsQ = useQuery({
    enabled: expanded && isOwnerOrAdmin,
    queryKey: ["eip", "ann-targets", a.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("announcement_target").select("*").eq("announcement_id", a.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const audienceUserIds = useMemo(() => {
    if (!isOwnerOrAdmin) return [] as string[];
    if (a.audience_type === "all") return users.map((u) => u.id);
    const targets = targetsQ.data ?? [];
    if (a.audience_type === "users") {
      return targets.map((t: any) => t.user_id).filter(Boolean);
    }
    const deptIds = targets.map((t: any) => t.department_id).filter(Boolean);
    return users.filter((u) => u.department_id && deptIds.includes(u.department_id)).map((u) => u.id);
  }, [isOwnerOrAdmin, a.audience_type, targetsQ.data, users]);

  const readIds = new Set((readsQ.data ?? []).map((r) => r.user_id));
  const unread = audienceUserIds.filter((id) => !readIds.has(id));
  const [opErr, setOpErr] = useState<string | null>(null);

  const togglePin = async () => {
    setOpErr(null);
    const { error } = await supabase.from("announcement")
      .update({ is_pinned: !a.is_pinned }).eq("id", a.id);
    if (error) { const msg = humanizeError(error, "更新"); setOpErr(msg); toast.error(msg); return; }
    toast.success("已更新"); qc.invalidateQueries({ queryKey: ["eip", "announcements"] }); onChanged();
  };
  const publish = async () => {
    setOpErr(null);
    const { error } = await supabase.from("announcement")
      .update({ published_at: new Date().toISOString() }).eq("id", a.id);
    if (error) { const msg = humanizeError(error, "發布"); setOpErr(msg); toast.error(msg); return; }
    toast.success("已發布"); qc.invalidateQueries({ queryKey: ["eip", "announcements"] }); onChanged();
  };

  return (
    <Collapsible open={expanded} onOpenChange={onToggle} asChild>
      <Card>
        <CollapsibleTrigger asChild>
          <div className="p-3 flex items-start gap-3 cursor-pointer hover:bg-accent/40 transition-colors select-none">
            <Megaphone className="w-4 h-4 mt-0.5 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {a.is_pinned && <Pin className="w-3 h-3 text-amber-600" />}
                <span className="font-medium text-sm truncate">{a.title}</span>
                {!a.published_at && <Badge variant="outline" className="text-[11.5px]">草稿</Badge>}
              </div>
              {!expanded && (
                <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{a.body}</div>
              )}
              <div className="text-xs text-muted-foreground mt-1">
                {userMap.get(a.created_by)?.name ?? "—"}
                {a.published_at && ` ・ ${new Date(a.published_at).toLocaleString("zh-TW")}`}
              </div>
            </div>
            <Badge variant="secondary" className="text-[11.5px]">{AUDIENCE_LABEL[a.audience_type]}</Badge>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
            {(canEdit || canDel) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
                    aria-label="更多操作"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  {canEdit && (
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(); }}>
                      <Pencil className="w-3.5 h-3.5 mr-2" /> 編輯
                    </DropdownMenuItem>
                  )}
                  {canDel && (
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-2" /> 刪除
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
          <div className="px-3 pb-3 pt-0 border-t">
            <div className="text-xs text-muted-foreground mt-3">
              對象：{AUDIENCE_LABEL[a.audience_type]}
              {!a.published_at && " ・ 尚未發布（草稿）"}
            </div>
            <div className="text-sm whitespace-pre-wrap mt-2">{a.body}</div>

            {isOwnerOrAdmin && a.published_at && (
              <div className="rounded-md border p-3 bg-muted/30 mt-3">
                <div className="text-xs font-semibold text-muted-foreground mb-1">
                  已讀 {readIds.size}/{audienceUserIds.length}
                </div>
                {unread.length > 0 ? (
                  <div className="text-xs">
                    <span className="text-muted-foreground">未讀：</span>
                    {unread.map((id) => userMap.get(id)?.name ?? id.slice(0, 6)).join("、")}
                  </div>
                ) : audienceUserIds.length > 0 && (
                  <div className="text-xs text-muted-foreground">全部已讀</div>
                )}
              </div>
            )}

            {opErr && <div className="text-xs text-destructive mt-2">{opErr}</div>}

            <div className="flex flex-wrap gap-2 mt-3">
              {canEdit && (
                <Button size="sm" variant="outline" onClick={onEdit}>
                  <Pencil className="w-4 h-4 mr-1" /> 編輯
                </Button>
              )}
              {isOwnerOrAdmin && !a.published_at && (
                <Button size="sm" onClick={publish}>立即發布</Button>
              )}
              {isOwnerOrAdmin && (
                <Button size="sm" variant="outline" onClick={togglePin}>
                  {a.is_pinned ? "取消置頂" : "置頂"}
                </Button>
              )}
              {canDel && (
                <Button size="sm" variant="destructive" onClick={onDelete}>
                  <Trash2 className="w-4 h-4 mr-1" /> 刪除
                </Button>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
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

const AUDIENCE_EXPORT: Record<string, string> = { all: "全公司", department: "指定部門", users: "指定人員" };
function ExportAnnouncementsBtn({ rows, userMap }: { rows: Announcement[]; userMap: Map<string, AppUser> }) {
  const { can } = useAuth();
  if (!can("eip_announcements", "export")) return null;
  return (
    <Button variant="outline" onClick={() => exportToExcel({
      filename: "EIP公告", sheetName: "公告", rows,
      columns: [
        { header: "標題", key: "title" },
        { header: "是否置頂", key: "is_pinned", map: (r) => r.is_pinned ? "是" : "否" },
        { header: "發布對象", key: "audience_type", map: (r) => AUDIENCE_EXPORT[r.audience_type] ?? r.audience_type },
        { header: "建立者", key: "created_by", map: (r) => userMap.get(r.created_by)?.name ?? "" },
        { header: "發布時間", key: "published_at", map: (r) => r.published_at ? new Date(r.published_at).toLocaleString("zh-TW") : "草稿" },
        { header: "內容", key: "body" },
        { header: "建立時間", key: "created_at", map: (r) => new Date(r.created_at).toLocaleString("zh-TW") },
      ],
    })}>
      <Download className="w-4 h-4" /> 匯出 Excel
    </Button>
  );
}
