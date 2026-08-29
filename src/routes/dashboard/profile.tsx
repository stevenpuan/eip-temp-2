import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useEipUserOptional } from "@/lib/eip-user";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Copy, CheckCircle2, Link2, Link2Off } from "lucide-react";
import { humanizeError } from "@/lib/eip-error";

export const Route = createFileRoute("/dashboard/profile")({ component: Page });

function Page() {
  const { profile, user, roleNames, refresh } = useAuth();
  // 這個頁面在 EipUserProvider 之外，取不到就是 null，不能用會 throw 的 useEipUser()。
  const eipUser = useEipUserOptional();
  const [fullName, setFullName] = useState("");
  const [pw, setPw] = useState("");

  useEffect(() => {
    setFullName(profile?.full_name ?? "");
  }, [profile]);

  const saveProfile = async () => {
    if (!user) return;
    const name = fullName.trim();
    if (!name) { toast.error("姓名不可空白"); return; }
    const { data: pRow, error } = await supabase
      .from("profiles").update({ full_name: name }).eq("id", user.id).select("id");
    if (error) { toast.error(humanizeError(error, "更新個人資料")); return; }
    if (!pRow?.length) { toast.error("更新個人資料失敗：沒有寫入任何資料，請重新整理後再試"); return; }
    // 全站顯示姓名讀的是 app_user.name，不是 profiles.full_name。
    // profiles 的同步觸發器只有 AFTER INSERT，而且是 coalesce(app_user.name, ...)（舊名非空就不覆寫），
    // 所以這裡必須自己一起寫，否則改了名字任務、會議、日誌上還是舊名字，而且永遠不會變。
    const { data: uRow, error: uErr } = await supabase
      .from("app_user").update({ name }).eq("id", user.id).select("id");
    if (uErr || !uRow?.length) {
      toast.error(
        uErr
          ? `姓名只更新了一半：${humanizeError(uErr, "同步人員名冊")}。任務與會議上仍會顯示舊名字，請重試。`
          : "姓名只更新了一半：人員名冊沒有寫入，任務與會議上仍會顯示舊名字，請重試。",
      );
      await refresh();
      return;
    }
    // refresh() 只重載 profiles + user_roles，不碰 app_user；而全站顯示姓名讀的是
    // app_user.name，所以這裡要一起 reload，否則側欄與任務上的名字要整頁重新載入才會變，
    // 使用者會以為同步失敗。
    await Promise.all([refresh(), eipUser?.reload() ?? Promise.resolve()]);
    toast.success("已更新個人資料");
  };

  const changePassword = async () => {
    if (pw.length < 8) { toast.error("密碼至少 8 碼"); return; }
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) { toast.error(humanizeError(error, "變更密碼")); return; }
    toast.success("密碼已更新");
    setPw("");
  };

  return (
    <div className="space-y-6">
      <PageHeader title="個人設定" description="管理你的個人資料與密碼" />
      <Card>
        <CardHeader><CardTitle className="text-base">個人資料</CardTitle></CardHeader>
        <CardContent className="space-y-4 max-w-md">
          <div className="space-y-1"><Label>姓名</Label><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
          <div className="space-y-1"><Label>Email</Label><Input value={profile?.email ?? ""} disabled /></div>
          <div className="space-y-1"><Label>角色</Label><Input value={roleNames.join("、") || "—"} disabled /></div>
          <Button onClick={saveProfile}>儲存</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">修改密碼</CardTitle></CardHeader>
        <CardContent className="space-y-4 max-w-md">
          <div className="space-y-1"><Label>新密碼</Label><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="至少 8 碼" /></div>
          <Button onClick={changePassword}>更新密碼</Button>
        </CardContent>
      </Card>
      {user && <LineBindingCard userId={user.id} />}
    </div>
  );
}

function LineBindingCard({ userId }: { userId: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const statusQ = useQuery({
    queryKey: ["app_user-line", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_user")
        .select("line_user_id")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return (data?.line_user_id as string | null) ?? null;
    },
  });

  const bound = !!statusQ.data;

  const generate = async () => {
    setBusy(true); setErr(null);
    try {
      const { data, error } = await supabase.rpc("eip_generate_line_bind_code");
      if (error) throw error;
      setCode(String(data));
    } catch (e) {
      setErr(humanizeError(e, "產生綁定碼"));
    } finally { setBusy(false); }
  };

  const unbind = async () => {
    setBusy(true); setErr(null);
    try {
      const { error } = await supabase.from("app_user").update({ line_user_id: null }).eq("id", userId);
      if (error) throw error;
      setCode(null);
      toast.success("已解除綁定");
      await statusQ.refetch();
    } catch (e) {
      setErr(humanizeError(e, "解除綁定"));
    } finally { setBusy(false); }
  };

  const copyCode = async () => {
    if (!code) return;
    try { await navigator.clipboard.writeText(code); toast.success("已複製綁定碼"); }
    catch { toast.error("複製失敗"); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          LINE 通知綁定
          {bound ? (
            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100"><CheckCircle2 className="h-3 w-3 mr-1" />已綁定</Badge>
          ) : (
            <Badge variant="secondary">尚未綁定</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusQ.isLoading ? (
          <p className="text-sm text-muted-foreground">載入中…</p>
        ) : bound ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">已綁定 LINE ✅　重要提醒會推送到你的 LINE。</p>
            <Button variant="outline" onClick={unbind} disabled={busy}>
              <Link2Off className="h-4 w-4 mr-2" />解除綁定
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {!code ? (
              <Button onClick={generate} disabled={busy}>
                <Link2 className="h-4 w-4 mr-2" />綁定 LINE
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border bg-muted/40 p-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">你的綁定碼（15 分鐘內有效）</div>
                    <div className="font-mono font-bold text-3xl tracking-widest">{code}</div>
                  </div>
                  <Button variant="outline" size="sm" onClick={copyCode}>
                    <Copy className="h-4 w-4 mr-1" />複製
                  </Button>
                </div>
                <ol className="text-sm space-y-2 list-decimal list-inside text-foreground">
                  <li>用手機 LINE 加「陞煇 EIP」官方帳號為好友。<span className="text-muted-foreground">（之後會提供加好友 QR code / 連結）</span></li>
                  <li>在該聊天室輸入這組綁定碼。</li>
                  <li>收到「綁定成功」即完成,之後重要提醒（到期、被指派、臨時回報）會推送到你的 LINE。</li>
                </ol>
                <Button variant="ghost" size="sm" onClick={generate} disabled={busy}>重新產生綁定碼</Button>
              </div>
            )}
          </div>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}
