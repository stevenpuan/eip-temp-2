import { forwardRef, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** 全形數字、千分位、全形小數點 → 一般數字字串 */
export function normalizeNumberText(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, ".")
    .replace(/[－]/g, "-")
    .replace(/[,，\s]/g, "");
}

export function parseNumberText(s: string): number | null {
  const t = normalizeNumberText(s).replace(/[／]/g, "/");
  if (t === "" || t === "-" || t === ".") return null;
  // 分數：1/12 → 0.083333（單位換算常用）
  const f = t.match(/^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (f) {
    const b = Number(f[2]);
    return b ? Math.round((Number(f[1]) / b) * 1e6) / 1e6 : null;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

type Props = Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> & {
  value: number | null | undefined;
  onValueChange: (v: number | null) => void;
};

/**
 * 數字輸入框：輸入過程保留使用者打的字（例如「12.」「0.0」），不會被轉成數字後吃掉小數點。
 * 離開欄位時才整理顯示。支援全形數字與千分位逗號。
 */
export const NumberInput = forwardRef<HTMLInputElement, Props>(function NumberInput({ value, onValueChange, onFocus, onBlur, className, ...props }, ref) {
  const [text, setText] = useState(value === null || value === undefined ? "" : String(value));
  const editing = useRef(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!editing.current) setText(value === null || value === undefined ? "" : String(value));
  }, [value]);
  const invalid = !focused && normalizeNumberText(text) !== "" && parseNumberText(text) === null;
  return (
    <Input
      {...props}
      ref={ref}
      className={cn(className, invalid && "border-destructive focus-visible:ring-destructive")}
      aria-invalid={invalid || undefined}
      title={invalid ? "請輸入數字" : props.title}
      inputMode="decimal"
      value={text}
      onFocus={(e) => { editing.current = true; setFocused(true); onFocus?.(e); }}
      onChange={(e) => {
        setText(e.target.value);
        onValueChange(parseNumberText(e.target.value));
      }}
      onBlur={(e) => {
        editing.current = false;
        setFocused(false);
        const n = parseNumberText(e.target.value);
        setText(n === null ? (normalizeNumberText(e.target.value) === "" ? "" : e.target.value) : String(n));
        onBlur?.(e);
      }}
    />
  );
});
