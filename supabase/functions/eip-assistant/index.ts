// supabase/functions/eip-assistant/index.ts
// EIP 內建 AI 助理:使用「呼叫者 JWT」+ RLS,工具皆唯讀且自動限縮為當前登入者可見/擁有的資料。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface ChatPayload {
  conversation_id?: string;
  user_message: string;
}

// ---------- Tool 定義 ----------
const tools = [
  {
    name: "get_my_work_summary",
    description:
      "回傳『目前登入者本人』的工作概況:我的待辦數(未完成)、逾期數(期限已過且未完成)、本週到期數(未來七天內到期且未完成)、待我確認數(狀態為『待確認』)。當使用者問『我的概況/我有什麼要做/我有沒有逾期』時使用。",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_my_tasks",
    description:
      "列出『目前登入者本人負責』的任務,可依狀態名稱或僅逾期過濾。回傳標題、狀態、所屬專案、進度、期限、優先級。當使用者問『我的任務/我的待辦/我負責什麼』時使用。",
    input_schema: {
      type: "object",
      properties: {
        status_name: { type: "string", description: "狀態名稱,如『待辦』『進行中』『待確認』『完成』" },
        overdue_only: { type: "boolean", description: "僅顯示逾期(期限已過且未完成)" },
        limit: { type: "number", description: "最多筆數,預設 50" },
      },
    },
  },
  {
    name: "list_announcements",
    description:
      "列出目前登入者可見的已發布公告(置頂優先、再依發布時間新到舊)。回傳標題、內文摘要、是否置頂、發布時間。",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number", description: "最多筆數,預設 10" } },
    },
  },
  {
    name: "search_documents",
    description:
      "在文件中心搜尋目前登入者可見的文件(以標題或摘要關鍵字比對)。回傳標題、摘要、類型、狀態。",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜尋關鍵字" },
        limit: { type: "number", description: "最多筆數,預設 20" },
      },
      required: ["query"],
    },
  },
];

