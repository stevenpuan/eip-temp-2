import { cn } from "@/lib/utils";

/**
 * 顯示在日期／時間欄位**上方**的「已選」摘要。
 *
 * 刻意放上方：原生日曆／時鐘小視窗往下展開會蓋住欄位，摘要放下方等於沒做
 * —— 客戶原本的抱怨就是「選了要按一下視窗外才知道自己選了什麼」。
 * 文字怎麼組（含起訖連動規則）在 `@/lib/eip-datetime-range`。
 */
export function RangeSummary({
  text,
  placeholder = "尚未選擇",
  className,
}: {
  text: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-xs tabular-nums",
        text ? "font-medium text-foreground" : "text-muted-foreground",
        className,
      )}
      aria-live="polite"
    >
      {text || placeholder}
    </span>
  );
}
