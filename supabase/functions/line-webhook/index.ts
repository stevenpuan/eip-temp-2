// line-webhook：接收 LINE 事件。
//  - follow：歡迎訊息
//  - 未綁定者傳文字：當作綁定碼處理 → 連結 app_user.line_user_id
//  - 已綁定者傳文字：當作向 EIP AI 助理提問 → 以該員工身分（限縮 uid/tenant/role）查資料並回覆
// 安全：LINE 進來沒有使用者 JWT，故用 service_role + 在每個查詢明確過濾 owner_id / tenant_id 自行把關範圍。
//       service_role 繞過 RLS，所以每個查詢都必須自己加 deleted_at is null（回收區資料不可外洩）。
// 效能：驗簽後立即回 200，實際處理（Claude + 工具 + 回覆）放到背景（EdgeRuntime.waitUntil），避免 LINE 逾時重試。
//
// 2026-07-28 稽核修正：
//  H2  簽章驗證改 fail-closed（缺 LINE_CHANNEL_SECRET 直接 500，不再放行）
//  M7a 所有工具查詢補 deleted_at is null
//  M13 reply()/replyWithConfirm() 檢查 LINE 回應，失敗寫入 eip_notification_miss
//  M14 綁定前先清掉同一個 line_user_id 掛在別人身上的紀錄
//  M15 search_documents 的 .or() 過濾掉 PostgREST 語法字元
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  PENDING_MINUTES, canCreateOrder, loadCatalog, parseOrder, saveDraft, draftSummary,
  downloadLineContent, toB64, storeAttachment, addAttachment, sheetToText,
} from "./order.ts";

const ANTHROPIC_MODEL = "claude-sonnet-4-6";

async function verifySignature(secret: string, body: string, signature: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const b64 = btoa(String.fromCharCode(...new Uint8Array(mac)));
    return b64 === signature;
  } catch { return false; }
}

// 失效紀錄：LINE 回覆失敗、事件處理失敗都要留痕，否則「看起來壞掉但查不到原因」
async function logMiss(sb: any, eventCode: string, reason: string) {
  try {
    await sb.from("eip_notification_miss").insert({
      event_code: eventCode, entity_type: "line", entity_id: null,
      reason: reason.slice(0, 500),
    });
  } catch (e) { console.error("logMiss failed", e); }
}

