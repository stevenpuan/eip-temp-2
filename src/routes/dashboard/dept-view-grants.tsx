import { createFileRoute } from "@tanstack/react-router";
import { RequirePerm } from "@/components/RequirePerm";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Share2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { humanizeError } from "@/lib/eip-error";
import { isPickableUser } from "@/hooks/useUsers";

// 跨部門「唯讀」資料授權設定頁。
// 後端：表 eip_dept_view_grant + 函式 eip_can_view_dept_shared()（migration cross_dept_view_share_readonly）。
// 僅授予檢視（任務/專案/會議/臨時回報/文件/常態工作），不含工作日誌、不影響編輯權限。
export const Route = createFileRoute("/dashboard/dept-view-grants")({
  component: () => (
    <RequirePerm module="role_permissions">
      <Page />
    </RequirePerm>
  ),
});

interface Grant {
  id: string;
  user_id: string;
  department_id: string | null;
  include_subtree: boolean;
  is_active: boolean;
  note: string | null;
}
interface Dept { id: string; name: string; }
interface UserLite { id: string; name: string; department_id: string | null; }

const ALL = "__ALL__";
const EMPTY: Grant[] = [];

function Page() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const editable = can("role_permissions", "edit");

  const { data: grantsData } = useQuery({
    queryKey: ["dept_view_grant_all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eip_dept_view_grant")
        .select("id,user_id,department_id,include_subtree,is_active,note")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Grant[];
    },
  });
  const { data: depts = [] } = useQuery({
    queryKey: ["departments_min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("department").select("id,name").order("sort_order");
      if (error) throw error;
      return data as Dept[];
    },
  });
  const { data: users = [] } = useQuery({
    queryKey: ["appusers_min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_user")
        .select("id,name,department_id,hide_from_pickers")
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      // 系統帳號（開發者）不列入可選人員
      return (data ?? []).filter(isPickableUser) as UserLite[];
    },
  });

  const grants = grantsData ?? EMPTY;
  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? "未知人員";
  const deptName = (id: string | null) =>
    id == null ? "全部門" : depts.find((d) => d.id === id)?.name ?? "—";

  const byUser = useMemo(() => {
    const m = new Map<string, Grant[]>();
    grants.forEach((g) => {
      const a = m.get(g.user_id) ?? [];
      a.push(g);
      m.set(g.user_id, a);
    });
    return Array.from(m.entries());
  }, [grants]);

  const [uId, setUId] = useState("");
  const [dId, setDId] = useState("");
  const [subtree, setSubtree] = useState(true);

  const add = async () => {
    if (!uId) { toast.error("請選擇人員"); return; }
    if (!dId) { toast.error("請選擇部門"); return; }
    const department_id = dId === ALL ? null : dId;
    const { error } = await supabase.from("eip_dept_view_grant").insert({
      user_id: uId,
      department_id,
      include_subtree: department_id == null ? true : subtree,
    });
    if (error) {
      toast.error(error.code === "23505" ? "這個人對此部門的授權已存在" : humanizeError(error, "新增授權"));
      return;
    }
    toast.success("已新增授權");
    setDId("");
    qc.invalidateQueries({ queryKey: ["dept_view_grant_all"] });
  };

  const toggleActive = async (g: Grant) => {
    const { error } = await supabase.from("eip_dept_view_grant").update({ is_active: !g.is_active }).eq("id", g.id);
    if (error) { toast.error(humanizeError(error, "更新授權")); return; }
    qc.invalidateQueries({ queryKey: ["dept_view_grant_all"] });
  };
  const toggleSubtree = async (g: Grant) => {
    if (g.department_id == null) return;
    const { error } = await supabase.from("eip_dept_view_grant").update({ include_subtree: !g.include_subtree }).eq("id", g.id);
    if (error) { toast.error(humanizeError(error, "更新授權")); return; }
    qc.invalidateQueries({ queryKey: ["dept_view_grant_all"] });
  };
  const remove = async (g: Grant) => {
    const { error } = await supabase.from("eip_dept_view_grant").delete().eq("id", g.id);
    if (error) { toast.error(humanizeError(error, "移除授權")); return; }
    toast.success("已刪除");
    qc.invalidateQueries({ queryKey: ["dept_view_grant_all"] });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="跨部門資料授權"
        description="讓指定人員「唯讀」看到其他部門的資料（任務、專案、會議、臨時回報、文件、常態工作）。不含工作日誌；此處僅授予檢視，不影響編輯權限。"
      />

      {editable && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed p-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            人員
            <select value={uId} onChange={(e) => setUId(e.target.value)} className="h-9 rounded-md border bg-card px-2 text-sm min-w-[160px]">
              <option value="">選擇人員…</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            可檢視部門
            <select value={dId} onChange={(e) => setDId(e.target.value)} className="h-9 rounded-md border bg-card px-2 text-sm min-w-[160px]">
              <option value="">選擇部門…</option>
              <option value={ALL}>＊ 全部門</option>
              {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label className={`flex items-center gap-1.5 text-sm h-9 ${dId === ALL || !dId ? "opacity-40" : ""}`}>
            <input type="checkbox" checked={subtree} disabled={dId === ALL || !dId} onChange={(e) => setSubtree(e.target.checked)} />
            含子部門（課）
          </label>
          <Button variant="outline" size="sm" onClick={add}>
            <Plus className="w-4 h-4 mr-1" /> 新增授權
          </Button>
        </div>
      )}

      {byUser.length === 0 ? (
        <p className="text-xs text-muted-foreground px-1">尚無跨部門授權。</p>
      ) : (
        <div className="space-y-4">
          {byUser.map(([uid, list]) => (
            <div key={uid} className="rounded-xl border overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/50 text-sm font-medium border-b">
                <Share2 className="w-4 h-4 text-muted-foreground" />
                {userName(uid)}
              </div>
              {list.map((g) => (
                <div key={g.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 border-b last:border-b-0 ${g.is_active ? "" : "bg-muted/30 opacity-60"}`}>
                  <span className="text-sm font-medium min-w-[120px]">{deptName(g.department_id)}</span>
                  {g.department_id == null ? (
                    <span className="text-[12.5px] text-muted-foreground">（全公司所有部門）</span>
                  ) : (
                    <button disabled={!editable} onClick={() => toggleSubtree(g)}
                      className={`text-[12.5px] px-2.5 py-1 rounded-full border ${g.include_subtree ? "bg-primary/10 text-primary border-primary/40" : "bg-card text-muted-foreground"}`}>
                      {g.include_subtree ? "含子部門" : "僅本部門"}
                    </button>
                  )}
                  <div className="ml-auto flex items-center gap-3">
                    <button disabled={!editable} onClick={() => toggleActive(g)}
                      className={`text-[12.5px] px-2.5 py-1 rounded-full border ${g.is_active ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/40" : "bg-card text-muted-foreground"}`}>
                      {g.is_active ? "啟用中" : "已停用"}
                    </button>
                    {editable && (
                      <button onClick={() => remove(g)} className="text-muted-foreground hover:text-destructive" aria-label="刪除授權">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        授權為「唯讀」：被授權人能看到該部門的任務／專案／會議／臨時回報／文件／常態工作，但不能修改，也看不到該部門的工作日誌。若要讓某人實際管理某部門（可編輯、可批示工作日誌），請改在組織設定把他設為該部門督導。
      </p>
    </div>
  );
}
