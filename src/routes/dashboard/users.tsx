import { isPickableUser } from "@/hooks/useUsers";
import { createFileRoute } from "@tanstack/react-router";
import { RequirePerm } from "@/components/RequirePerm";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { humanizeError } from "@/lib/eip-error";

export const Route = createFileRoute("/dashboard/users")({ component: () => (
    <RequirePerm module="users">
      <UsersPage />
    </RequirePerm>
  ) });

interface CreatedAccount { email: string; password: string }
interface ResetResult { email: string; name: string | null; password: string; revoked: number }


interface RoleRow { id: string; code: string; name: string }
interface DepartmentRow { id: string; name: string }
interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
  status: string;
  created_at: string;
  user_roles?: { role_id: string; roles: { code: string; name: string } | null }[];
}
interface AppUserRow {
  id: string;
  department_id: string | null;
  line_user_id: string | null;
  status: string | null;
  deputy_id?: string | null;
  name?: string | null;
  hide_from_pickers?: boolean | null;
}
interface Invitation {
  id: string;
  code: string;
  email: string | null;
  status: string;
  expires_at: string | null;
  roles?: { name: string } | null;
}

const statusLabel: Record<string, string> = {
  pending: "待審核", active: "已啟用", disabled: "已停用", rejected: "已拒絕",
};
const invStatusLabel: Record<string, string> = { unused: "未使用", used: "已使用", expired: "已過期" };

function genCode() {
  return (
    Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6)
  ).toUpperCase();
}