async function postReply(sb: any, token: string, body: unknown, kind: string): Promise<boolean> {
  try {
    const r = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      await logMiss(sb, "line_reply", `LINE ${kind} 回覆失敗 ${r.status}：${t.slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (e) {
    await logMiss(sb, "line_reply", `LINE ${kind} 回覆例外：${(e as Error).message}`);
    return false;
  }
}

async function reply(sb: any, token: string, replyToken: string, text: string): Promise<boolean> {
  return await postReply(sb, token, { replyToken, messages: [{ type: "text", text: text.slice(0, 4900) }] }, "text");
}

// 附「確認/取消」快速回覆按鈕（點一下送出「是」/「否」，不需打字）
async function replyWithConfirm(sb: any, token: string, replyToken: string, text: string): Promise<boolean> {
  return await postReply(sb, token, {
    replyToken,
    messages: [{
      type: "text",
      text: text.slice(0, 4900),
      quickReply: { items: [
        { type: "action", action: { type: "message", label: "✅ 確認建立", text: "是" } },
        { type: "action", action: { type: "message", label: "✖ 取消", text: "否" } },
      ] },
    }],
  }, "confirm");
}

// 訂單草稿：附「送出訂單/取消訂單」按鈕
async function replyOrder(sb: any, token: string, replyToken: string, text: string): Promise<boolean> {
  return await postReply(sb, token, {
    replyToken,
    messages: [{
      type: "text",
      text: text.slice(0, 4900),
      quickReply: { items: [
        { type: "action", action: { type: "message", label: "✅ 送出訂單", text: "送出訂單" } },
        { type: "action", action: { type: "message", label: "✖ 取消訂單", text: "取消訂單" } },
      ] },
    }],
  }, "order");
}

// 編輯距離（模糊姓名比對用）
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[m][n];
}

interface Me { id: string; name: string; tenant_id: string; role: string; department_id?: string | null }

const tools = [
  { name: "get_my_work_summary", description: "回傳這位員工本人的工作概況：待辦數、逾期數、本週到期數、待確認數。問『我的概況/我有什麼要做/有沒有逾期』時用。", input_schema: { type: "object", properties: {} } },
  { name: "get_today_agenda", description: "回傳這位員工『今天』的行事曆（個人行程，含跨日）與今天到期且未完成的任務。問『今天行事曆/今天有什麼行程/今天要做什麼/今日待辦』時用。", input_schema: { type: "object", properties: {} } },
  { name: "list_my_tasks", description: "列出這位員工本人負責的任務，可依狀態名稱或僅逾期過濾。回傳標題、狀態、所屬專案、進度、期限、優先級。", input_schema: { type: "object", properties: { status_name: { type: "string" }, overdue_only: { type: "boolean" }, limit: { type: "number" } } } },
  { name: "create_task", description: "當使用者要在 EIP 看板建立任務時呼叫（『幫我建立/新增任務』『把…加到看板』『指派給○○○』）。預設負責人為本人；要指派給別人就填 assignee（成員姓名）。title 必填；due_date 選填（YYYY-MM-DD）；priority 選填（low/normal/high/urgent）；description 選填。注意：此工具只會『暫存』並等待使用者確認，不會立即寫入；呼叫後請向使用者複述內容並詢問是否確認（回是才會建立）。", input_schema: { type: "object", properties: { title: { type: "string" }, due_date: { type: "string" }, priority: { type: "string" }, description: { type: "string" }, assignee: { type: "string" } }, required: ["title"] } },
  { name: "create_order_draft", description: "使用者在『下訂單／客戶要貨／叫貨／幫客戶訂東西』時呼叫：把使用者描述訂單的原話完整放進 order_text（客戶、品項、數量、交期等）。系統會比對客戶與品項主檔、建立訂單草稿並附上確認按鈕；呼叫後只要簡短告訴使用者『草稿已建立，請確認』即可，不要自己重列品項。一般任務交辦請用 create_task，不要用這個。", input_schema: { type: "object", properties: { order_text: { type: "string" } }, required: ["order_text"] } },
  { name: "list_my_projects", description: "列出與這位員工相關的專案進度（主管/系統設計師看全公司、一般成員看自己負責或參與的）。每個專案回傳狀態、健康度燈號、任務完成數、里程碑達成、KPI 平均達成率、距結束天數、目標。問『專案進度/我的專案/食安專案怎麼樣了』時用。", input_schema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "list_announcements", description: "列出公司全體公告（置頂優先）。回傳標題、摘要、是否置頂、發布時間。", input_schema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "search_documents", description: "在文件中心搜尋已發布文件（標題或摘要關鍵字）。回傳標題、摘要、類型。", input_schema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
];

// 網頁端建立任務要過 RLS 的 task_insert：
//   current_role_name() = any('company_admin','dept_manager','member')
// 這支函式用 service_role，RLS 不會生效，所以同一條規則必須自己寫一次；
// 否則「唯讀」角色從網頁被擋、從 LINE 卻建得成。
const TASK_CREATE_ROLES = ["company_admin", "dept_manager", "member"];

async function insertTask(sb: any, me: Me, p: { title: string; due_date: string | null; priority: string; description: string | null; owner_id?: string | null; department_id?: string | null }): Promise<{ id: string; title: string } | null> {
  if (!TASK_CREATE_ROLES.includes(me.role)) {
    throw new Error("你的帳號沒有建立任務的權限");
  }
  const { data: st } = await sb.from("task_status").select("id")
    .eq("tenant_id", me.tenant_id).eq("is_default", true).eq("is_done_state", false)
    .order("sort_order", { ascending: true }).limit(1).maybeSingle();
  if (!st?.id) throw new Error("找不到預設任務狀態");
  const { data, error } = await sb.from("task").insert({
    tenant_id: me.tenant_id, title: p.title, description: p.description,
    owner_id: p.owner_id ?? me.id, created_by: me.id, status_id: st.id, priority: p.priority, progress: 0,
    due_date: p.due_date, department_id: p.department_id ?? me.department_id ?? null, visibility_scope: "company",
  }).select("id, title").maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function runTool(sb: any, me: Me, name: string, input: Record<string, unknown>, apiKey = ""): Promise<unknown> {
  const uid = me.id, tenantId = me.tenant_id;
  const today = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);

  if (name === "get_my_work_summary") {
    const { data } = await sb.from("task").select("due_date, task_status(name, is_done_state)")
      .eq("owner_id", uid).is("deleted_at", null);
    let todo = 0, overdue = 0, dueThisWeek = 0, awaitingConfirm = 0;
    for (const r of (data ?? []) as any[]) {
      const done = r.task_status?.is_done_state === true;
      const sname = r.task_status?.name ?? "";
      if (sname === "待確認") awaitingConfirm++;
      if (!done) { todo++; if (r.due_date && r.due_date < today) overdue++; else if (r.due_date && r.due_date >= today && r.due_date <= weekEnd) dueThisWeek++; }
    }
    return { 我的待辦: todo, 逾期: overdue, 本週到期: dueThisWeek, 待我確認: awaitingConfirm };
  }

  if (name === "get_today_agenda") {
    const { data: events } = await sb.from("personal_event")
      .select("title, start_time, end_time, start_date, end_date")
      .eq("user_id", uid).is("deleted_at", null)
      .lte("start_date", today).or(`end_date.gte.${today},end_date.is.null`)
      .order("start_time", { ascending: true, nullsFirst: true });
    const { data: tasks } = await sb.from("task")
      .select("title, priority, task_status(name, is_done_state)")
      .eq("owner_id", uid).eq("due_date", today).is("deleted_at", null);
    const agenda = (events ?? []).map((e: any) => ({
      標題: e.title,
      時間: e.start_time ? (e.start_time.slice(0, 5) + (e.end_time ? "-" + e.end_time.slice(0, 5) : "")) : "整天",
    }));
    const dueTasks = (tasks ?? []).filter((t: any) => t.task_status?.is_done_state !== true)
      .map((t: any) => ({ 標題: t.title, 狀態: t.task_status?.name ?? null, 優先級: t.priority }));
    return { 日期: today, 今日行事曆: agenda, 今日到期任務: dueTasks };
  }

  if (name === "list_my_tasks") {
    const limit = Math.min(Number(input.limit) || 30, 50);
    const { data } = await sb.from("task")
      .select("title, due_date, priority, progress, task_status(name, is_done_state), project(name)")
      .eq("owner_id", uid).is("deleted_at", null)
      .order("due_date", { ascending: true, nullsFirst: false }).limit(limit);
    let rows = (data ?? []) as any[];
    if (input.status_name) rows = rows.filter((r) => r.task_status?.name === input.status_name);
    if (input.overdue_only) rows = rows.filter((r) => r.due_date && r.due_date < today && r.task_status?.is_done_state === false);
    return rows.map((r) => ({ title: r.title, status: r.task_status?.name ?? null, project: r.project?.name ?? null, progress: r.progress, due_date: r.due_date, priority: r.priority }));
  }

  if (name === "create_task") {
    // 先擋在暫存前面，使用者才不會被問「要建立嗎」按了確認才發現沒權限
    if (!TASK_CREATE_ROLES.includes(me.role)) {
      return { error: "你的帳號沒有建立任務的權限，請改用網頁或聯絡管理者。" };
    }
    const title = String(input.title ?? "").trim();
    if (!title) throw new Error("缺少任務標題");
    const pr = ["low", "normal", "high", "urgent"].includes(String(input.priority)) ? String(input.priority) : "normal";
    const due = /^\d{4}-\d{2}-\d{2}$/.test(String(input.due_date ?? "")) ? String(input.due_date) : null;
    let ownerId: string | null = null, ownerDept: string | null = null, ownerName = "你本人", fuzzy = false;
    const asg = String(input.assignee ?? "").trim();
    if (asg) {
      let cands: any[] = [];
      const asgSafe = asg.replace(/[%_,()\\"']/g, "");
      const { data: exact } = await sb.from("app_user").select("id,name,department_id")
        .eq("tenant_id", tenantId).eq("status", "active").ilike("name", `%${asgSafe}%`);
      cands = exact ?? [];
      if (cands.length === 0) {
        const { data: all } = await sb.from("app_user").select("id,name,department_id")
          .eq("tenant_id", tenantId).eq("status", "active");
        const near = (all ?? []).filter((u: any) => lev(String(u.name), asg) <= 1);
        if (near.length === 0) return { error: `找不到成員「${asg}」，請確認姓名（或不指定，預設建給你自己）。` };
        if (near.length > 1) return { error: `找不到「${asg}」，相近的成員有：${near.map((c: any) => c.name).join("、")}，請指明是哪一位。` };
        cands = near; fuzzy = true;
      }
      if (cands.length > 1) return { error: `符合「${asg}」的成員有多位：${cands.map((c: any) => c.name).join("、")}，請指明是哪一位。` };
      ownerId = cands[0].id; ownerDept = cands[0].department_id; ownerName = cands[0].name;
    }
    await sb.from("line_pending_task").upsert({
      user_id: uid, tenant_id: tenantId, title,
      due_date: due, priority: pr,
      description: input.description ? String(input.description) : null,
      owner_id: ownerId, department_id: ownerDept,
      created_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    return { staged: true, 摘要: { 標題: title, 負責人: ownerName + (fuzzy ? "（相近姓名對應，如非此人請取消）" : ""), 期限: due ?? "未設定", 優先級: pr }, 指示: "尚未寫入。請向使用者複述以上內容（含負責人；若為相近姓名對應，提醒使用者確認是否為該人），並詢問『要建立這筆任務嗎？』。已附上「確認建立/取消」按鈕請使用者點選；務必說明這是待確認、還沒建立。" };
  }

  if (name === "create_order_draft") {
    if (!(await canCreateOrder(sb, me.id))) return { error: "你的帳號沒有建立訂單的權限，請聯絡管理者開通「訂單接收」。" };
    const text = String(input.order_text ?? "").trim();
    if (!text) return { error: "沒有訂單內容" };
    const catalog = await loadCatalog(sb, tenantId);
    const parsed = await parseOrder(apiKey, catalog, { text, senderName: me.name });
    if (!parsed.is_order) return { not_order: true, 指示: "這段內容看起來不像訂單，請請使用者補充客戶、品項與數量。" };
    const { orderNo } = await saveDraft(sb, me as any, parsed, catalog, { rawText: text });
    return { staged_order: true, 訂單編號: orderNo, 指示: "草稿已建立，系統會自動附上草稿明細與送出按鈕。你只要回一句『已整理成訂單草稿，請確認』，不要重列品項。" };
  }

  if (name === "list_my_projects") {
    // 2026-07-29 稽核修正：原本 dept_manager 與 company_admin 一樣拿全 tenant 的專案，
    // 比網頁端 RLS（project_read → eip_can_see_project，限自己的部門子樹）寬。
    // 改成：company_admin 看全公司；其餘＝自己負責 + 有參與 + 管轄部門子樹的專案。
    let ids: string[] = [];
    if (me.role === "company_admin") {
      const { data } = await sb.from("project").select("id").eq("tenant_id", tenantId);
      ids = (data ?? []).map((p: any) => p.id);
    } else {
      const { data: owned } = await sb.from("project").select("id").eq("tenant_id", tenantId).eq("owner_id", uid);
      const { data: mem } = await sb.from("project_member").select("project_id").eq("user_id", uid);
      // service_role 沒有 auth.uid()，所以用帶 user id 的版本取管轄部門子樹
      const { data: sup } = await sb.rpc("eip_supervised_departments_of", { p_user: uid });
      const deptIds: string[] = (sup ?? [])
        .map((r: any) => (typeof r === "string" ? r : r?.eip_supervised_departments_of ?? r?.id))
        .filter(Boolean);
      let deptProj: any[] = [];
      if (deptIds.length > 0) {
        const { data } = await sb.from("project").select("id")
          .eq("tenant_id", tenantId).in("department_id", deptIds);
        deptProj = data ?? [];
      }
      ids = Array.from(new Set([
        ...(owned ?? []).map((p: any) => p.id),
        ...(mem ?? []).map((m: any) => m.project_id),
        ...deptProj.map((p: any) => p.id),
      ]));
    }
    if (ids.length === 0) return [];
    const limit = Math.min(Number(input.limit) || 10, 20);
    ids = ids.slice(0, limit);
    const { data: projs } = await sb.from("project").select("id,name,status,health,end_date,goal").in("id", ids);
    const sMap: any = { planning: "規劃中", active: "進行中", on_hold: "暫停", done: "已完成" };
    const hMap: any = { on_track: "順利（綠燈）", at_risk: "有風險（黃燈）", off_track: "落後（紅燈）" };
    const out: any[] = [];
    for (const p of (projs ?? [])) {
      const { data: tasks } = await sb.from("task").select("task_status(is_done_state)")
        .eq("project_id", p.id).is("deleted_at", null);
      const tTotal = (tasks ?? []).length;
      const tDone = (tasks ?? []).filter((t: any) => t.task_status?.is_done_state === true).length;
      const { data: ms } = await sb.from("milestone").select("status").eq("project_id", p.id);
      const mTotal = (ms ?? []).length, mDone = (ms ?? []).filter((m: any) => m.status === "done").length;
      const { data: kpis } = await sb.from("project_kpi").select("target_value,current_value").eq("project_id", p.id);
      const valid = (kpis ?? []).filter((k: any) => Number(k.target_value) > 0);
      const kpiAch = valid.length ? Math.round(valid.reduce((a: number, k: any) => a + Math.min(Number(k.current_value) / Number(k.target_value), 1), 0) / valid.length * 100) : null;
      const daysLeft = p.end_date ? Math.ceil((new Date(p.end_date).getTime() - Date.now()) / 864e5) : null;
      out.push({ 專案: p.name, 狀態: sMap[p.status] ?? p.status, 健康度: hMap[p.health] ?? p.health, 任務完成: tTotal ? `${tDone}/${tTotal}` : "無任務", 里程碑: mTotal ? `${mDone}/${mTotal}` : "無", KPI平均達成: kpiAch !== null ? kpiAch + "%" : "無", 距結束天數: daysLeft, 目標: p.goal ? String(p.goal).slice(0, 80) : null });
    }
    return out;
  }

  if (name === "list_announcements") {
    const limit = Math.min(Number(input.limit) || 10, 30);
    const { data } = await sb.from("announcement").select("title, body, is_pinned, published_at")
      .eq("tenant_id", tenantId).eq("audience_type", "all").not("published_at", "is", null)
      .is("deleted_at", null)
      .order("is_pinned", { ascending: false }).order("published_at", { ascending: false }).limit(limit);
    return (data ?? []).map((a: any) => ({ title: a.title, excerpt: (a.body ?? "").slice(0, 160), is_pinned: a.is_pinned, published_at: a.published_at }));
  }

  if (name === "search_documents") {
    const q = String(input.query ?? "").trim();
    if (!q) return [];
    // PostgREST 的 or= 用逗號分隔條件、括號分組，未轉義的輸入可以改寫過濾樹（M15）
    const qs = q.replace(/[,()\\"'%*]/g, "").slice(0, 80);
    if (!qs) return [];
    const limit = Math.min(Number(input.limit) || 15, 30);
    const { data } = await sb.from("eip_document").select("title, summary, doc_type, status")
      .eq("tenant_id", tenantId).eq("status", "published").is("deleted_at", null)
      .or(`title.ilike.%${qs}%,summary.ilike.%${qs}%`).limit(limit);
    return (data ?? []).map((d: any) => ({ title: d.title, summary: d.summary, doc_type: d.doc_type }));
  }
  throw new Error(`未知的工具：${name}`);
}

async function askAssistant(sb: any, apiKey: string, me: Me, conversationId: string | null, userText: string): Promise<string> {
  let routingGuide = "";
  try {
    const { data: intents } = await sb.from("eip_assistant_intent")
      .select("feature,keywords,intent,in_line_assistant,web_route").eq("tenant_id", me.tenant_id).order("sort_order", { ascending: true });
    const sup = (intents ?? []).filter((i: any) => i.in_line_assistant)
      .map((i: any) => `・${i.feature}（${(i.keywords || []).join("、")}）→工具 ${i.intent}`).join("\n");
    const uns = (intents ?? []).filter((i: any) => !i.in_line_assistant)
      .map((i: any) => `・${i.feature}（${(i.keywords || []).join("、")}）→目前 LINE 不支援，請告知使用者到網頁系統「${i.feature}」頁操作`).join("\n");
    if (sup || uns) routingGuide = `\n【意圖對照（關鍵字→處理方式）】\n可直接查：\n${sup}\n\n暫不支援、請引導到網頁：\n${uns}\n`;
  } catch (_) { /* 指引載入失敗不影響回答 */ }

  const messages: any[] = [{ role: "user", content: userText }];

  const today = new Date().toISOString().slice(0, 10);
  const system =
    `你是「EIP 內部管理平台」的 AI 助理，正透過 LINE 與員工對話。\n` +
    `今天是 ${today}。目前使用者：${me.name}。\n` +
    `需要資料時呼叫對應工具，不要臆測或編造。依下方意圖對照判斷使用者要的是哪個功能；若屬「暫不支援」的功能，就引導他到網頁系統，不要硬用工具湊答案。\n` +
    `你可以：查今日行事曆與待辦（get_today_agenda）、查/列任務、查專案與公告、搜文件，並可『直接幫使用者在看板建立任務』（create_task）、『把客戶訂單整理成訂單草稿』（create_order_draft；使用者描述客戶要什麼貨、幾箱、何時送時用）；使用者用口語描述要新增的任務時，抽取標題、期限（YYYY-MM-DD）、優先級後呼叫 create_task；若使用者說『指派給○○』就把該姓名放進 assignee（不指定則建給本人）。建立後複述確認。\n` +
    routingGuide +
    `\n只回答使用者「這一次」的問題，不要重複上一則已經回答過的內容，除非使用者明確要求（例如『再列一次』『剛剛那些』）。\n` +
    `格式：LINE 聊天視窗，一律純文字，不要 Markdown（不要 **、#、表格符號 |），用簡短條列（數字或「・」）。\n` +
    `若使用者指定了想看的內容、欄位、數量或格式（『只列逾期』『用一行』『不要進度』『前三筆』），就照他的要求，不要多給；沒指定才預設精簡。回答用繁體中文、口語、精簡。`;

  for (let turn = 0; turn < 5; turn++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 1024, system, tools, messages }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("anthropic", res.status, t);
      await logMiss(sb, "line_assistant", `Anthropic ${res.status}：${t.slice(0, 300)}`);
      return "抱歉，助理暫時無法回應，請稍後再試。";
    }
    const data = await res.json();
    const blocks: any[] = data.content ?? [];
    messages.push({ role: "assistant", content: blocks });
    if (data.stop_reason === "tool_use") {
      const results: any[] = [];
      for (const tu of blocks.filter((b) => b.type === "tool_use")) {
        try { results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(await runTool(sb, me, tu.name, tu.input ?? {}, apiKey)) }); }
        catch (e) { results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: `工具失敗：${(e as Error).message}` }); }
      }
      messages.push({ role: "user", content: results });
      continue;
    }
    return blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n") || "（沒有回覆）";
  }
  return "（查詢次數過多，請換個方式問問看）";
}

