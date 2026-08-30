import { createFileRoute } from "@tanstack/react-router";
import { RequirePerm } from "@/components/RequirePerm";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { humanizeError } from "@/lib/eip-error";

// 「子頁面權限」分頁先關掉。
// 這一層在後端**完全沒有消費者**：所有 RLS 政策與 eip_has_perm() 只讀
// role_module_permissions，沒有任何一處讀 role_page_permissions（該表至今 0 列）。
// 也就是說使用者在那個分頁勾了什麼、按了儲存、看到「已儲存」，實際上一點作用都沒有 ——
// 而且因為畫面說得像真的，反而會讓人以為某個頁面已經鎖起來了。
// 這比功能缺一塊更危險，所以先把入口收掉，程式碼保留（savePage 等一併留著），
// 等哪天後端真的實作了兩層權限再打開這個旗標。查證日 2026-08-30。
const SHOW_PAGE_PERMISSIONS: boolean = false;

export const Route = createFileRoute("/dashboard/role-permissions")({ component: () => (
    <RequirePerm module="role_permissions">
      <RolePermPage />
    </RequirePerm>
  ) });

const ACTIONS: [string, string][] = [
  ["can_view", "檢視"],
  ["can_create", "新增"],
  ["can_edit", "編輯"],
  ["can_delete", "刪除"],
  ["can_export", "匯出"],
];

interface Role { id: string; code: string; name: string; is_system: boolean; }

const EMPTY_ROWS: any[] = [];

function RolePermPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const editable = can("role_permissions", "edit");

  const { data: roles = [] } = useQuery({
    queryKey: ["roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("roles").select("*").order("created_at");
      if (error) throw error;
      return data as Role[];
    },
  });
  const { data: pages = [] } = useQuery({
    queryKey: ["perm_pages"],
    queryFn: async () => {
      const { data, error } = await supabase.from("menus").select("module_key,page_key,title,sort_order").not("module_key", "is", null).order("sort_order");
      if (error) throw error;
      const seen = new Set<string>();
      const out: { key: string; title: string }[] = [];
      (data as any[]).forEach((m) => {
        const key = m.module_key as string;
        if (!seen.has(key)) { seen.add(key); out.push({ key, title: m.title }); }
      });
      return out;
    },
  });

  const [roleId, setRoleId] = useState("");
  useEffect(() => { if (!roleId && roles.length) setRoleId(roles[0].id); }, [roles, roleId]);
  const role = roles.find((r) => r.id === roleId);
  const isAdminRole = role?.code === "admin";

  const { data: permsData } = useQuery({
    queryKey: ["rmp", roleId], enabled: !!roleId,
    queryFn: async () => { const { data, error } = await supabase.from("role_module_permissions").select("*").eq("role_id", roleId); if (error) throw error; return data as any[]; },
  });
  // 穩定參考，避免 useEffect 無限重跑
  const perms = permsData ?? EMPTY_ROWS;
  const [draft, setDraft] = useState<Record<string, any>>({});
  useEffect(() => { const m: Record<string, any> = {}; perms.forEach((p: any) => (m[p.module_key] = p)); setDraft(m); }, [perms]);
  const mFlag = (k: string, a: string) => (isAdminRole ? true : !!draft[k]?.[a]);
  const mToggle = (k: string, a: string) => {
    if (!editable || isAdminRole) return;
    setDraft((d) => ({ ...d, [k]: { ...(d[k] ?? { role_id: roleId, module_key: k, can_view: false, can_create: false, can_edit: false, can_delete: false, can_export: false }), [a]: !d[k]?.[a] } }));
  };
  const saveModule = async () => {
    const rows = pages.map((p) => ({
      role_id: roleId, module_key: p.key,
      can_view: !!draft[p.key]?.can_view, can_create: !!draft[p.key]?.can_create,
      can_edit: !!draft[p.key]?.can_edit, can_delete: !!draft[p.key]?.can_delete, can_export: !!draft[p.key]?.can_export,
    }));
    const { error } = await supabase.from("role_module_permissions").upsert(rows, { onConflict: "role_id,module_key" });
    if (error) { toast.error(humanizeError(error, "儲存模組權限")); return; }
    toast.success("模組權限已儲存"); qc.invalidateQueries({ queryKey: ["rmp", roleId] });
  };

  const { data: ppData } = useQuery({
    queryKey: ["rpp", roleId], enabled: !!roleId,
    queryFn: async () => { const { data, error } = await supabase.from("role_page_permissions").select("*").eq("role_id", roleId); if (error) throw error; return data as any[]; },
  });
  const pp = ppData ?? EMPTY_ROWS;
  const [pDraft, setPDraft] = useState<Record<string, any>>({});
  useEffect(() => { const m: Record<string, any> = {}; pp.forEach((p: any) => (m[p.page_key] = p)); setPDraft(m); }, [pp]);
  const pVal = (k: string, a: string): boolean | null => {
    const v = pDraft[k]?.[a];
    return v === true ? true : v === false ? false : null;
  };
  const pCycle = (k: string, a: string) => {
    if (!editable || isAdminRole) return;
    const cur = pVal(k, a);
    const next = cur === null ? true : cur === true ? false : null;
    setPDraft((d) => ({ ...d, [k]: { ...(d[k] ?? { role_id: roleId, page_key: k }), [a]: next } }));
  };
  const savePage = async () => {
    const rows = pages
      .map((p) => ({ role_id: roleId, page_key: p.key, can_view: pVal(p.key, "can_view"), can_create: pVal(p.key, "can_create"), can_edit: pVal(p.key, "can_edit"), can_delete: pVal(p.key, "can_delete"), can_export: pVal(p.key, "can_export") }))
      .filter((r) => [r.can_view, r.can_create, r.can_edit, r.can_delete, r.can_export].some((x) => x !== null));
    // 先 upsert 再刪：交易安全。原本「先 delete 全部再 insert」若 insert 失敗，
    // 該角色所有子頁權限會被清空且救不回。改成先寫入，成功後才刪掉本次已取消覆寫的列。
    if (rows.length) {
      const { error } = await supabase.from("role_page_permissions").upsert(rows, { onConflict: "role_id,page_key" });
      if (error) { toast.error(humanizeError(error, "儲存頁面權限")); return; }
    }
    const keep = rows.map((r) => r.page_key);
    let del = supabase.from("role_page_permissions").delete().eq("role_id", roleId);
    if (keep.length) del = del.not("page_key", "in", `(${keep.join(",")})`);
    const { error: delErr } = await del;
    if (delErr) { toast.error(humanizeError(delErr, "更新頁面權限")); return; }
    toast.success("子頁面權限已儲存"); qc.invalidateQueries({ queryKey: ["rpp", roleId] });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="角色權限"
        description={SHOW_PAGE_PERMISSIONS
          ? "兩層權限：模組層為基礎，子頁面層細部覆寫（未設定則繼承）"
          : "以模組為單位設定各角色的檢視／新增／編輯／刪除／匯出權限"}
      />
      <div className="flex flex-wrap gap-2">
        {roles.map((r) => (
          <button key={r.id} onClick={() => setRoleId(r.id)}
            className={"rounded-md border px-3 py-1.5 text-sm transition-colors " + (r.id === roleId ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent")}>
            {r.name}{r.is_system && <span className="ml-1 text-[11.5px] opacity-70">內建</span>}
          </button>
        ))}
      </div>
      {isAdminRole && <p className="text-sm text-muted-foreground">管理員擁有全部權限，無法調整。</p>}

      <Tabs defaultValue="module">
        {SHOW_PAGE_PERMISSIONS && (
          <TabsList>
            <TabsTrigger value="module">模組權限</TabsTrigger>
            <TabsTrigger value="page">子頁面權限</TabsTrigger>
          </TabsList>
        )}

        <TabsContent value="module" className="mt-4 space-y-3">
          {editable && !isAdminRole && <div className="flex justify-end"><Button onClick={saveModule}>儲存模組權限</Button></div>}
          <Card><CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>模組</TableHead>{ACTIONS.map(([k, l]) => <TableHead key={k} className="text-center">{l}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {pages.map((p) => (
                  <TableRow key={p.key}>
                    <TableCell className="font-medium">{p.title}</TableCell>
                    {ACTIONS.map(([a]) => (
                      <TableCell key={a} className="text-center">
                        <Checkbox checked={mFlag(p.key, a)} disabled={!editable || isAdminRole} onCheckedChange={() => mToggle(p.key, a)} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {SHOW_PAGE_PERMISSIONS && (
        <TabsContent value="page" className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">點格子切換：繼承 → 開 → 關。「繼承」表示沿用模組層設定。</p>
          {editable && !isAdminRole && <div className="flex justify-end"><Button onClick={savePage}>儲存子頁面權限</Button></div>}
          <Card><CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>頁面</TableHead>{ACTIONS.map(([k, l]) => <TableHead key={k} className="text-center">{l}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {pages.map((p) => (
                  <TableRow key={p.key}>
                    <TableCell className="font-medium">{p.title}</TableCell>
                    {ACTIONS.map(([a]) => {
                      const v = isAdminRole ? true : pVal(p.key, a);
                      const txt = v === true ? "開" : v === false ? "關" : "繼承";
                      return (
                        <TableCell key={a} className="text-center">
                          <button disabled={!editable || isAdminRole} onClick={() => pCycle(p.key, a)}
                            className={cn("min-w-[44px] rounded-md border px-2 py-1 text-xs",
                              v === true ? "bg-primary text-primary-foreground border-primary" :
                              v === false ? "bg-destructive text-white border-destructive" :
                              "text-muted-foreground")}>
                            {txt}
                          </button>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
