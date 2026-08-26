import { useEffect, useRef, useState } from "react";
import { CalendarDays, Clock, X } from "lucide-react";
import { zhTW } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { fmtDate } from "@/lib/eip-datetime-range";
import { cn } from "@/lib/utils";

/**
 * 日期／時間欄位（桌機不再用瀏覽器原生選擇器）。
 *
 * 為什麼要自己做（2026-08-26，客戶第二次回報同一件事）：
 * 原生 `<input type="date">`／`type="time">` 的日曆／時鐘小視窗是瀏覽器畫的，
 * 我們**控制不了它的位置**——空間不夠時 Chrome 會把它往上翻，正好蓋掉我們
 * 刻意放在欄位上方的「已選」摘要；使用者仍然得先點掉小視窗才知道自己選了什麼。
 * 上一版只補了摘要與起訖連動（`lib/eip-datetime-range.ts`），治不了這一層。
 *
 * 這裡改成 Popover + 我們自己的日曆／時間清單：
 *  ・選好的值直接寫在「按鈕本身」上（例：8/28(五)、09:30），不必關掉任何東西就看得到。
 *  ・Popover 由 Radix 定位、會自動避開邊界，而且永遠不會蓋住觸發按鈕。
 *  ・點一下就選定並關閉 → 值即時進 state，起訖連動（syncToDate/syncToTime）立刻生效。
 *  ・**手機仍走原生**：觸控裝置上原生滾輪選擇器比日曆小卡好用得多。
 *
 * 值一律是字串：日期 `YYYY-MM-DD`、時間 `HH:MM`，空字串＝未選。
 * 全程字串運算或本地 `new Date(y, m-1, d)`，不碰 `toISOString()`（見 AGENTS.md 時區規定）。
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_INPUT_RE = /^(\d{1,2}):(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-08-28" → 本地 Date（給日曆用）。不合法回 undefined */
function parseDate(value: string | undefined): Date | undefined {
  const m = DATE_RE.exec(value ?? "");
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Date → "2026-08-28"（用本地年月日組字串，不能用 toISOString，UTC 會退一天） */
function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "9:30" → 570；不合法回 null */
function toMinutes(value: string | undefined): number | null {
  const m = TIME_INPUT_RE.exec((value ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

const fromMinutes = (total: number) => `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;

/** 00:00 ~ 23:45，每 15 分一格 */
const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => fromMinutes(i * 15));

function ClearButton({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span
      role="button"
      aria-label={label}
      title={label}
      className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground/70 hover:bg-muted hover:text-foreground"
      // Popover 的觸發是 pointerdown，這裡要先攔掉，否則清除的同時會把小卡打開
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClear();
      }}
    >
      <X className="h-3.5 w-3.5" />
    </span>
  );
}

export function DateField({
  value,
  onChange,
  min,
  max,
  placeholder = "選擇日期",
  disabled,
  clearable,
  className,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  /** 可選的最早／最晚日期（YYYY-MM-DD），日曆上會直接不能點 */
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  className?: string;
  id?: string;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  if (isMobile) {
    return (
      <Input
        id={id}
        type="date"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        className={className}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onChange(e.target.value)}
      />
    );
  }

  const selected = parseDate(value);
  const minDate = parseDate(min);
  const maxDate = parseDate(max);
  const matchers = [
    ...(minDate ? [{ before: minDate }] : []),
    ...(maxDate ? [{ after: maxDate }] : []),
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start gap-2 px-3 font-normal tabular-nums",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <CalendarDays className="h-4 w-4 shrink-0 opacity-70" />
          <span className="truncate">{value ? fmtDate(value) : placeholder}</span>
          {clearable && value ? <ClearButton label="清除日期" onClear={() => onChange("")} /> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          locale={zhTW}
          selected={selected}
          defaultMonth={selected}
          disabled={matchers.length ? matchers : undefined}
          onSelect={(d) => {
            if (!d) return;
            onChange(formatDate(d));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function TimeField({
  value,
  onChange,
  min,
  placeholder = "選擇時間",
  disabled,
  clearable,
  clearLabel = "清除",
  className,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  /** 不可早於這個時間（HH:MM），清單上會直接不能點 */
  min?: string;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  clearLabel?: string;
  className?: string;
  id?: string;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  // 打開時把目前選到的時間捲到中間，不然 96 格要自己找
  useEffect(() => {
    if (!open) return;
    const box = listRef.current;
    const hit = box?.querySelector<HTMLElement>('[data-selected="true"]');
    if (box && hit) box.scrollTop = Math.max(0, hit.offsetTop - box.clientHeight / 2);
  }, [open]);

  if (isMobile) {
    return (
      <Input
        id={id}
        type="time"
        value={value}
        min={min}
        disabled={disabled}
        className={className}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onChange(e.target.value)}
      />
    );
  }

  const minMinutes = toMinutes(min);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start gap-2 px-3 font-normal tabular-nums",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <Clock className="h-4 w-4 shrink-0 opacity-70" />
          <span className="truncate">{value || placeholder}</span>
          {clearable && value ? <ClearButton label={clearLabel} onClear={() => onChange("")} /> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 space-y-2 p-2">
        {/* 清單只有 15 分一格，要 09:05 這種就直接打 */}
        <Input
          value={draft}
          placeholder="也可直接輸入 09:05"
          inputMode="numeric"
          className="h-8 text-sm tabular-nums"
          onChange={(e) => {
            const v = e.target.value;
            setDraft(v);
            const mins = toMinutes(v);
            if (mins !== null) onChange(fromMinutes(mins));
          }}
        />
        <div ref={listRef} className="grid max-h-56 grid-cols-3 gap-1 overflow-y-auto pr-1">
          {TIME_OPTIONS.map((t) => {
            const blocked = minMinutes !== null && (toMinutes(t) ?? 0) < minMinutes;
            const isSelected = t === value;
            return (
              <button
                key={t}
                type="button"
                disabled={blocked}
                data-selected={isSelected}
                onClick={() => {
                  onChange(t);
                  setOpen(false);
                }}
                className={cn(
                  "rounded px-1.5 py-1 text-xs tabular-nums",
                  isSelected ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  blocked && "cursor-not-allowed opacity-30 hover:bg-transparent",
                )}
              >
                {t}
              </button>
            );
          })}
        </div>
        {clearable ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            {clearLabel}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