// ───────────────────────── 已綁定使用者 ─────────────────────────

async function logInbound(sb: any, me: Me, ev: any, row: Record<string, unknown>) {
  try {
    await sb.from("line_inbound_message").insert({
      tenant_id: me.tenant_id, user_id: me.id, line_message_id: ev?.message?.id ?? null,
      message_type: String(ev?.message?.type ?? "unknown"), ...row,
    });
  } catch (e) { console.error("logInbound", e); }
}

const ORDER_PREFIX = /^(下單|訂單|叫貨|訂貨|要貨|新訂單)[:：\s,，]*/;
const SUBMIT_RE = /^(送出訂單|確認訂單|送出|確認|確定|是|是的|好|好的|ok|yes|y)$/i;
const CANCEL_RE = /^(取消訂單|取消|作廢|不要|否|no|n)$/i;

async function currentPendingOrder(sb: any, me: Me): Promise<{ order_id: string; created_at: string } | null> {
  const { data } = await sb.from("line_pending_order").select("order_id, created_at").eq("user_id", me.id).maybeSingle();
  if (!data) return null;
  if (Date.now() - new Date(data.created_at).getTime() > PENDING_MINUTES * 60 * 1000) {
    await sb.from("line_pending_order").delete().eq("user_id", me.id);
    return null;
  }
  const { data: o } = await sb.from("eip_sales_order").select("status, deleted_at").eq("id", data.order_id).maybeSingle();
  if (!o || o.status !== "draft" || o.deleted_at) { await sb.from("line_pending_order").delete().eq("user_id", me.id); return null; }
  return data;
}

