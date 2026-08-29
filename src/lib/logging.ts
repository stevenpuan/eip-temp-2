import { supabase } from "./supabase";

// 操作日誌：登入/登出等一般行為
export async function logActivity(action: string, route?: string) {
  try {
    const { data } = await supabase.auth.getUser();
    // 2026-08-29：三張 log 表的 INSERT 政策收緊成 user_id 必須等於自己
    //（原本允許 NULL＝可以寫出查不到是誰做的稽核紀錄）。沒有身分就不寫。
    if (!data.user?.id) return;
    await supabase.from("activity_logs").insert({
      user_id: data.user.id,
      action,
      route: route ?? (typeof window !== "undefined" ? window.location.pathname : null),
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
  } catch {
    /* 日誌寫入失敗不影響主流程 */
  }
}

// 錯誤日誌：前端例外
export async function logError(message: string, context?: unknown) {
  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user?.id) return;   // 同上：未登入就不寫，寫了也會被 RLS 擋
    await supabase.from("error_logs").insert({
      level: "error",
      message,
      context: context ? (context as Record<string, unknown>) : null,
      route: typeof window !== "undefined" ? window.location.pathname : null,
      user_id: data.user.id,
    });
  } catch {
    /* 忽略 */
  }
}
