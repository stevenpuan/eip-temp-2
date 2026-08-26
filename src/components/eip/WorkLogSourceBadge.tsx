import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";

/**
 * 工作日誌／部門日誌項目的「來源」標籤。
 *
 * 由任務帶進來的項目（`source` = task／recurring，此時 `ref_id` 就是 task.id，
 * 見後端 `eip_worklog_seed`）標籤本身就是連結，點一下開那張任務的詳細內容
 * ——走既有的 `/dashboard/eip/tasks?openTask=<id>`，與通知、交接、行事曆同一條路。
 *
 * 其他來源沒有可跳的詳細頁：個人例行只是範本、會議決議的 ref_id 是決議項目本身
 * （不是會議 id），所以維持純標籤，不給假的連結。
 */

export const WORKLOG_SOURCE_LABEL: Record<string, string> = {
  personal_routine: "個人例行",
  recurring: "常態工作",
  task: "任務",
  meeting_action: "會議決議",
};

const BASE = "text-[11.5px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0";

/** source 是任務類、且有 ref_id 才點得進去 */
export function worklogTaskId(source?: string, refId?: string): string | null {
  if (!refId) return null;
  return source === "task" || source === "recurring" ? refId : null;
}

export function WorkLogSourceBadge({ source, refId }: { source?: string; refId?: string }) {
  const label = source ? WORKLOG_SOURCE_LABEL[source] : undefined;
  if (!label) return null;
  const taskId = worklogTaskId(source, refId);
  if (!taskId) return <span className={BASE}>{label}</span>;
  return (
    <Link
      to="/dashboard/eip/tasks"
      search={{ openTask: taskId }}
      title="開啟這項任務看詳細內容"
      className={`${BASE} inline-flex items-center gap-0.5 hover:bg-primary/10 hover:text-primary hover:underline`}
    >
      {label}
      <ExternalLink className="h-3 w-3" />
    </Link>
  );
}

/** 唯讀模式的項目文字：任務類就整段變成連結，點文字也能進去 */
export function WorkLogItemText({
  text,
  done,
  source,
  refId,
}: {
  text: string;
  done?: boolean;
  source?: string;
  refId?: string;
}) {
  const taskId = worklogTaskId(source, refId);
  const cls = `flex-1 ${done ? "line-through text-muted-foreground" : ""}`;
  if (!taskId) return <span className={cls}>{text}</span>;
  return (
    <Link
      to="/dashboard/eip/tasks"
      search={{ openTask: taskId }}
      title="開啟這項任務看詳細內容"
      className={`${cls} hover:text-primary hover:underline`}
    >
      {text}
    </Link>
  );
}