async function existingDraftJson(sb: any, orderId: string) {
  const { data: o } = await sb.from("eip_sales_order").select("customer_text, delivery_date, delivery_address, note, contact_name, contact_phone, eip_customer(code,name)").eq("id", orderId).maybeSingle();
  const { data: ls } = await sb.from("eip_sales_order_line").select("line_no, product_text, spec, qty, unit, unit_price, note, eip_product(code,name)").eq("order_id", orderId).order("line_no");
  return {
    customer_text: o?.customer_text, customer_code: o?.eip_customer?.code ?? o?.eip_customer?.name ?? null,
    delivery_date: o?.delivery_date, delivery_address: o?.delivery_address, note: o?.note,
    contact_name: o?.contact_name, contact_phone: o?.contact_phone,
    lines: (ls ?? []).map((l: any) => ({ 第幾項: l.line_no, product_text: l.product_text, product_code: l.eip_product?.code ?? l.eip_product?.name ?? null, spec: l.spec, qty: l.qty, unit: l.unit, unit_price: l.unit_price, note: l.note })),
  };
}

async function handleOrderInput(sb: any, token: string | undefined, anthKey: string, ev: any, me: Me, input: {
  text?: string; image?: { mime: string; b64: string }; pdf?: { b64: string }; sheetText?: string;
  file?: { name: string; bytes: Uint8Array; mime: string };
}, pendingOrderId: string | null): Promise<"handled" | "not_order"> {
  const catalog = await loadCatalog(sb, me.tenant_id);
  const existing = pendingOrderId ? await existingDraftJson(sb, pendingOrderId) : undefined;
  const parsed = await parseOrder(anthKey, catalog, { ...input, existing, senderName: me.name });
  await logInbound(sb, me, ev, {
    text_content: input.text ?? null, file_name: input.file?.name ?? null, mime_type: input.file?.mime ?? null,
    intent: parsed.is_order ? (pendingOrderId ? "order_edit" : "order_new") : "not_order", parse_result: parsed,
    related_order_id: pendingOrderId,
  });
  if (!parsed.is_order) return "not_order";
  const { orderId } = await saveDraft(sb, me as any, parsed, catalog, { existingOrderId: pendingOrderId, rawText: input.text ?? (input.file ? `［檔案］${input.file.name}` : null) });
  if (input.file) {
    const att = await storeAttachment(sb, orderId, input.file.name, input.file.bytes, input.file.mime);
    if (att) await addAttachment(sb, orderId, att);
  }
  const summary = await draftSummary(sb, orderId);
  if (token && ev.replyToken) await replyOrder(sb, token, ev.replyToken, summary);
  return "handled";
}

