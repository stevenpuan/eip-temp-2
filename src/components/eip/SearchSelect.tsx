import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export type SearchOption = { value: string; label: string; hint?: string | null; keywords?: (string | null | undefined)[]; disabled?: boolean };

/**
 * 可搜尋的下拉選單（客戶、品項動輒上百筆，原生 select 找不到東西）。
 * 搜尋會比對 label、hint 與 keywords（代號、簡稱、別名）。
 */
export function SearchSelect({
  value, options, onChange, placeholder = "請選擇", emptyText = "找不到符合的項目", disabled, className,
  allowClear = true, onCreate, createLabel,
}: {
  value: string | null | undefined;
  options: SearchOption[];
  onChange: (v: string | null) => void;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  allowClear?: boolean;
  onCreate?: (text: string) => void;
  createLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const list = kw
      ? options.filter((o) => [o.label, o.hint, ...(o.keywords ?? [])].some((s) => (s ?? "").toLowerCase().includes(kw)))
      : options;
    return list.slice(0, 200);
  }, [options, q]);

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setQ(""); }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" disabled={disabled}
          className={cn("h-9 w-full justify-between px-2 font-normal", !selected && "text-muted-foreground", className)}>
          <span className="truncate text-left">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[260px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="輸入代號、名稱或別名搜尋" value={q} onValueChange={setQ} />
          <CommandList>
            <CommandEmpty>
              <div className="space-y-2">
                <div>{emptyText}</div>
                {onCreate && q.trim() && (
                  <Button size="sm" variant="outline" onClick={() => { onCreate(q.trim()); setOpen(false); setQ(""); }}>
                    <Plus className="h-3.5 w-3.5 mr-1" />{createLabel ?? "新增"}「{q.trim()}」
                  </Button>
                )}
              </div>
            </CommandEmpty>
            <CommandGroup>
              {allowClear && value && (
                <CommandItem value="__clear__" onSelect={() => { onChange(null); setOpen(false); }} className="text-muted-foreground">
                  — 清除選擇 —
                </CommandItem>
              )}
              {filtered.map((o) => (
                <CommandItem key={o.value} value={o.value} disabled={o.disabled}
                  onSelect={() => { onChange(o.value); setOpen(false); setQ(""); }}>
                  <Check className={cn("mr-2 h-4 w-4", o.value === value ? "opacity-100" : "opacity-0")} />
                  <div className="min-w-0">
                    <div className="truncate">{o.label}</div>
                    {o.hint && <div className="truncate text-xs text-muted-foreground">{o.hint}</div>}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
