import { supabase } from "@/lib/supabase";

const WD = ["日", "一", "二", "三", "四", "五", "六"];
const qtyText = (n: number | null | undefined) => (n === null || n === undefined ? "?" : String(Math.round(Number(n) * 1000) / 1000));

/** 範例訊息的「正確結果」：與資料庫 eip_order_example_text 同一種寫法 */
export async function expectedTextOfOrder(orderNo: string): Promise<{ text: string; orderId: string; customerId: string | null } | null> {
  const { data: o } = await supabase.from("eip_sales_order")
    .select("id, customer_id, customer_text, delivery_date, note, eip_customer(code,name), eip_customer_address(label)")
    .eq("order_no", orderNo).maybeSingle();
  if (!o) return null;
  const { data: ls } = await supabase.from("eip_sales_order_line")
    .select("line_no, qty, unit, product_text, eip_product(code,name)").eq("order_id", o.id).order("line_no");
  const c = (o as any).eip_customer;
  const d = o.delivery_date as string | null;
  const rows = [
    `客戶：${c ? [c.code, c.name].filter(Boolean).join(" ") : o.customer_text ?? "（未指定）"}`,
    `交期：${d ? `${d}（週${WD[new Date(d + "T00:00:00Z").getUTCDay()]}）` : "未指定"}`,
    ...((o as any).eip_customer_address?.label ? [`送貨：${(o as any).eip_customer_address.label}`] : []),
    ...((ls ?? []) as any[]).map((l) => `${l.line_no}. ${[l.eip_product?.code, l.eip_product?.name ?? l.product_text].filter(Boolean).join(" ")} ${qtyText(l.qty)}${l.unit ?? ""}`),
    ...(o.note ? [`備註：${o.note}`] : []),
  ];
  return { text: rows.join("\n"), orderId: o.id, customerId: o.customer_id };
}

export const todayTaipei = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
