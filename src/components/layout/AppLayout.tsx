import { Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { AppSidebar } from "./AppSidebar";
import { DailyReminder } from "@/components/eip/DailyReminder";
import { ForcePasswordChange } from "@/components/eip/ForcePasswordChange";
import { Button } from "@/components/ui/button";

export function AppLayout() {
  const { loading, session, profile, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login" });
  }, [loading, session, navigate]);

  // 用的是管理者給的臨時／初始密碼嗎？是就先擋著要求改密碼（旗標在 app_user，
  // 由後端 eip_admin_reset_password / eip_admin_create_user 設定）。
  // 查不到或查詢失敗都當作「不用改」放行 —— 這一關不值得把人鎖在門外。
  const uid = session?.user?.id;
  const [mustChangePw, setMustChangePw] = useState(false);
  const [pwChecked, setPwChecked] = useState(false);
  useEffect(() => {
    if (!uid) {
      setMustChangePw(false);
      setPwChecked(true);
      return;
    }
    let alive = true;
    setPwChecked(false);
    void (async () => {
      const { data, error } = await supabase.rpc("eip_must_change_password");
      if (!alive) return;
      setMustChangePw(!error && data === true);
      setPwChecked(true);
    })();
    return () => {
      alive = false;
    };
  }, [uid]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground">
        載入中…
      </div>
    );
  }
  if (!session) return null;

  if (!pwChecked) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground">
        載入中…
      </div>
    );
  }

  if (mustChangePw) {
    return (
      <ForcePasswordChange
        email={profile?.email ?? session.user?.email ?? null}
        onDone={() => setMustChangePw(false)}
        onSignOut={() => void signOut()}
      />
    );
  }

  if (profile && profile.status !== "active") {
    return (
      <div className="min-h-screen grid place-items-center px-4 text-center">
        <div className="max-w-sm space-y-3">
          <h1 className="text-xl font-semibold">帳號待審核</h1>
          <p className="text-sm text-muted-foreground">
            您的帳號狀態為「{profile.status}」，需管理員核准後才能進入系統。
          </p>
          <Button variant="outline" onClick={signOut}>
            登出
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar />
      <main className="lg:pl-64">
        <div className="p-4 sm:p-6 pb-28 sm:pb-28 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
      <DailyReminder />
    </div>
  );
}
