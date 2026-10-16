import { useEffect, useRef, useState } from "react";
import { Send, RotateCcw, Bot, User, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Msg = { from: "me" | "bot" | "sys"; text: string; quick?: string[]; ms?: number };

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
      else setMsgs((m) => [...m, ...replies.map((r, i) => ({
        from: "bot" as const, text: String(r.text ?? ""),
        quick: (r.quickReply?.items ?? []).map((q: any) => q?.action?.text).filter(Boolean),
        ms: i === replies.length - 1 ? data?.ms : undefined,
      }))]);
    } finally { setBusy(false); }
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
    </Card>
  );
}