// ---------- Tool 實作(全部用呼叫者 JWT 的 client,RLS 生效) ----------
async function runTool(
  sb: ReturnType<typeof createClient>,
  uid: string,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const today = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);

  if (name === "get_my_work_summary") {
    const { data, error } = await sb
      .from("task")
      .select("due_date, task_status(name, is_done_state)")
      .eq("owner_id", uid);
    if (error) throw error;
    const rows = (data ?? []) as any[];
    let todo = 0, overdue = 0, dueThisWeek = 0, awaitingConfirm = 0;
    for (const r of rows) {
      const done = r.task_status?.is_done_state === true;
      const sname = r.task_status?.name ?? "";
      if (sname === "待確認") awaitingConfirm++;
      if (!done) {
        todo++;
        if (r.due_date && r.due_date < today) overdue++;
        else if (r.due_date && r.due_date >= today && r.due_date <= weekEnd) dueThisWeek++;
      }
    }
    return { 我的待辦: todo, 逾期: overdue, 本週到期: dueThisWeek, 待我確認: awaitingConfirm };
  }

  if (name === "list_my_tasks") {
    const limit = Math.min(Number(input.limit) || 50, 100);
    const { data, error } = await sb
      .from("task")
      .select("title, due_date, priority, progress, task_status(name, is_done_state), project(name)")
      .eq("owner_id", uid)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(limit);
    if (error) throw error;
    let rows = (data ?? []) as any[];
    if (input.status_name) rows = rows.filter((r) => r.task_status?.name === input.status_name);
    if (input.overdue_only) rows = rows.filter((r) => r.due_date && r.due_date < today && r.task_status?.is_done_state === false);
    return rows.map((r) => ({
      title: r.title,
      status: r.task_status?.name ?? null,
      project: r.project?.name ?? null,
      progress: r.progress,
      due_date: r.due_date,
      priority: r.priority,
    }));
  }

  if (name === "list_announcements") {
    const limit = Math.min(Number(input.limit) || 10, 50);
    const { data, error } = await sb
      .from("announcement")
      .select("title, body, is_pinned, published_at")
      .not("published_at", "is", null)
      .order("is_pinned", { ascending: false })
      .order("published_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((a: any) => ({
      title: a.title,
      excerpt: (a.body ?? "").slice(0, 200),
      is_pinned: a.is_pinned,
      published_at: a.published_at,
    }));
  }

  if (name === "search_documents") {
    // 消毒後才組進 PostgREST 的 .or()：逗號與括號會改寫過濾樹,% 與 * 是萬用字元。
    // 這裡與 line-webhook 的同名工具(M15)採同一條規則,並限制長度。
    // 註:查詢走呼叫者 JWT、RLS 仍然生效,所以這不是越權修補,而是避免被構造出
    //     錯誤回應做探測、或讓查詢直接壞掉。
    const raw = String(input.query ?? "").trim();
    const q = raw.replace(/[,()\\"'%*]/g, "").slice(0, 80);
    if (!q) return [];
    const limit = Math.min(Number(input.limit) || 20, 50);
    const { data, error } = await sb
      .from("eip_document")
      .select("title, summary, doc_type, status")
      .or(`title.ilike.%${q}%,summary.ilike.%${q}%`)
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((d: any) => ({
      title: d.title,
      summary: d.summary,
      doc_type: d.doc_type,
      status: d.status,
    }));
  }

  throw new Error(`未知的工具:${name}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) return jsonResponse({ error: "尚未設定 ANTHROPIC_API_KEY" }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return jsonResponse({ error: "未登入" }, 401);

    // 呼叫者 client:帶上使用者 JWT → RLS 以該使用者身分生效
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData.user) return jsonResponse({ error: "驗證失敗" }, 401);
    const uid = userData.user.id;

    // 取得本人 app_user(姓名、租戶)
    const { data: me } = await sb
      .from("app_user")
      .select("name, tenant_id")
      .eq("id", uid)
      .maybeSingle();
    if (!me) return jsonResponse({ error: "找不到 EIP 帳號資料" }, 403);
    let roleName = "";
    try {
      const { data: rn } = await sb.rpc("current_role_name");
      if (typeof rn === "string") roleName = rn;
    } catch (_) { /* ignore */ }

    const payload = (await req.json()) as ChatPayload;
    const user_message = (payload.user_message ?? "").trim();
    let conversation_id = payload.conversation_id;
    if (!user_message) return jsonResponse({ error: "缺少 user_message" }, 400);

    // 建立/沿用對話
    if (!conversation_id) {
      const title = user_message.slice(0, 30) + (user_message.length > 30 ? "…" : "");
      const { data: convo, error: convoErr } = await sb
        .from("eip_assistant_conversation")
        .insert({ tenant_id: me.tenant_id, user_id: uid, title })
        .select("id")
        .single();
      if (convoErr || !convo) return jsonResponse({ error: "建立對話失敗:" + (convoErr?.message ?? "") }, 500);
      conversation_id = convo.id;
    }

    // 讀歷史
    const { data: history } = await sb
      .from("eip_assistant_message")
      .select("role, content")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: true });

    const messages: any[] = (history ?? []).map((m: any) => ({ role: m.role, content: m.content }));
    messages.push({ role: "user", content: user_message });

    const today = new Date().toISOString().slice(0, 10);
    const systemPrompt =
      `你是「艾士實業 內部管理平台(EIP)」的 AI 助理。\n` +
      `今天是 ${today}。目前使用者:${me.name}${roleName ? `(${roleName})` : ""}。\n` +
      `你只能透過提供的工具查資料,所有查詢都已自動套用此使用者的權限(RLS),因此「我的任務」「我的待辦」就是這位使用者本人的資料。\n` +
      `需要資料時主動呼叫工具,不要臆測或編造。用繁體中文、簡潔專業地回答,適度用條列。若工具回傳空,如實說明目前沒有資料。`;

    let assistantText = "";
    const MAX_TURNS = 6;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 2048,
          system: systemPrompt,
          tools,
          messages,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error("Anthropic error:", res.status, errText);
        return jsonResponse({ error: `Anthropic API 錯誤 (${res.status}): ${errText}` }, 502);
      }
      const data = await res.json();
      const blocks: any[] = data.content ?? [];
      messages.push({ role: "assistant", content: blocks });

      if (data.stop_reason === "tool_use") {
        const toolResults: any[] = [];
        for (const tu of blocks.filter((b) => b.type === "tool_use")) {
          try {
            const result = await runTool(sb, uid, tu.name, tu.input ?? {});
            toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result) });
          } catch (e) {
            console.error("Tool error:", tu.name, e);
            toolResults.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: `工具執行失敗:${(e as Error).message}` });
          }
        }
        messages.push({ role: "user", content: toolResults });
        continue;
      }
      assistantText = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n") || "(沒有回覆)";
      break;
    }
    if (!assistantText) assistantText = "(達到工具呼叫上限,未取得最終回覆)";

    const { error: insErr } = await sb.from("eip_assistant_message").insert([
      { conversation_id, role: "user", content: user_message },
      { conversation_id, role: "assistant", content: assistantText },
    ]);
    if (insErr) console.error("Insert message error:", insErr);

    return jsonResponse({ conversation_id, reply: assistantText });
  } catch (err) {
    console.error("eip-assistant error:", err);
    return jsonResponse({ error: (err as Error).message ?? "Unknown error" }, 500);
  }
});