async function handleBound(sb: any, token: string | undefined, anthKey: string | undefined, ev: any, me: Me) {
  const mtype = String(ev?.message?.type ?? "");
  if (!anthKey) { if (token && ev.replyToken) await reply(sb, token, ev.replyToken, "助理尚未啟用（缺少 API 金鑰），請聯絡管理者。"); return; }

  // ── 照片／檔案：一律當訂單資料解析
  if (mtype === "image" || mtype === "file") {
    if (!(await canCreateOrder(sb, me.id))) {
      if (token && ev.replyToken) await reply(sb, token, ev.replyToken, "收到檔案，但你的帳號沒有「訂單接收」的權限，請聯絡管理者開通。");
      return;
    }
    if (!token) return;
    const fileName = mtype === "file" ? String(ev.message.fileName ?? "file") : `photo_${ev.message.id}.jpg`;
    const ext = fileName.toLowerCase().split(".").pop() ?? "";
    const pending = await currentPendingOrder(sb, me);
    try {
      const { bytes, mime } = await downloadLineContent(token, ev.message.id);
      const input: any = { file: { name: fileName, bytes, mime } };
      if (mtype === "image") {
        const m = /^image\/(jpeg|png|gif|webp)$/.test(mime) ? mime : "image/jpeg";
        input.image = { mime: m, b64: toB64(bytes) };
      } else if (ext === "pdf") {
        input.pdf = { b64: toB64(bytes) };
        input.file.mime = "application/pdf";
      } else if (["xlsx", "xls", "csv"].includes(ext)) {
        input.sheetText = ext === "csv" ? new TextDecoder().decode(bytes) : await sheetToText(bytes);
      } else {
        await reply(sb, token, ev.replyToken, "目前可以解析的檔案是：照片、PDF、Excel（xlsx/xls）、CSV。");
        return;
      }
      const r = await handleOrderInput(sb, token, anthKey, ev, me, input, pending?.order_id ?? null);
      if (r === "not_order") await reply(sb, token, ev.replyToken, "這份內容看起來不是訂單（沒有看到客戶或品項數量）。如果是訂單，請補一句說明，例如：「下單，王記，這張照片的品項，週五送」。");
    } catch (e) {
      await logMiss(sb, "line_order", `檔案解析失敗：${(e as Error).message}`);
      await reply(sb, token, ev.replyToken, `檔案處理失敗：${(e as Error).message}`);
    }
    return;
  }

  if (mtype === "audio") {
    if (token && ev.replyToken) await reply(sb, token, ev.replyToken, "目前還不能直接聽語音檔。請按 LINE 輸入框旁的麥克風「語音輸入」，講完會自動變成文字，再按送出就可以了。");
    return;
  }
  if (mtype !== "text") return;

  const text = String(ev.message.text || "").trim();
  const norm = text.replace(/\s/g, "");

  // ── 待確認：任務與訂單，誰比較新就先處理誰
  const { data: pend } = await sb.from("line_pending_task").select("*").eq("user_id", me.id).maybeSingle();
  const pendTaskFresh = pend && (Date.now() - new Date(pend.created_at).getTime()) < 15 * 60 * 1000;
  const pendOrder = await currentPendingOrder(sb, me);
  const orderIsNewer = pendOrder && (!pendTaskFresh || new Date(pendOrder.created_at) > new Date(pend.created_at));

  if (pendOrder && orderIsNewer) {
    if (SUBMIT_RE.test(norm)) {
      const { data: o, error } = await sb.from("eip_sales_order").update({ status: "pending_review" })
        .eq("id", pendOrder.order_id).eq("status", "draft").select("order_no").maybeSingle();
      await sb.from("line_pending_order").delete().eq("user_id", me.id);
      await logInbound(sb, me, ev, { text_content: text, intent: "order_submit", related_order_id: pendOrder.order_id });
      if (token && ev.replyToken) await reply(sb, token, ev.replyToken, error ? `送出失敗：${error.message}` : `✅ 已送出訂單 ${o?.order_no ?? ""}，內勤會在系統覆核補齊資料，有問題會再跟您確認。`);
      return;
    }
    if (CANCEL_RE.test(norm)) {
      await sb.from("eip_sales_order").update({ status: "cancelled", cancelled_reason: "老闆於 LINE 取消" }).eq("id", pendOrder.order_id).eq("status", "draft");
      await sb.from("line_pending_order").delete().eq("user_id", me.id);
      await logInbound(sb, me, ev, { text_content: text, intent: "order_cancel", related_order_id: pendOrder.order_id });
      if (token && ev.replyToken) await reply(sb, token, ev.replyToken, "已取消這張訂單草稿。");
      return;
    }
    // 其他文字：先當成「修改草稿」解析；不是訂單內容才交給一般助理
    const isNew = /^新訂單/.test(norm);
    if (isNew) await sb.from("line_pending_order").delete().eq("user_id", me.id);
    try {
      const r = await handleOrderInput(sb, token, anthKey, ev, me, { text: text.replace(ORDER_PREFIX, "") || text }, isNew ? null : pendOrder.order_id);
      if (r === "handled") return;
    } catch (e) {
      await logMiss(sb, "line_order", `訂單修改解析失敗：${(e as Error).message}`);
      if (token && ev.replyToken) await reply(sb, token, ev.replyToken, `訂單解析失敗：${(e as Error).message}`);
      return;
    }
  } else if (pendTaskFresh) {
    if (/^(是|是的|對|好|好的|確認|確定|建立|ok|yes|y)$/i.test(norm)) {
      try {
        const created = await insertTask(sb, me as Me, { title: pend.title, due_date: pend.due_date, priority: pend.priority, description: pend.description, owner_id: pend.owner_id, department_id: pend.department_id });
        await sb.from("line_pending_task").delete().eq("user_id", me.id);
        if (token && ev.replyToken) await reply(sb, token, ev.replyToken, `✅ 已建立任務：${created?.title}` + (pend.due_date ? `（期限 ${pend.due_date}）` : ""));
      } catch (e) {
        if (token && ev.replyToken) await reply(sb, token, ev.replyToken, `建立失敗：${(e as Error).message}`);
      }
      return;
    }
    if (/^(否|不|不要|取消|no|n)$/i.test(norm)) {
      await sb.from("line_pending_task").delete().eq("user_id", me.id);
      if (token && ev.replyToken) await reply(sb, token, ev.replyToken, "已取消建立。");
      return;
    }
    await sb.from("line_pending_task").delete().eq("user_id", me.id);
  }

  // ── 明確的下單口令：直接走訂單解析，不經一般助理
  if (ORDER_PREFIX.test(text)) {
    if (!(await canCreateOrder(sb, me.id))) {
      if (token && ev.replyToken) await reply(sb, token, ev.replyToken, "你的帳號沒有「訂單接收」的權限，請聯絡管理者開通。");
      return;
    }
    if (pendOrder) await sb.from("line_pending_order").delete().eq("user_id", me.id);
    try {
      const r = await handleOrderInput(sb, token, anthKey, ev, me, { text: text.replace(ORDER_PREFIX, "") || text }, null);
      if (r === "not_order" && token && ev.replyToken) await reply(sb, token, ev.replyToken, "沒有看懂這張訂單，請至少說明：客戶、品項、數量（交期可之後補）。例如：「下單，王記，原味 10 箱、綠茶 5 箱，週五送」。");
    } catch (e) {
      await logMiss(sb, "line_order", `訂單解析失敗：${(e as Error).message}`);
      if (token && ev.replyToken) await reply(sb, token, ev.replyToken, `訂單解析失敗：${(e as Error).message}`);
    }
    return;
  }

  // ── 一般助理（含 create_task / create_order_draft 工具）
  let convoId: string | null = null;
  const { data: convo } = await sb.from("eip_assistant_conversation").select("id").eq("user_id", me.id).eq("title", "LINE 助理").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (convo) convoId = convo.id;
  else { const { data: nc } = await sb.from("eip_assistant_conversation").insert({ tenant_id: me.tenant_id, user_id: me.id, title: "LINE 助理" }).select("id").maybeSingle(); convoId = nc?.id ?? null; }
  let answer = await askAssistant(sb, anthKey, me as Me, convoId, text);
  const { data: justPend } = await sb.from("line_pending_task").select("created_at").eq("user_id", me.id).maybeSingle();
  const justStaged = justPend && (Date.now() - new Date(justPend.created_at).getTime()) < 30000;
  const { data: justOrder } = await sb.from("line_pending_order").select("order_id, created_at").eq("user_id", me.id).maybeSingle();
  const orderStaged = justOrder && (Date.now() - new Date(justOrder.created_at).getTime()) < 60000;
  let delivered = false;
  if (token && ev.replyToken) {
    if (orderStaged) { answer = await draftSummary(sb, justOrder.order_id); delivered = await replyOrder(sb, token, ev.replyToken, answer); }
    else if (justStaged) delivered = await replyWithConfirm(sb, token, ev.replyToken, answer);
    else delivered = await reply(sb, token, ev.replyToken, answer);
  }
  await logInbound(sb, me, ev, { text_content: text, intent: orderStaged ? "order_new" : "assistant", related_order_id: orderStaged ? justOrder.order_id : null });
  // 對話紀錄要標出「LINE 沒送到」，否則管理者查紀錄會以為已正常回覆（M13）
  if (convoId) await sb.from("eip_assistant_message").insert([
    { conversation_id: convoId, role: "user", content: text },
    { conversation_id: convoId, role: "assistant", content: delivered ? answer : "（LINE 回覆未送達）\n" + answer },
  ]);
}


