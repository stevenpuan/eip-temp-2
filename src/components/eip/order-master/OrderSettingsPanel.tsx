import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { DEFAULT_TENANT_ID } from "@/lib/eip-constants";
import { humanizeError } from "@/lib/eip-error";
import { useActiveUsers } from "@/hooks/useUsers";
import { useAuth } from "@/lib/auth";
import { TAX_TYPE_LABEL, type TaxType } from "@/lib/sales-order";
import { MultiSelect } from "@/components/eip/MultiSelect";
import { NumberInput } from "@/components/eip/NumberInput";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Setting = {
  reviewer_ids: string[]; default_tax_type: TaxType; tax_rate: number; learn_last_price: boolean; qty_alert_ratio: number; notify_creator: boolean;
  no_delivery_weekdays: number[]; holidays: string[]; draft_remind_minutes: number; draft_escalate_minutes: number;
};
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const DEFAULTS: Setting = {
  reviewer_ids: [], default_tax_type: "exclusive", tax_rate: 0.05, learn_last_price: true, qty_alert_ratio: 3, notify_creator: true,
  no_delivery_weekdays: [0], holidays: [], draft_remind_minutes: 30, draft_escalate_minutes: 120,
};
// 休息日：一行一個或用逗號分隔，接受 2026-10-10、2026/10/10、10/10（今年）
function parseHolidays(text: string): { dates: string[]; bad: string[] } {
  const y = new Date().getFullYear();
  const dates: string[] = []; const bad: string[] = [];
  for (const raw of text.split(/[\n,，、;；\s]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = raw.replace(/[./]/g, "-").match(/^(?:(\d{2,4})-)?(\d{1,2})-(\d{1,2})$/);
    if (!m) { bad.push(raw); continue; }
    let yy = m[1] ? Number(m[1]) : y; if (yy < 1000) yy += 1911;
    const d = `${yy}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    if (isNaN(Date.parse(d))) { bad.push(raw); continue; }
    if (!dates.includes(d)) dates.push(d);
  }
  return { dates: dates.sort(), bad };
}

export function OrderSettingsPanel({ canEdit }: { canEdit: boolean }) {
  const { user } = useAuth();
  const { data: users = [] } = useActiveUsers();
  const [s, setS] = useState<Setting | null>(null);
  const [saving, setSaving] = useState(false);
  const [holText, setHolText] = useState("");
  useEffect(() => {
    void supabase.from("eip_sales_order_setting").select("*").eq("tenant_id", DEFAULT_TENANT_ID).maybeSingle().then(({ data, error }) => {
      if (error) { toast.error(humanizeError(error, "讀取訂單設定")); return; }
      const v: Setting = data ? {
        ...DEFAULTS, ...data, tax_rate: Number(data.tax_rate), qty_alert_ratio: Number(data.qty_alert_ratio),
        no_delivery_weekdays: (data.no_delivery_weekdays ?? [0]).map(Number), holidays: (data.holidays ?? []).map(String),
      } : DEFAULTS;
      setS(v);
      setHolText(v.holidays.join("\n"));
    });
  }, []);
  if (!s) return <div className="text-sm text-muted-foreground p-4">載入中…</div>;

  const save = async () => {
    if (!(s.tax_rate >= 0 && s.tax_rate < 1)) { toast.error("稅率請填 0～99%"); return; }
    if (!(s.qty_alert_ratio >= 1)) { toast.error("數量異常倍數至少 1"); return; }
    if (!(s.draft_remind_minutes >= 5) || !(s.draft_escalate_minutes > s.draft_remind_minutes)) { toast.error("草稿提醒至少 5 分鐘，通知內勤的時間要比提醒老闆晚"); return; }
    const hol = parseHolidays(holText);
    if (hol.bad.length) { toast.error(`看不懂的休息日：${hol.bad.join("、")}（請用 2026-10-10 這種格式）`); return; }
    setSaving(true);
    const rec = {
      reviewer_ids: s.reviewer_ids, default_tax_type: s.default_tax_type, tax_rate: s.tax_rate, learn_last_price: s.learn_last_price,
      qty_alert_ratio: s.qty_alert_ratio, notify_creator: s.notify_creator, no_delivery_weekdays: s.no_delivery_weekdays, holidays: hol.dates,
      draft_remind_minutes: Math.round(s.draft_remind_minutes), draft_escalate_minutes: Math.round(s.draft_escalate_minutes),
      updated_by: user?.id, updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("eip_sales_order_setting").update(rec).eq("tenant_id", DEFAULT_TENANT_ID);
    setSaving(false);
    if (error) { toast.error(humanizeError(error, "儲存訂單設定")); return; }
    setS({ ...s, holidays: hol.dates });
    setHolText(hol.dates.join("\n"));
    toast.success("已儲存訂單設定");
  };

  return (
    <Card>
      <CardContent className="p-5 space-y-5 max-w-3xl">
        <div className="space-y-1.5">
          <Label>訂單覆核人員</Label>
          <MultiSelect values={s.reviewer_ids} onChange={(v) => setS({ ...s, reviewer_ids: v })} disabled={!canEdit} searchable
            options={(users as any[]).map((u) => ({ value: u.id, label: u.name }))} allLabel="未指定（通知所有有訂單編輯權限的人）" itemLabel="覆核人員" />
          <p className="text-xs text-muted-foreground">老闆送出訂單後，只通知這些人（建議指定內勤）。未指定時通知所有「訂單接收」有編輯權限的人。</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>預設稅別（客戶沒設定時）</Label>
            <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" disabled={!canEdit} value={s.default_tax_type} onChange={(e) => setS({ ...s, default_tax_type: e.target.value as TaxType })}>
              {(Object.keys(TAX_TYPE_LABEL) as TaxType[]).map((t) => <option key={t} value={t}>{TAX_TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>營業稅率（%）</Label>
            <NumberInput disabled={!canEdit} value={Math.round(s.tax_rate * 10000) / 100} onValueChange={(v) => setS({ ...s, tax_rate: (v ?? 0) / 100 })} />
          </div>
          <div className="space-y-1.5">
            <Label>數量異常提醒倍數</Label>
            <NumberInput disabled={!canEdit} value={s.qty_alert_ratio} onValueChange={(v) => setS({ ...s, qty_alert_ratio: v ?? 0 })} />
            <p className="text-xs text-muted-foreground">數量高於（或低於）該客戶近半年平均的幾倍時，提醒內勤確認。</p>
          </div>
        </div>
        <div className="rounded-md border p-3 space-y-3">
          <div className="text-sm font-medium">送貨日</div>
          <div className="space-y-1.5">
            <Label className="text-xs">不送貨的星期（預設交期遇到會自動順延；LINE 訂單指定到這天會提醒）</Label>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((w, i) => {
                const on = s.no_delivery_weekdays.includes(i);
                return (
                  <button key={i} type="button" disabled={!canEdit}
                    onClick={() => setS({ ...s, no_delivery_weekdays: on ? s.no_delivery_weekdays.filter((x) => x !== i) : [...s.no_delivery_weekdays, i].sort() })}
                    className={`h-8 w-10 rounded-md border text-sm ${on ? "bg-rose-100 border-rose-300 text-rose-800" : "bg-background"} disabled:opacity-60`}>週{w}</button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">休息日（國定假日、年節；一行一個，例：2027-02-05）</Label>
            <Textarea rows={3} disabled={!canEdit} value={holText} onChange={(e) => setHolText(e.target.value)} placeholder={"2026-10-10\n2027-01-01"} />
          </div>
        </div>
        <div className="rounded-md border p-3 space-y-3">
          <div className="text-sm font-medium">LINE 草稿未送出提醒</div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">幾分鐘沒送出，用 LINE 提醒老闆</Label>
              <NumberInput disabled={!canEdit} value={s.draft_remind_minutes} onValueChange={(v) => setS({ ...s, draft_remind_minutes: v ?? 0 })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">幾分鐘還沒送出，通知覆核人員</Label>
              <NumberInput disabled={!canEdit} value={s.draft_escalate_minutes} onValueChange={(v) => setS({ ...s, draft_escalate_minutes: v ?? 0 })} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">老闆收到提醒後直接回覆「送出訂單」就會送出。晚上 10 點到早上 7 點不發提醒。</p>
        </div>
        <label className="flex items-start gap-3 text-sm">
          <Switch checked={s.learn_last_price} disabled={!canEdit} onCheckedChange={(v) => setS({ ...s, learn_last_price: v })} />
          <span>自動學習最近成交價<span className="block text-xs text-muted-foreground">覆核確認時記錄每個客戶每個品項的成交價，下次同客戶下單優先帶入（專屬價優先於成交價）。</span></span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <Switch checked={s.notify_creator} disabled={!canEdit} onCheckedChange={(v) => setS({ ...s, notify_creator: v })} />
          <span>訂單確認／取消時通知下單人<span className="block text-xs text-muted-foreground">老闆有綁定 LINE 時會即時收到「訂單已確認」與總金額。</span></span>
        </label>
        {canEdit && <Button onClick={save} disabled={saving}><Save className="h-4 w-4 mr-1.5" />{saving ? "儲存中…" : "儲存設定"}</Button>}
      </CardContent>
    </Card>
  );
}
