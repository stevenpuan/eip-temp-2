import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { logActivity } from "@/lib/logging";
import { humanizeError } from "@/lib/eip-error";

const LOGIN_DOMAIN = "eip-template.local"; // 需與 app_config.login_domain 一致

function toLoginEmail(input: string) {
  const v = input.trim();
  if (!v) return v;
  return v.includes("@") ? v.toLowerCase() : `${v.toLowerCase()}@${LOGIN_DOMAIN}`;
}

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && session) navigate({ to: "/dashboard" });
  }, [loading, session, navigate]);

  const onLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const email = toLoginEmail(String(f.get("account")));
    const password = String(f.get("password"));
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setBusy(false);
    if (error) {
      // 原本一律報「員工編號或密碼錯誤」：被 rate limit 鎖住的人會繼續重試而鎖更久，
      // Supabase 中斷時也是同一句話，沒有人會回報系統故障。只有真的憑證不符才這樣寫。
      const code = (error as { code?: string }).code;
      setError(
        code === "invalid_credentials" || code === "invalid_grant"
          ? "員工編號或密碼錯誤"
          : humanizeError(error, "登入"),
      );
      return;
    }
    await logActivity("login");
    navigate({ to: "/dashboard" });
  };

  const onRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const invite = String(f.get("invite_code") || "").trim();
    const { data: signUpData, error } = await supabase.auth.signUp({
      email: String(f.get("email")),
      password: String(f.get("password")),
      options: {
        data: { full_name: String(f.get("full_name")), invite_code: invite },
      },
    });
    if (error) {
      setBusy(false);
      toast.error(humanizeError(error, "註冊"));
      return;
    }
    if (invite && signUpData.session) {
      const { data: res, error: rErr } = await supabase.rpc("redeem_invitation", { p_code: invite });
      setBusy(false);
      if (rErr) {
        // 原本 error 被丟掉，RPC 失敗一律被報成「邀請碼無效」，新人會去要一組新碼，方向完全錯。
        toast.error(`${humanizeError(rErr, "啟用邀請碼")}。帳號已建立，請稍後重試或聯絡管理員。`);
        return;
      }
      if (res === "ok") {
        await logActivity("login");
        toast.success("註冊成功，已啟用！");
        navigate({ to: "/dashboard" });
        return;
      }
      toast.message("邀請碼無效或已過期，帳號待管理員審核");
      return;
    }
    if (invite && !signUpData.session) {
      // 需要驗證信箱時沒有 session，這支 redeem_invitation 送不出去。
      // 系統目前沒有「登入後補啟用」的機制（handle_new_user 也不讀 invite_code），
      // 所以這裡只能誠實告知要走人工審核，不可以承諾會自動啟用。
      setBusy(false);
      toast.message("註冊成功！請先完成信箱驗證，並請管理員為你啟用帳號（這次的邀請碼不會自動生效）。");
      return;
    }
    setBusy(false);
    toast.success("註冊成功！首位註冊者自動成為管理員；其餘需管理員審核。");
  };

  return (
    <div className="min-h-screen grid place-items-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <img src="/logo.svg" alt="艾士實業" className="mx-auto h-16 w-16 object-contain mb-2" />
          <CardTitle className="text-xl">艾士實業</CardTitle>
          <CardDescription>內部管理平台</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">登入</TabsTrigger>
              <TabsTrigger value="register">註冊</TabsTrigger>
            </TabsList>
            <TabsContent value="login">
              <form onSubmit={onLogin} className="space-y-3 pt-3">
                <div className="space-y-1">
                  <Label>員工編號 / 帳號</Label>
                  <Input name="account" type="text" autoComplete="username" required placeholder="請輸入員工編號（例：0097）" />
                </div>
                <div className="space-y-1">
                  <Label>密碼</Label>
                  <Input name="password" type="password" autoComplete="current-password" required />
                </div>
                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}
                <Button className="w-full" disabled={busy}>
                  {busy ? "登入中…" : "登入"}
                </Button>
                <p className="text-xs text-muted-foreground text-center leading-relaxed">
                  初次登入帳號與密碼皆為您的員工編號，登入後請至「個人設定」修改密碼。
                </p>
                {/* 忘記密碼沒有自助流程（帳號多為虛擬信箱，寄不到重設信），
                    改為明確指路：請人事課／系統管理者在「帳號管理」重設。 */}
                <p className="text-xs text-muted-foreground text-center leading-relaxed">
                  忘記密碼請洽人事課或系統管理者，於「帳號管理」為您重設。
                </p>
              </form>
            </TabsContent>
            <TabsContent value="register">
              <form onSubmit={onRegister} className="space-y-3 pt-3">
                <div className="space-y-1">
                  <Label>姓名</Label>
                  <Input name="full_name" required />
                </div>
                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input name="email" type="email" required />
                </div>
                <div className="space-y-1">
                  <Label>密碼</Label>
                  <Input name="password" type="password" required minLength={6} />
                </div>
                <div className="space-y-1">
                  <Label>邀請碼（選填）</Label>
                  <Input name="invite_code" />
                </div>
                <Button className="w-full" disabled={busy}>
                  {busy ? "送出中…" : "註冊"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