function UsersPage() {
  const { can, user, roles: myRoles } = useAuth();
  const qc = useQueryClient();
  const editable = can("users", "edit");
  const deletable = can("users", "delete");
  const canCreateAccount = myRoles.includes("admin") || myRoles.includes("manager");
  // 重設密碼：與後端 eip_admin_reset_password 同一把尺（帳號管理編輯權，或系統管理者）
  const canResetPassword = editable || myRoles.includes("admin");


  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*, user_roles(role_id, roles(code,name))")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ProfileRow[];
    },
  });
  const { data: appUsers = [] } = useQuery({
    queryKey: ["app_users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_user")
        .select("id, department_id, line_user_id, status, deputy_id, name, hide_from_pickers");
      if (error) throw error;
      return (data ?? []) as AppUserRow[];
    },
  });
  const { data: roles = [] } = useQuery({
    queryKey: ["roles"],
    queryFn: async () => {
      const { data } = await supabase.from("roles").select("id,name,code").order("created_at");
      return (data ?? []) as RoleRow[];
    },
  });
  const { data: depts = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data } = await supabase.from("department").select("id,name").order("name");
      return (data ?? []) as DepartmentRow[];
    },
  });
  const { data: invitations = [] } = useQuery({
    queryKey: ["invitations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invitations")
        .select("*, roles(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Invitation[];
    },
  });

  const appUserMap = useMemo(() => {
    const m: Record<string, AppUserRow> = {};
    appUsers.forEach((a) => { m[a.id] = a; });
    return m;
  }, [appUsers]);
  const deptMap = useMemo(() => {
    const m: Record<string, string> = {};
    depts.forEach((d) => { m[d.id] = d.name; });
    return m;
  }, [depts]);

  const setStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("profiles").update({ status }).eq("id", id);
    if (error) { toast.error(humanizeError(error, "更新狀態")); return; }
    // 同步 app_user.status：active → active；其他 → inactive。
    // 這句一定要接錯誤：所有人員下拉（任務負責人、代理人、對接人員、公告指定人員）
    // 讀的都是 app_user.status='active'，同步失敗卻報「已更新」，離職同仁會繼續出現在選單裡。
    const appStatus = status === "active" ? "active" : "inactive";
    const { error: auErr } = await supabase.from("app_user").update({ status: appStatus }).eq("id", id);
    if (auErr) {
      toast.error(`帳號狀態只更新了一半：${humanizeError(auErr, "同步人員名冊")}。請重試，否則此人仍會出現在各人員選單。`);
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["app_users"] });
      return;
    }
    if (status === "active") {
      const { data: existing } = await supabase.from("user_roles").select("role_id").eq("user_id", id);
      if (!existing || existing.length === 0) {
        const { data: role } = await supabase.from("roles").select("id").eq("code", "member").maybeSingle();
        if (role) await supabase.from("user_roles").insert({ user_id: id, role_id: role.id });
      }
    }
    toast.success("已更新");
    qc.invalidateQueries({ queryKey: ["users"] });
    qc.invalidateQueries({ queryKey: ["app_users"] });
  };

  // ---- 編輯抽屜 ----
  const [editing, setEditing] = useState<ProfileRow | null>(null);
  const [editRoleIds, setEditRoleIds] = useState<string[]>([]);
  const [editDept, setEditDept] = useState<string>("none");
  const [editLine, setEditLine] = useState<string>("");
  const [editDeputy, setEditDeputy] = useState<string>("none");

  const openEdit = (row: ProfileRow) => {
    setEditing(row);
    setEditRoleIds((row.user_roles ?? []).map((x) => x.role_id).filter(Boolean) as string[]);
    const a = appUserMap[row.id];
    setEditDept(a?.department_id ?? "none");
    setEditLine(a?.line_user_id ?? "");
    setEditDeputy(a?.deputy_id ?? "none");
  };
  const toggleRole = (id: string) => {
    setEditRoleIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };
  const saveEdit = async () => {
    if (!editing) return;
    const deptManagerRole = roles.find((r) => r.code === "dept_manager");
    if (deptManagerRole && editRoleIds.includes(deptManagerRole.id) && editDept === "none") {
      toast.error("指派「部門主管」時必須同時設定部門");
      return;
    }
    // 透過後端 RPC 一次完成角色更新（避免 RLS 中間態錯誤）
    const { error: rpcErr } = await supabase.rpc("eip_set_user_roles", {
      p_user_id: editing.id,
      p_role_ids: editRoleIds,
    });
    if (rpcErr) { toast.error(humanizeError(rpcErr, "角色更新")); return; }
    // 寫回 app_user（部門 / LINE / 代理人）。
    // 不再用 appUserMap 先判斷有沒有列 —— 改成看實際更新筆數，
    // 0 筆代表這個人沒有 app_user 列或被 RLS 擋掉，必須讓使用者知道。
    const { data: updated, error } = await supabase.from("app_user").update({
      department_id: editDept === "none" ? null : editDept,
      line_user_id: editLine.trim() || null,
      deputy_id: editDeputy === "none" ? null : editDeputy,
    }).eq("id", editing.id).select("id");
    if (error) { toast.error(humanizeError(error, "儲存成員資料")); return; }
    if (!updated || updated.length === 0) {
      toast.error("找不到這位同仁的成員資料，部門／LINE／代理人未儲存，請聯絡系統管理者");
      return;
    }
    toast.success("已儲存");
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["users"] });
    qc.invalidateQueries({ queryKey: ["app_users"] });
  };

  const [invRole, setInvRole] = useState("member");
  const [invEmail, setInvEmail] = useState("");
  const [invDays, setInvDays] = useState("7");
  const generate = async () => {
    const roleObj = roles.find((r) => r.code === invRole) ?? roles.find((r) => r.code === "member");
    const days = parseInt(invDays || "7", 10);
    const { error } = await supabase.from("invitations").insert({
      code: genCode(),
      email: invEmail || null,
      role_id: roleObj?.id ?? null,
      invited_by: user?.id ?? null,
      expires_at: new Date(Date.now() + days * 86400000).toISOString(),
    });
    if (error) { toast.error(humanizeError(error, "建立邀請碼")); return; }
    toast.success("已產生邀請碼");
    setInvEmail("");
    qc.invalidateQueries({ queryKey: ["invitations"] });
  };
  const copy = (code: string) => {
    navigator.clipboard?.writeText(code);
    toast.success("已複製：" + code);
  };

  // ---- 新增帳號 ----
  const [createOpen, setCreateOpen] = useState(false);
  const [cEmail, setCEmail] = useState("");
  const [cName, setCName] = useState("");
  const [cRole, setCRole] = useState("member");
  const [cDept, setCDept] = useState<string>("none");
  const [cSubmitting, setCSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedAccount | null>(null);

  const resetCreate = () => {
    setCEmail(""); setCName(""); setCRole("member"); setCDept("none");
    setCreated(null); setCSubmitting(false);
  };
  const openCreate = () => { resetCreate(); setCreateOpen(true); };
  const closeCreate = () => {
    setCreateOpen(false);
    if (created) qc.invalidateQueries({ queryKey: ["users"] });
    setTimeout(resetCreate, 200);
  };
  const submitCreate = async () => {
    if (!cEmail.trim() || !cName.trim()) { toast.error("請填寫 email 與姓名"); return; }
    setCSubmitting(true);
    const { data, error } = await supabase.rpc("eip_admin_create_user", {
      p_email: cEmail.trim(),
      p_full_name: cName.trim(),
      p_role_code: cRole,
      p_department_id: cDept === "none" ? null : cDept,
    });
    setCSubmitting(false);
    if (error) { toast.error(humanizeError(error, "新增使用者")); return; }
    const d = data as { ok?: boolean; email?: string; password?: string } | null;
    if (d?.ok && d.password && d.email) {
      setCreated({ email: d.email, password: d.password });
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["app_users"] });
    } else {
      toast.error("建立失敗");
    }
  };
  const copyPassword = async () => {
    if (!created) return;
    try { await navigator.clipboard.writeText(created.password); toast.success("已複製初始密碼"); }
    catch { toast.error("複製失敗,請手動選取"); }
  };

  // ---- 重設密碼 ----
  // 系統原本沒有任何重設出路：登入頁沒有「忘記密碼」，同仁忘記密碼就只能請人直接改資料庫。
  // 這裡走 RPC eip_admin_reset_password：產生臨時密碼、強制登出所有裝置、寫 audit_logs。
  const [resetting, setResetting] = useState<ProfileRow | null>(null);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetDone, setResetDone] = useState<ResetResult | null>(null);
  const openReset = (row: ProfileRow) => { setResetting(row); setResetDone(null); setResetSubmitting(false); };
  const closeReset = () => { setResetting(null); setResetDone(null); setResetSubmitting(false); };
  const confirmReset = async () => {
    if (!resetting) return;
    setResetSubmitting(true);
    const { data, error } = await supabase.rpc("eip_admin_reset_password", { p_user_id: resetting.id });
    setResetSubmitting(false);
    if (error) { toast.error(humanizeError(error, "重設密碼")); return; }
    const d = data as { ok?: boolean; email?: string; name?: string | null; password?: string; revoked_sessions?: number } | null;
    if (!d?.ok || !d.password || !d.email) { toast.error("重設密碼失敗，請重新整理後再試"); return; }
    setResetDone({ email: d.email, name: d.name ?? null, password: d.password, revoked: d.revoked_sessions ?? 0 });
  };
  const copyResetPassword = async () => {
    if (!resetDone) return;
    try { await navigator.clipboard.writeText(resetDone.password); toast.success("已複製臨時密碼"); }
    catch { toast.error("複製失敗，請手動選取"); }
  };

  // ---- 永久刪除 ----
  const [deleting, setDeleting] = useState<ProfileRow | null>(null);
  const [delConfirm, setDelConfirm] = useState("");
  const [delSubmitting, setDelSubmitting] = useState(false);
  const openDelete = (row: ProfileRow) => { setDeleting(row); setDelConfirm(""); };
  const closeDelete = () => { setDeleting(null); setDelConfirm(""); setDelSubmitting(false); };
  const confirmDelete = async () => {
    if (!deleting) return;
    setDelSubmitting(true);
    const { error } = await supabase.rpc("eip_admin_delete_user", { p_user_id: deleting.id });
    setDelSubmitting(false);
    if (error) { toast.error(humanizeError(error, "刪除使用者")); return; }
    toast.success("已永久刪除");
    qc.invalidateQueries({ queryKey: ["users"] });
    qc.invalidateQueries({ queryKey: ["app_users"] });
    closeDelete();
  };



  const pending = rows.filter((r) => r.status === "pending");
  const active = rows.filter((r) => r.status === "active");

  const renderTable = (list: ProfileRow[]) => (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <Table className="min-w-[900px] [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
          <TableHeader>
            <TableRow>
              <TableHead>姓名</TableHead>
              <TableHead>信箱</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>部門</TableHead>
              <TableHead>LINE</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead>建立時間</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">沒有資料</TableCell></TableRow>
            )}
            {list.map((r) => {
              const a = appUserMap[r.id];
              const userRoleNames = (r.user_roles ?? []).map((x) => x.roles?.name).filter(Boolean) as string[];
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.full_name ?? "—"}</TableCell>
                  <TableCell>{r.email}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {userRoleNames.length === 0
                        ? <span className="text-muted-foreground text-sm">—</span>
                        : userRoleNames.map((n) => <Badge key={n} variant="secondary">{n}</Badge>)}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {a?.department_id ? deptMap[a.department_id] ?? "—" : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {a?.line_user_id
                      ? <Badge variant="default">已綁</Badge>
                      : <Badge variant="outline">未綁</Badge>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.status === "active" ? "default" : r.status === "pending" ? "secondary" : "outline"}>
                      {statusLabel[r.status] ?? r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right space-x-2 whitespace-nowrap">
                    {editable && r.status === "pending" && (
                      <>
                        <Button size="sm" onClick={() => setStatus(r.id, "active")}>核准</Button>
                        <Button size="sm" variant="outline" onClick={() => setStatus(r.id, "rejected")}>拒絕</Button>
                      </>
                    )}
                    {editable && r.status === "active" && (
                      <Button size="sm" variant="outline" onClick={() => setStatus(r.id, "disabled")}>停用</Button>
                    )}
                    {editable && (r.status === "disabled" || r.status === "rejected") && (
                      <Button size="sm" variant="outline" onClick={() => setStatus(r.id, "active")}>啟用</Button>
                    )}
                    {editable && (
                      <Button size="sm" variant="secondary" onClick={() => openEdit(r)}>編輯</Button>
                    )}
                    {canResetPassword && r.id !== user?.id && (
                      <Button size="sm" variant="outline" onClick={() => openReset(r)}>重設密碼</Button>
                    )}
                    {deletable && r.status === "disabled" && (
                      <Button size="sm" variant="destructive" onClick={() => openDelete(r)}>永久刪除</Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="帳號管理"
        description="統一管理帳號、角色、部門、LINE 綁定與啟用狀態（單一資料來源）"
        actions={canCreateAccount ? (
          <Button onClick={openCreate}>+ 新增帳號</Button>
        ) : undefined}
      />
      {isLoading ? (
        <p className="text-muted-foreground">載入中…</p>
      ) : (
        <Tabs defaultValue="active">
          <div className="overflow-x-auto">
            <TabsList>
              <TabsTrigger value="pending">待審核 ({pending.length})</TabsTrigger>
              <TabsTrigger value="active">已啟用 ({active.length})</TabsTrigger>
              <TabsTrigger value="all">全部 ({rows.length})</TabsTrigger>
              <TabsTrigger value="invite">邀請碼</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="pending" className="mt-4">{renderTable(pending)}</TabsContent>
          <TabsContent value="active" className="mt-4">{renderTable(active)}</TabsContent>
          <TabsContent value="all" className="mt-4">{renderTable(rows)}</TabsContent>
          <TabsContent value="invite" className="mt-4 space-y-4">
            {editable && (
              <Card>
                <CardContent className="py-4 grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
                  <div className="space-y-1">
                    <Label className="text-xs">角色</Label>
                    <Select value={invRole} onValueChange={setInvRole}>
                      <SelectTrigger className="w-full lg:w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {roles.map((r) => <SelectItem key={r.id} value={r.code}>{r.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">指定信箱（選填）</Label>
                    <Input className="w-full lg:w-56" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">有效天數</Label>
                    <Input className="w-full lg:w-24" type="number" value={invDays} onChange={(e) => setInvDays(e.target.value)} />
                  </div>
                  <Button onClick={generate} className="w-full sm:w-auto">產生邀請碼</Button>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <Table className="min-w-[720px] [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
                  <TableHeader>
                    <TableRow>
                      <TableHead>邀請碼</TableHead>
                      <TableHead>角色</TableHead>
                      <TableHead>信箱</TableHead>
                      <TableHead>狀態</TableHead>
                      <TableHead>到期</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invitations.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">尚無邀請碼</TableCell></TableRow>
                    )}
                    {invitations.map((iv) => (
                      <TableRow key={iv.id}>
                        <TableCell className="font-mono">{iv.code}</TableCell>
                        <TableCell>{iv.roles?.name ?? "—"}</TableCell>
                        <TableCell>{iv.email ?? "—"}</TableCell>
                        <TableCell><Badge variant={iv.status === "unused" ? "secondary" : "outline"}>{invStatusLabel[iv.status] ?? iv.status}</Badge></TableCell>
                        <TableCell className="text-muted-foreground">{iv.expires_at ? new Date(iv.expires_at).toLocaleDateString() : "—"}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => copy(iv.code)}>複製</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <p className="text-xs text-muted-foreground">
              使用方式：把邀請碼給對方，對方在登入頁「註冊」時填入邀請碼，即自動啟用並取得指定角色。
            </p>
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>編輯帳號 — {editing?.full_name ?? editing?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs">角色（可多選，框架角色 = 唯一權限來源）</Label>
              <div className="grid grid-cols-2 gap-2">
                {roles.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-muted">
                    <Checkbox checked={editRoleIds.includes(r.id)} onCheckedChange={() => toggleRole(r.id)} />
                    <span>{r.name}</span>
                    <span className="text-muted-foreground text-xs ml-auto">{r.code}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">部門（指派「部門主管」時必填，決定 EIP 部門資料範圍）</Label>
              <Select value={editDept} onValueChange={setEditDept}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未設定</SelectItem>
                  {depts.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">LINE User ID（之後做綁定流程；目前可顯示／清除）</Label>
              <div className="flex gap-2">
                <Input value={editLine} onChange={(e) => setEditLine(e.target.value)} placeholder="未綁定" />
                {editLine && (
                  <Button type="button" variant="outline" onClick={() => setEditLine("")}>清除</Button>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">職務代理人（此人請假/離開時代理處理通知）</Label>
              <Select value={editDeputy} onValueChange={setEditDeputy}>
                <SelectTrigger><SelectValue placeholder="未設定" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未設定</SelectItem>
                  {appUsers
                    .filter((a) => a.status === "active" && a.id !== editing?.id && isPickableUser(a))
                    .map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name ?? a.id}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {editDeputy !== "none" && (
                <p className="text-xs text-muted-foreground">
                  目前職代：{appUserMap[editDeputy]?.name ?? "—"}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
            <Button onClick={saveEdit}>儲存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) closeCreate(); }}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{created ? "建立成功" : "新增帳號"}</DialogTitle>
          </DialogHeader>
          {!created ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Email *</Label>
                <Input type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} placeholder="user@example.com" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">姓名 *</Label>
                <Input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="王小明" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">角色 *</Label>
                <Select value={cRole} onValueChange={setCRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => <SelectItem key={r.id} value={r.code}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">部門（選填）</Label>
                <Select value={cDept} onValueChange={setCDept}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">（不指定）</SelectItem>
                    {depts.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeCreate} disabled={cSubmitting}>取消</Button>
                <Button onClick={submitCreate} disabled={cSubmitting}>
                  {cSubmitting ? "建立中…" : "建立"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                初始密碼僅顯示這一次,請複製轉交,並提醒首次登入後修改密碼。
              </p>
              <div className="space-y-1">
                <Label className="text-xs">Email</Label>
                <Input value={created.email} readOnly />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">初始密碼</Label>
                <div className="flex gap-2">
                  <Input value={created.password} readOnly className="font-mono" />
                  <Button type="button" variant="outline" onClick={copyPassword}>複製</Button>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={closeCreate}>完成</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetting} onOpenChange={(o) => { if (!o) closeReset(); }}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{resetDone ? "已重設密碼" : "重設密碼"}</DialogTitle>
          </DialogHeader>
          {!resetDone ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                將為 <span className="font-medium text-foreground">{resetting?.full_name ?? resetting?.email}</span> 產生一組新的臨時密碼。
                原本的密碼立即失效，該帳號在所有裝置上的登入狀態也會被登出。
              </p>
              <p className="text-sm text-muted-foreground">
                新密碼只會顯示這一次，請複製後親自轉交本人，並提醒他登入後到「個人設定」改成自己的密碼。
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={closeReset} disabled={resetSubmitting}>取消</Button>
                <Button onClick={confirmReset} disabled={resetSubmitting}>
                  {resetSubmitting ? "重設中…" : "確認重設"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                臨時密碼僅顯示這一次，請複製轉交{resetDone.name ? `給 ${resetDone.name}` : ""}，並提醒登入後到「個人設定」修改密碼。
                {resetDone.revoked > 0 ? `原有的 ${resetDone.revoked} 個登入裝置已一併登出。` : ""}
              </p>
              <div className="space-y-1">
                <Label className="text-xs">帳號</Label>
                <Input value={resetDone.email} readOnly />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">臨時密碼</Label>
                <div className="flex gap-2">
                  <Input value={resetDone.password} readOnly className="font-mono" />
                  <Button type="button" variant="outline" onClick={copyResetPassword}>複製</Button>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={closeReset}>完成</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(o) => { if (!o) closeDelete(); }}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>永久刪除帳號</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              此操作無法復原。將永久刪除帳號 <span className="font-medium text-foreground">{deleting?.full_name ?? deleting?.email}</span>。
              請輸入該帳號姓名「<span className="font-medium text-foreground">{deleting?.full_name ?? ""}</span>」以確認。
            </p>
            <div className="space-y-1">
              <Label className="text-xs">輸入姓名以確認</Label>
              <Input value={delConfirm} onChange={(e) => setDelConfirm(e.target.value)} placeholder={deleting?.full_name ?? ""} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDelete} disabled={delSubmitting}>取消</Button>
            <Button
              variant="destructive"
              disabled={delSubmitting || !deleting?.full_name || delConfirm.trim() !== (deleting?.full_name ?? "").trim()}
              onClick={confirmDelete}
            >
              {delSubmitting ? "刪除中…" : "永久刪除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
