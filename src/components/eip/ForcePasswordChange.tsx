import { useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { humanizeError } from "@/lib/eip-error";
import { supabase } from "@/lib/supabase";

/**
 * 首次登入（或被管理者重設密碼後）強制改密碼的全畫面關卡。
 *
 * 為什麼要擋：管理者在「帳號管理」重設密碼會產生一組臨時密碼，經手的人都看得到；
 * 新建帳號的初始密碼同理。若只靠口頭提醒「記得自己改」，實務上就是不會改。
 * 旗標在 `app_user.must_change_password`（後端 eip_admin_reset_password /
 * eip_admin_create_user 設 true），這裡改完密碼後呼叫 eip_complete_password_change() 清掉。
 *
 * 刻意做成整頁而不是對話框：對話框關得掉，這一關不該關得掉。唯一的出口是登出。
 */

const MIN_LENGTH = 8;

export function ForcePasswordChange({
  email,
  onDone,
  onSignOut,
}: {
  email?: string | null;
  onDone: () => void;
  onSignOut: () => void;
}) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  const tooShort = pw.length > 0 && pw.length < MIN_LENGTH;
  const mismatch = pw2.length > 0 && pw !== pw2;

  const submit = async () => {
    if (pw.length < MIN_LENGTH) {
      toast.error(`密碼至少 ${MIN_LENGTH} 碼`);
      return;
    }
    if (pw !== pw2) {
      toast.error("兩次輸入的密碼不一樣");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) {
      setBusy(false);
      toast.error(humanizeError(error, "變更密碼"));
      return;
    }
    // 密碼已經改掉了，旗標沒清成功也不能把人關在這一頁 —— 提示後照樣放行。
    const { error: rpcErr } = await supabase.rpc("eip_complete_password_change");
    setBusy(false);
    if (rpcErr) toast.error("密碼已更新，但狀態沒清掉，下次登入可能還會問一次");
    else toast.success("密碼已更新");
    onDone();
  };

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-2xl border bg-card p-6 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <KeyRound className="h-4.5 w-4.5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">請先修改密碼</h1>
            <p className="text-xs text-muted-foreground">
              {email ? `${email}　` : ""}目前用的是管理者給的臨時密碼
            </p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          這組密碼經手的人都知道，請改成只有你知道的密碼後再繼續使用系統。
        </p>

        <div className="space-y-1">
          <Label className="text-xs">新密碼</Label>
          <Input
            type="password"
            autoComplete="new-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder={`至少 ${MIN_LENGTH} 碼`}
          />
          {tooShort && <p className="text-xs text-destructive">至少 {MIN_LENGTH} 碼</p>}
        </div>

        <div className="space-y-1">
          <Label className="text-xs">再輸入一次</Label>
          <Input
            type="password"
            autoComplete="new-password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
          />
          {mismatch && <p className="text-xs text-destructive">兩次輸入的密碼不一樣</p>}
        </div>

        <Button type="submit" className="w-full" disabled={busy || pw.length < MIN_LENGTH || pw !== pw2}>
          {busy ? "更新中…" : "更新密碼並繼續"}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="w-full" onClick={onSignOut} disabled={busy}>
          先登出
        </Button>
      </form>
    </div>
  );
}
