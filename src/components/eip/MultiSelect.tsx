import { useMemo, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type MultiOption = { value: string; label: string };

/**
 * 可複選的下拉篩選（Popover ＋ 勾選清單）。
 *
 * 專案沒有現成的 multi-select 元件，shadcn 的 Select 也不支援複選，
 * 所以這裡用 Popover 自己組一個，外觀刻意比照 SelectTrigger（h-9、border、
 * 右邊 ChevronDown），跟旁邊的單選篩選排在一起才不會看起來像兩套 UI。
 *
 * ・`values` 空陣列＝不篩選，按鈕顯示 `allLabel`（例：全部部門）。
 * ・選 1 項顯示那一項的名稱；選 2 項以上顯示「部門：3 項」，欄寬才不會被撐爆。
 * ・選項多（人員清單）時預設給搜尋框，10 項以內就不給，免得多一個空框。
 */
export function MultiSelect({
  values,
  onChange,
  options,
  allLabel,
  itemLabel,
  className,
  contentClassName,
  emptyText = "沒有選項",
  searchable,
  disabled,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  options: MultiOption[];
  /** 沒選任何項目時按鈕上的字，例：「全部部門」 */
  allLabel: string;
  /** 選 2 項以上時的前綴，例：「部門」→「部門：3 項」 */
  itemLabel: string;
  className?: string;
  contentClassName?: string;
  emptyText?: string;
  /** 預設：選項超過 10 個才顯示搜尋框 */
  searchable?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [kw, setKw] = useState("");

  const showSearch = searchable ?? options.length > 10;
  const shown = useMemo(() => {
    const k = kw.trim().toLowerCase();
    if (!k) return options;
    return options.filter((o) => o.label.toLowerCase().includes(k));
  }, [options, kw]);

  const selected = useMemo(() => new Set(values), [values]);
  const label =
    values.length === 0
      ? allLabel
      : values.length === 1
        ? (options.find((o) => o.value === values[0])?.label ?? `${itemLabel}：1 項`)
        : `${itemLabel}：${values.length} 項`;

  const toggle = (v: string) =>
    onChange(selected.has(v) ? values.filter((x) => x !== v) : [...values, v]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setKw("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-9 w-full justify-between font-normal",
            values.length === 0 && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="w-4 h-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("w-56 p-2", contentClassName)}>
        {showSearch && (
          <Input
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            placeholder="搜尋…"
            className="h-8 text-sm mb-2"
          />
        )}
        <div className="max-h-64 overflow-y-auto -mx-1 px-1">
          {shown.length === 0 ? (
            <div className="text-xs text-muted-foreground px-2 py-3 text-center">{emptyText}</div>
          ) : (
            shown.map((o) => {
              const on = selected.has(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggle(o.value)}
                  aria-pressed={on}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-left hover:bg-muted"
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                      on ? "bg-primary border-primary text-primary-foreground" : "border-input",
                    )}
                  >
                    {on && <Check className="h-3 w-3" />}
                  </span>
                  <span className="truncate">{o.label}</span>
                </button>
              );
            })
          )}
        </div>
        {values.length > 0 && (
          <div className="mt-2 pt-2 border-t flex items-center justify-between">
            <span className="text-xs text-muted-foreground">已選 {values.length} 項</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => onChange([])}
            >
              <X className="w-3 h-3 mr-1" />
              清除
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