async function handleEvent(sb: any, token: string | undefined, anthKey: string | undefined, ev: any) {
  const lineUserId = ev?.source?.userId;
  if (ev.type === "follow") {
    if (token && ev.replyToken) await reply(sb, token, ev.replyToken, "歡迎加入 EIP 通知！\n請到 EIP「個人設定 → 綁定 LINE」取得綁定碼，輸入到此聊天室即可完成綁定。綁定後就能在這裡直接問我：『我今天有什麼要做?』『今天行事曆?』『幫我建立任務：明天下午回覆客戶』，或用「下單，客戶、品項、數量、交期」直接建立訂單，也可以傳訂單照片或檔案。");
    return;
  }
  if (ev.type !== "message") return;
  const mtype = String(ev?.message?.type ?? "");

  const { data: me, error: meErr } = await sb.from("app_user")
    .select("id, name, tenant_id, role, department_id, line_user_id")
    .eq("line_user_id", lineUserId).maybeSingle();
  // 同一個 line_user_id 若意外掛在多人身上，maybeSingle 會報錯；此時不可退回「當綁定碼處理」（M14）
  if (meErr) {
    await logMiss(sb, "line_bind", `line_user_id 查詢失敗（可能重複綁定）：${meErr.message}`);
    if (token && ev.replyToken) await reply(sb, token, ev.replyToken, "帳號綁定狀態異常，請聯絡管理者處理。");
    return;
  }
  if (me) { await handleBound(sb, token, anthKey, ev, me as Me & { line_user_id?: string }); return; }
  if (mtype !== "text") {
    if (token && ev.replyToken) await reply(sb, token, ev.replyToken, "請先完成綁定：到 EIP「個人設定 → 綁定 LINE」取得綁定碼，輸入到此聊天室。");
    return;
  }
  const text = String(ev.message.text || "").trim();

  const code = text.toUpperCase();
  const { data: bc } = await sb.from("line_bind_code").select("id,user_id,expires_at,used_at").eq("code", code).maybeSingle();
  if (!bc) { if (token && ev.replyToken) await reply(sb, token, ev.replyToken, "找不到此綁定碼。請到 EIP「個人設定 → 綁定 LINE」重新產生，或先完成綁定後再向我提問。"); return; }
  if (bc.used_at || new Date(bc.expires_at).getTime() < Date.now()) { if (token && ev.replyToken) await reply(sb, token, ev.replyToken, "綁定碼已使用或已過期，請重新產生。"); return; }
  // 先解除這個 LINE 帳號在別人身上的綁定，避免一個 line_user_id 對到兩位員工（M14）
  await sb.from("app_user").update({ line_user_id: null })
    .eq("line_user_id", lineUserId).neq("id", bc.user_id);
  const { error: bindErr } = await sb.from("app_user").update({ line_user_id: lineUserId }).eq("id", bc.user_id);
  if (bindErr) {
    await logMiss(sb, "line_bind", `綁定寫入失敗：${bindErr.message}`);
    if (token && ev.replyToken) await reply(sb, token, ev.replyToken, "綁定失敗，請稍後再試或聯絡管理者。");
    return;
  }
  await sb.from("line_bind_code").update({ used_at: new Date().toISOString() }).eq("id", bc.id);
  if (token && ev.replyToken) await reply(sb, token, ev.replyToken, "✅ 綁定成功！之後重要提醒會推送到這裡。你也可以直接問我：『我今天有什麼要做?』『今天行事曆?』，或說『幫我建立任務：…』直接下任務到看板。");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const secret = Deno.env.get("LINE_CHANNEL_SECRET");
  const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
  const anthKey = Deno.env.get("ANTHROPIC_API_KEY");
  // H2：fail-closed。這支函式 verify_jwt=false 且用 service_role，
  // 缺少 secret 就等於公開後門，一律拒絕，不再放行。
  if (!secret) {
    console.error("LINE_CHANNEL_SECRET 未設定，拒絕所有請求");
    return new Response("misconfigured", { status: 500 });
  }
  const raw = await req.text();
  const sig = req.headers.get("x-line-signature") || "";
  if (!(await verifySignature(secret, raw, sig))) return new Response("bad signature", { status: 401 });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let payload: any = {};
  try { payload = JSON.parse(raw); } catch { payload = {}; }
  const events = payload.events || [];

  const work = (async () => {
    for (const ev of events) {
      try { await handleEvent(sb, token, anthKey, ev); }
      catch (e) {
        console.error("handleEvent error", e);
        await logMiss(sb, "line_webhook", `事件處理失敗（${ev?.type ?? "unknown"}）：${(e as Error).message}`);
      }
    }
  })();
  // @ts-ignore EdgeRuntime 為 Supabase Edge 提供
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work);
  else await work;

  return new Response("ok", { status: 200 });
});
