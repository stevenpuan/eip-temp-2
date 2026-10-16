import { useEffect, useRef, useState } from "react";
import { Send, RotateCcw, Bot, User, Loader2, BookmarkPlus } from "lucide-react";
import { toast } from "sonner";
import { humanizeError } from "@/lib/eip-error";
import { expectedTextOfOrder, todayTaipei } from "@/components/eip/order-master/learning";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

type Msg = { from: "me" | "bot" | "sys"; text: string; quick?: string[]; ms?: number; orderNo?: string; ask?: string };
type ExDraft = { input_text: string; expected_text: string; customer_id: string | null; order_no: string };

const SAMPLES = [
  "今天有幾張單要出貨？",
  "王記這個月叫了多少？",
  "原味豆乾賣王記多少錢？",
  "大成的送貨地址",
  "我明天有什麼行程？",
  "下單，王記，五香 10 箱、原味 5 箱，下週一送",
  "王記照舊，原味多 2 箱",
  "部門有誰的任務逾期？",
];

/** LINE 測試台：用自己的身分模擬在 LINE 傳訊息，看機器人會怎麼回（與 LINE 上的處理完全相同） */
export function LineTestPanel() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [ex, setEx] = useState<ExDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs, busy]);

  const send = async (t: string) => {
    const content = t.trim();
    if (!content || busy) return;
    setMsgs((m) => [...m, { from: "me", text: content }]);
    setText("");
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("line-webhook", { body: { text: content }, headers: { "x-eip-simulate": "1" } });
      if (error) {
        let detail = error.message;
        try { const j = await (error as any).context?.json?.(); if (j?.error) detail = j.error; } catch { /* ignore */ }
        setMsgs((m) => [...m, { from: "sys", text: `測試失敗：${detail}` }]);
        return;
      }
      const replies = ((data?.replies ?? []) as any[]).filter((r) => r?.type === "text");
      if (!replies.length) setMsgs((m) => [...m, { from: "sys", text: "（機器人沒有回覆）" }]);
      else setMsgs((m) => {
        // 這次對話的第一句（修改草稿時往回找原本下單那句），存範例時當作「老闆的訊息」
        const firstAsk = [...m].reverse().find((x) => x.from === "bot" && x.ask)?.ask;
        return [...m, ...replies.map((r, i) => {
          const text = String(r.text ?? "");
          const orderNo = text.match(/訂單草稿\s+(SO\d{6}-\d{3})/)?.[1];
          const prevSame = orderNo && [...m].reverse().find((x) => x.orderNo === orderNo);
          return {
            from: "bot" as const, text,
            quick: (r.quickReply?.items ?? []).map((q: any) => q?.action?.text).filter(Boolean),
            ms: i === replies.length - 1 ? data?.ms : undefined,
            orderNo, ask: orderNo ? (prevSame ? (/^(第\s*\d+\s*項是|客戶改成)\s/.test(content) ? prevSame.ask : `${prevSame.ask ?? firstAsk ?? ""}\n${content}`.trim()) : content) : undefined,
          };
        })];
      });
    } finally { setBusy(false); }
  };

  const openSave = async (m: Msg) => {
    if (!m.orderNo) return;
    const r = await expectedTextOfOrder(m.orderNo);
    if (!r) return toast.error("找不到這張草稿");
    setEx({ input_text: m.ask ?? "", expected_text: r.text, customer_id: r.customerId, order_no: m.orderNo });
  };
  const saveExample = async () => {
    if (!ex || !ex.input_text.trim() || !ex.expected_text.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("eip_order_example").insert({
      input_text: ex.input_text.trim(), expected_text: ex.expected_text.trim(), customer_id: ex.customer_id, message_date: todayTaipei(), source: "test",
    });
    setSaving(false);
    if (error) return toast.error(humanizeError(error, "存成範例"));
    toast.success("已存成範例，之後 AI 解析會參考");
    setEx(null);
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3 max-w-3xl">
        <div className="text-sm text-muted-foreground space-y-1">
          <p>在這裡打字，等於<b className="text-foreground">用你自己的帳號在 LINE 傳訊息給機器人</b>，可以看到它會怎麼回答。用來測試新的說法、確認主檔設定有沒有對到。</p>
          <p className="text-amber-700">注意：處理方式和 LINE 完全相同，下單會真的建立草稿、建立任務會真的暫存（按「送出訂單」才會送給內勤），但不會推送到 LINE。</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SAMPLES.map((s) => (
            <button key={s} type="button" disabled={busy} onClick={() => setText(s)} className="text-xs rounded-full border px-2.5 py-1 hover:bg-muted disabled:opacity-50">{s}</button>
          ))}
        </div>
        <div className="rounded-md border bg-[#8cabd9]/15 p-3 h-[460px] overflow-y-auto space-y-3">
          {msgs.length === 0 && <div className="text-center text-sm text-muted-foreground pt-16">點上面的範例或自己輸入，按 Enter 送出</div>}
          {msgs.map((m, i) => (
            <div key={i} className={`flex gap-2 ${m.from === "me" ? "justify-end" : "justify-start"}`}>
              {m.from === "bot" && <Bot className="h-6 w-6 shrink-0 text-emerald-700 mt-1" />}
              <div className="max-w-[80%] space-y-1">
                <div className={`whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm shadow-sm ${m.from === "me" ? "bg-[#06c755] text-white" : m.from === "sys" ? "bg-rose-50 text-rose-800 border border-rose-200" : "bg-background"}`}>{m.text}</div>
                {!!m.quick?.length && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.quick.map((q) => <button key={q} type="button" disabled={busy} onClick={() => void send(q)} className="text-xs rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">{q}</button>)}
                  </div>
                )}
                {m.ms !== undefined && <div className="text-[10px] text-muted-foreground">回覆耗時 {(m.ms / 1000).toFixed(1)} 秒</div>}
                {m.orderNo && (
                  <button type="button" onClick={() => void openSave(m)} className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                    <BookmarkPlus className="h-3 w-3" />改對後存成範例
                  </button>
                )}
              </div>
              {m.from === "me" && <User className="h-6 w-6 shrink-0 text-muted-foreground mt-1" />}
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />機器人思考中…</div>}
          <div ref={endRef} />
        </div>
        <div className="flex gap-2">
          <Textarea rows={2} value={text} placeholder="輸入要傳給機器人的訊息（Enter 送出，Shift+Enter 換行）" disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(text); } }} />
          <div className="flex flex-col gap-1.5">
            <Button disabled={busy || !text.trim()} onClick={() => void send(text)}><Send className="h-4 w-4 mr-1" />送出</Button>
            <Button variant="outline" size="sm" disabled={busy || !msgs.length} onClick={() => setMsgs([])}><RotateCcw className="h-3.5 w-3.5 mr-1" />清畫面</Button>
          </div>
        </div>
      </CardContent>
      {ex && (
        <Dialog open onOpenChange={(o) => !o && setEx(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>存成範例（{ex.order_no}）</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">右邊是目前草稿的整理結果。<b className="text-foreground">如果有錯，請直接改成正確的</b>再儲存；AI 之後遇到類似寫法會照這個理解。</p>
            <div className="grid gap-3 md:grid-cols-2">
              <div><div className="text-xs text-muted-foreground mb-1">老闆的訊息</div>
                <Textarea rows={8} value={ex.input_text} onChange={(e) => setEx({ ...ex, input_text: e.target.value })} /></div>
              <div><div className="text-xs text-muted-foreground mb-1">正確結果</div>
                <Textarea rows={8} value={ex.expected_text} onChange={(e) => setEx({ ...ex, expected_text: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEx(null)}>取消</Button>
              <Button disabled={saving || !ex.input_text.trim() || !ex.expected_text.trim()} onClick={() => void saveExample()}>{saving ? "儲存中…" : "存成範例"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
