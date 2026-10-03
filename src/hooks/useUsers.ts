import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { AppUser } from "@/lib/eip-user";

/**
 * 人員清單共用 hook
 *
 * 用途分野（很重要，改動前請先讀）：
 *
 *  - useActiveUsers()：只回在職人員（status = 'active'）。
 *    所有「可以被選取／被指派」的下拉、多選、chip、篩選器一律用這個，
 *    否則已停用（離職）的同仁會出現在選單裡被誤指派。
 *
 *  - useAllUsers()：回全部人員（含已停用）。
 *    只給「id → 姓名」的顯示對照用（userMap / nameMap）。
 *    這裡如果過濾掉停用者，離職同仁留下的歷史紀錄
 *    （任務負責人、工作日誌、公告建立者…）姓名就會變成空白。
 *
 * 兩者回傳的都是完整 useQuery 結果，所以 .data / .isError / .refetch()
 * 都可以直接沿用原本的寫法。
 */

const USER_COLUMNS = "*";

/**
 * 系統帳號（開發者／設定者，app_user.hide_from_pickers = true）不是公司人員，
 * 不可出現在任何「選人」清單或人數統計；但姓名對照（userMap）要保留，
 * 否則他留下的歷史紀錄姓名會變空白。
 * 自己寫查詢的頁面，在「選人」的地方用這個過濾。
 */
export function isPickableUser(u: { hide_from_pickers?: boolean | null }): boolean {
  return !u.hide_from_pickers;
}

async function fetchUsers(activeOnly: boolean): Promise<AppUser[]> {
  let q = supabase.from("app_user").select(USER_COLUMNS);
  if (activeOnly) q = q.eq("status", "active");
  const { data, error } = await q.order("name");
  if (error) throw error;
  const rows = (data ?? []) as AppUser[];
  // useActiveUsers 專供選人 → 一併排除系統帳號；useAllUsers 是姓名對照 → 不排除
  return activeOnly ? rows.filter(isPickableUser) : rows;
}

/** 在職人員 —— 給所有「選人」用途 */
export function useActiveUsers() {
  return useQuery({
    queryKey: ["app_user", "active"],
    queryFn: () => fetchUsers(true),
  });
}

/** 全部人員（含停用）—— 只給姓名顯示對照用 */
export function useAllUsers() {
  return useQuery({
    queryKey: ["app_user", "all"],
    queryFn: () => fetchUsers(false),
  });
}
