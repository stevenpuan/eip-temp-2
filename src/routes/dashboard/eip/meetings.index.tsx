import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus, CalendarDays, Download, MoreHorizontal, Pencil, Trash2, Users, MapPin,
} from "lucide-react";
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { Database } from "@/integrations/supabase/types";
import { VisibilityScopeFields, VisibilityBadge, validateVisibility, type VisibilityScope } from "@/components/eip/VisibilityScope";
import { humanizeError } from "@/lib/eip-error";
import { taipeiToday } from "@/lib/eip-routine";

type Department = { id: string; name: string; parent_id: string | null; sort_order: number | null };

export const Route = createFileRoute("/dashboard/eip/meetings/")({
  component: MeetingsPage,
});

type Meeting = Database["public"]["Tables"]["meeting"]["Row"];
type AppUser = Database["public"]["Tables"]["app_user"]["Row"];
type Project = Database["public"]["Tables"]["project"]["Row"];
type ActionItem = Database["public"]["Tables"]["meeting_action_item"]["Row"];
type ActionStatus = Database["public"]["Enums"]["action_item_status"];
type MeetingStatus = Database["public"]["Enums"]["meeting_status"];
type MeetingType = Database["public"]["Enums"]["meeting_type"];

export const STATUS_LABEL: Record<MeetingStatus, string> = {
  draft: "草稿", scheduled: "已排程", in_progress: "進行中", done: "已結束", cancelled: "已取消",
};
export const TYPE_LABEL: Record<MeetingType, string> = {
  regular: "例會", project: "專案會議", adhoc: "臨時會議",
};
const ACTION_LABEL: Record<ActionStatus, string> = {
  open: "待處理", converted: "已轉任務", done: "已完成",
};

export function statusBadgeClass(s: MeetingStatus): string {
  switch (s) {
    case "done": return "bg-slate-200 text-slate-700 border-slate-300";
    case "in_progress": return "bg-emerald-100 text-emerald-700 border-emerald-300";
    case "scheduled": return "bg-blue-100 text-blue-700 border-blue-300";
    case "draft": return "bg-slate-100 text-slate-500 border-slate-200";
    case "cancelled": return "bg-red-100 text-red-700 border-red-300 line-through";
  }
}

type CanFn = (key: string, action?: "view" | "create" | "edit" | "delete" | "export") => boolean;

function canManageMeeting(m: Meeting, appUser: AppUser | null, can: CanFn): boolean {
  if (!appUser) return false;
  if (m.created_by === appUser.id) return true;
  return can("eip_meetings", "edit") || can("eip_meetings", "delete");
}


function MeetingsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { appUser } = useEipUser();
  const { can } = useAuth();
  const canCreate = can("eip_meetings", "create");

  const [openCreate, setOpenCreate] = useState(false);
  const [deleteMeeting, setDeleteMeeting] = useState<Meeting | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const meetingsQ = useQuery({
    queryKey: ["eip", "meetings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meeting").select("*").order("meeting_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Meeting[];
    },
  });

  // 顯示對照用：含已停用者，保留離職同仁的歷史姓名
  const usersQ = useAllUsers();
  // 選人用：只在職（與會者、行動項負責人與篩選）
  const activeUsersQ = useActiveUsers();

  const projectsQ = useQuery({
    queryKey: ["eip", "projects"],
    queryFn: async () => {
      const { data, error } = await supabase.from("project").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Project[];
    },
  });

  const deptsQ = useQuery({
    queryKey: ["eip", "departments-tree"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("department").select("id,name,parent_id,sort_order")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Department[];
    },
  });
  const deptMap = useMemo(() => new Map((deptsQ.data ?? []).map((d) => [d.id, { name: d.name }])), [deptsQ.data]);

  const attendeesCountQ = useQuery({
    queryKey: ["eip", "meeting-attendee-counts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("meeting_attendee").select("meeting_id");
      if (error) throw error;
      const map = new Map<string, number>();
      (data ?? []).forEach((r: { meeting_id: string }) => {
        map.set(r.meeting_id, (map.get(r.meeting_id) ?? 0) + 1);
      });
      return map;
    },
  });

  const userMap = useMemo(() => {
    const m = new Map<string, AppUser>();
    (usersQ.data ?? []).forEach((u) => m.set(u.id, u));
    return m;
  }, [usersQ.data]);

  const filtered = useMemo(() => {
    return (meetingsQ.data ?? []).filter((m) => {
      if (statusFilter !== "all" && m.status !== statusFilter) return false;
      if (typeFilter !== "all" && m.meeting_type !== typeFilter) return false;
      if (keyword && !m.title.toLowerCase().includes(keyword.toLowerCase())) return false;
      return true;
    });
  }, [meetingsQ.data, statusFilter, typeFilter, keyword]);

  if (meetingsQ.isLoading) return <div className="text-muted-foreground py-8">載入中…</div>;

  return (
    <div>
      <PageHeader
        title="會議"
        description="建立會議、紀錄議程與會議紀錄，並追蹤行動項目。"
        actions={
          <div className="flex items-center gap-2">
            <ExportMeetingsBtn meetings={meetingsQ.data ?? []} userMap={userMap} />
            {canCreate && appUser && (
              <Button onClick={() => setOpenCreate(true)}>
                <Plus className="w-4 h-4" /> 新增會議
              </Button>
            )}
          </div>
        }
      />

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">會議列表</TabsTrigger>
          <TabsTrigger value="actions">決議追蹤</TabsTrigger>
        </TabsList>
        <TabsContent value="list">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Input
              placeholder="搜尋會議標題…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="w-56"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">所有狀態</SelectItem>
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">所有類型</SelectItem>
                {Object.entries(TYPE_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground ml-auto">共 {filtered.length} 筆</span>
          </div>

          <div className="space-y-2">
            {filtered.map((m) => {
              const canManage = canManageMeeting(m, appUser, can);
              const count = attendeesCountQ.data?.get(m.id) ?? 0;
              return (
                <Card
                  key={m.id}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => navigate({ to: "/dashboard/eip/meetings/$id", params: { id: m.id } })}
                >
                  <CardContent className="p-3 flex items-center gap-3 flex-wrap sm:flex-nowrap">
                    <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{m.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                        <span>{new Date(m.meeting_date).toLocaleString("zh-TW")}</span>
                        {m.location && (
                          <span className="inline-flex items-center gap-0.5">
                            <MapPin className="w-3 h-3" />{m.location}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge variant="outline" className={`text-xs ${statusBadgeClass(m.status)}`}>
                      {STATUS_LABEL[m.status]}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {TYPE_LABEL[m.meeting_type]}
                    </Badge>
                    <VisibilityBadge scope={(m as any).visibility_scope} departmentId={(m as any).department_id} deptMap={deptMap} />
                    <Badge variant="outline" className="text-xs inline-flex items-center gap-1">
                      <Users className="w-3 h-3" />{count}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {userMap.get(m.created_by)?.name ?? "—"}
                    </Badge>
                    {canManage && (
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
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate({ to: "/dashboard/eip/meetings/$id", params: { id: m.id } });
                            }}
                          >
                            <Pencil className="w-3.5 h-3.5 mr-2" /> 編輯
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={(e) => { e.stopPropagation(); setDeleteMeeting(m); }}
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-2" /> 刪除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {filtered.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center space-y-3">
                  <div className="text-sm text-muted-foreground">
                    {keyword || statusFilter !== "all" || typeFilter !== "all"
                      ? "沒有符合篩選條件的會議。"
                      : "目前沒有會議,點右上「新增會議」建立第一場會議。"}
                  </div>
                  {canCreate && appUser && !(keyword || statusFilter !== "all" || typeFilter !== "all") && (
                    <Button size="sm" onClick={() => setOpenCreate(true)}>
                      <Plus className="w-4 h-4" /> 新增會議
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
        <TabsContent value="actions">
          <ActionItemsTracker meetings={meetingsQ.data ?? []} users={activeUsersQ.data ?? []} userMap={userMap} />
        </TabsContent>
      </Tabs>

      {openCreate && appUser && (
        <CreateMeetingDialog
          open={openCreate}
          onClose={() => setOpenCreate(false)}
          appUser={appUser}
          users={activeUsersQ.data ?? []}
          projects={projectsQ.data ?? []}
          departments={deptsQ.data ?? []}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ["eip", "meetings"] });
            qc.invalidateQueries({ queryKey: ["eip", "meeting-attendee-counts"] });
          }}
        />
      )}

      <AlertDialog open={!!deleteMeeting} onOpenChange={(o) => !o && !deleting && setDeleteMeeting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定刪除會議？</AlertDialogTitle>
            <AlertDialogDescription>
              即將刪除「{deleteMeeting?.title}」,相關議程與行動項目可能一併移除。刪除後無法復原。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault();
                if (!deleteMeeting) return;
                setDeleting(true);
                const { data, error } = await supabase
                  .from("meeting").delete().eq("id", deleteMeeting.id).select("id");
                setDeleting(false);
                if (error) { toast.error(humanizeError(error, "刪除")); return; }
                // 被 RLS 擋掉時回 0 列而 error 是 null；原本一律跳「會議已刪除」，重新整理才發現還在。
                if (!data?.length) { toast.error("刪除失敗：沒有權限刪除這場會議"); return; }
                toast.success("會議已刪除");
                setDeleteMeeting(null);
                qc.invalidateQueries({ queryKey: ["eip", "meetings"] });
                qc.invalidateQueries({ queryKey: ["eip", "meeting-attendee-counts"] });
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

function CreateMeetingDialog({
  open, onClose, appUser, users, projects, departments, onCreated,
}: {
  open: boolean; onClose: () => void; appUser: AppUser;
  users: AppUser[]; projects: Project[]; departments: Department[]; onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState<string>(() => {
    const d = new Date(); d.setMinutes(0, 0, 0);
    // eslint-disable-next-line no-restricted-syntax -- datetime-local 輸入框需要「本地牆上時鐘」字串；此處先扣掉時區位移再取 slice(0,16) 是正確用法
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [location, setLocation] = useState("");
  const [meetingType, setMeetingType] = useState<MeetingType>("regular");
  const [status, setStatus] = useState<MeetingStatus>("scheduled");
  const [agenda, setAgenda] = useState("");
  const [projectId, setProjectId] = useState<string>("none");
  const [attendees, setAttendees] = useState<string[]>([appUser.id]);
  const [vScope, setVScope] = useState<VisibilityScope>(appUser.department_id ? "department" : "company");
  const [deptId, setDeptId] = useState<string | null>(appUser.department_id ?? null);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) =>
    setAttendees((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const submit = async () => {
    if (!title.trim()) return toast.error("請輸入會議標題");
    const v = validateVisibility(vScope, deptId);
    if (!v.ok) return toast.error(v.error);
    setBusy(true);
    try {
      const { data: created, error } = await supabase
        .from("meeting")
        .insert({
          tenant_id: appUser.tenant_id ?? DEFAULT_TENANT_ID,
          title: title.trim(),
          meeting_date: new Date(date).toISOString(),
          location: location.trim() || null,
          agenda: agenda.trim() || null,
          project_id: projectId === "none" ? null : projectId,
          meeting_type: meetingType,
          status,
          created_by: appUser.id,
          visibility_scope: v.payload.visibility_scope,
          department_id: v.payload.department_id,
        })
        .select("*").single();
      if (error) throw error;
      const mid = (created as Meeting).id;
      if (attendees.length) {
        const { error: aErr } = await supabase
          .from("meeting_attendee")
          .insert(attendees.map((uid) => ({ meeting_id: mid, user_id: uid })));
        if (aErr) throw aErr;
      }
      toast.success("會議已建立");
      onCreated(); onClose();
    } catch (e) {
      toast.error(humanizeError(e, "建立"));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>新增會議</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <Field label="標題"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="時間">
              <Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="地點">
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="會議室 / 線上連結" />
            </Field>
            <Field label="會議類型">
              <Select value={meetingType} onValueChange={(v) => setMeetingType(v as MeetingType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="狀態">
              <Select value={status} onValueChange={(v) => setStatus(v as MeetingStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="所屬專案">
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">無</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="議程備註">
            <Textarea rows={4} value={agenda} onChange={(e) => setAgenda(e.target.value)} />
          </Field>
          <Field label="與會者">
            <div className="flex flex-wrap gap-2 p-2 border rounded-md max-h-32 overflow-y-auto">
              {users.map((u) => (
                <button key={u.id} type="button" onClick={() => toggle(u.id)}
                  className={`text-xs px-2 py-1 rounded-md border ${attendees.includes(u.id) ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>
                  {u.name}
                </button>
              ))}
            </div>
          </Field>
          <VisibilityScopeFields
            scope={vScope} onScopeChange={setVScope}
            deptId={deptId} onDeptIdChange={setDeptId}
            departments={departments}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={submit} disabled={busy}>建立</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function ExportMeetingsBtn({ meetings, userMap }: { meetings: Meeting[]; userMap: Map<string, AppUser> }) {
  const { can } = useAuth();
  if (!can("eip_meetings", "export")) return null;
  return (
    <Button variant="outline" onClick={() => exportToExcel({
      filename: "EIP會議", sheetName: "會議", rows: meetings,
      columns: [
        { header: "標題", key: "title" },
        { header: "會議時間", key: "meeting_date", map: (r) => new Date(r.meeting_date).toLocaleString("zh-TW") },
        { header: "地點", key: "location", map: (r) => r.location ?? "" },
        { header: "類型", key: "meeting_type", map: (r) => TYPE_LABEL[r.meeting_type] },
        { header: "狀態", key: "status", map: (r) => STATUS_LABEL[r.status] },
        { header: "建立者", key: "created_by", map: (r) => userMap.get(r.created_by)?.name ?? "" },
        { header: "議程", key: "agenda", map: (r) => r.agenda ?? "" },
        { header: "紀錄", key: "notes", map: (r) => r.notes ?? "" },
        { header: "建立時間", key: "created_at", map: (r) => new Date(r.created_at).toLocaleString("zh-TW") },
      ],
    })}>
      <Download className="w-4 h-4" /> 匯出 Excel
    </Button>
  );
}

function ActionItemsTracker({ meetings, users, userMap }: { meetings: Meeting[]; users: AppUser[]; userMap: Map<string, AppUser> }) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [keyword, setKeyword] = useState("");

  const itemsQ = useQuery({
    queryKey: ["eip", "action-items-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meeting_action_item").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ActionItem[];
    },
  });

  const meetingMap = useMemo(() => new Map(meetings.map((m) => [m.id, m])), [meetings]);
  const today = taipeiToday(); // 台北今天，勿用 toISOString（清晨會退回昨天，逾期判定錯位）

  const filtered = useMemo(() => {
    return (itemsQ.data ?? []).filter((it) => {
      if (statusFilter !== "all" && it.status !== statusFilter) return false;
      if (ownerFilter !== "all" && it.owner_id !== ownerFilter) return false;
      if (onlyOverdue) {
        if (!it.due_date || it.due_date >= today || it.status === "done") return false;
      }
      if (keyword && !it.content.toLowerCase().includes(keyword.toLowerCase())) return false;
      return true;
    });
  }, [itemsQ.data, statusFilter, ownerFilter, onlyOverdue, keyword, today]);

  const setStatus = async (id: string, status: ActionStatus) => {
    const { data, error } = await supabase
      .from("meeting_action_item").update({ status }).eq("id", id).select("id");
    if (error) { toast.error(humanizeError(error, "更新狀態")); return; }
    // 0 列＝被 RLS 擋掉（error 為 null）。原本會靜默 refetch 讓下拉彈回原值，沒有任何提示。
    if (!data?.length) { toast.error("更新失敗：沒有權限變更決議事項的狀態"); }
    else qc.invalidateQueries({ queryKey: ["eip", "action-items-all"] });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="搜尋…" value={keyword} onChange={(e) => setKeyword(e.target.value)} className="w-48" />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">所有狀態</SelectItem>
            <SelectItem value="open">待處理</SelectItem>
            <SelectItem value="converted">已轉任務</SelectItem>
            <SelectItem value="done">已完成</SelectItem>
          </SelectContent>
        </Select>
        <Select value={ownerFilter} onValueChange={setOwnerFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">所有負責人</SelectItem>
            {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} />
          僅逾期
        </label>
        <span className="text-xs text-muted-foreground ml-auto">共 {filtered.length} 筆</span>
      </div>

      <Card><CardContent className="p-0 overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground text-sm">無符合條件的決議事項</div>
        ) : (
          <div className="divide-y">
            {filtered.map((it) => {
              const overdue = it.due_date && it.due_date < today && it.status !== "done";
              const m = meetingMap.get(it.meeting_id);
              return (
                <div key={it.id} className="p-3 flex items-center gap-3 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className={overdue ? "text-red-600" : ""}>{it.content}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                      {m && (
                        <Link
                          to="/dashboard/eip/meetings/$id"
                          params={{ id: m.id }}
                          className="hover:underline text-primary"
                        >
                          會議：{m.title}
                        </Link>
                      )}
                      <span>負責：{it.owner_id ? userMap.get(it.owner_id)?.name ?? "—" : "未指派"}</span>
                      {it.due_date && <span>期限 {it.due_date}{overdue && " ⚠ 逾期"}</span>}
                      <Badge variant="outline" className="text-[11.5px]">{ACTION_LABEL[it.status]}</Badge>
                      {it.linked_task_id && (
                        <Link to="/dashboard/eip/tasks" className="text-primary hover:underline">→ 已連結任務</Link>
                      )}
                    </div>
                  </div>
                  <Select value={it.status} onValueChange={(v) => setStatus(it.id, v as ActionStatus)}>
                    <SelectTrigger className="w-[120px] h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">待處理</SelectItem>
                      <SelectItem value="converted">已轉任務</SelectItem>
                      <SelectItem value="done">已完成</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        )}
      </CardContent></Card>
    </div>
  );
}
