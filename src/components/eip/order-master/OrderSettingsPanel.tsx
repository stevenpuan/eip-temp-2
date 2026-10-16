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
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Setting = { reviewer_ids: string[]; default_tax_type: TaxType; tax_rate: number; learn_last_price: boolean; qty_alert_ratio: number; notify_creator: boolean };

export function OrderSettingsPanel({ canEdit }: { canEdit: boolean }) {
  const { user } = useAuth();
  const { data: users = [] } = useActiveUsers();
  const [s, setS] = useState<Setting | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void supabase.from("eip_sales_order_setting").select("*").eq("tenant_id", DEFAULT_TENANT_ID).maybeSingle().then(({ data, error }) => {
      if (error) { toast.error(humanizeError(error, "讀取訂單設定")); return; }
      setS(data ? { ...data, tax_rate: Number(data.tax_rate), qty_alert_ratio: Number(data.qty_alert_ratio) } as Setting
        : { reviewer_ids: [], default_tax_type: "exclusive", tax_rate: 0.05, learn_last_price: true, qty_alert_ratio: 3, notify_creator: true });
    });
  }, []);
  if (!s) return <div className="text-sm text-muted-foreground p-4">載入中…</div>;

  const save = async () => {
    if (!(s.tax_rate >= 0 && s.tax_rate < 1)) { toast.error("稅率請填 0～99%"); return; }
    if (!(s.qty_alert_ratio >= 1)) { toast.error("數量異常倍數至少 1"); return; }
    setSaving(true);
    const { error } = await supabase.from("eip_sales_order_setting").update({ ...s, updated_by: user?.id, updated_at: new Date().toISOString() }).eq("tenant_id", DEFAULT_TENANT_ID);
    setSaving(false);
    if (error) { toast.error(humanizeError(error, "儲存訂單設定")); return; }
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
            <Input inputMode="decimal" disabled={!canEdit} value={Math.round(s.tax_rate * 10000) / 100} onChange={(e) => setS({ ...s, tax_rate: Number(e.target.value || 0) / 100 })} />
          </div>
          <div className="space-y-1.5">
            <Label>數量異常提醒倍數</Label>
            <Input inputMode="decimal" disabled={!canEdit} value={s.qty_alert_ratio} onChange={(e) => setS({ ...s, qty_alert_ratio: Number(e.target.value || 0) })} />
            <p className="text-xs text-muted-foreground">數量高於（或低於）該客戶近半年平均的幾倍時，提醒內勤確認。</p>
          </div>
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
