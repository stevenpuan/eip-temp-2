// line-push:內部推播函式。由 notification 觸發器透過 pg_net 呼叫;用 app_config.line_push_secret 驗身。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 內部驗身:x-push-key 要等於 app_config.line_push_secret
    const { data: cfg } = await sb.from("app_config").select("value").eq("key", "line_push_secret").maybeSingle();
    const expected = cfg?.value;
    if (!expected || req.headers.get("x-push-key") !== expected) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
    }

    const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
    if (!token) {
      return new Response(JSON.stringify({ skip: "LINE_CHANNEL_ACCESS_TOKEN 尚未設定" }), { status: 200, headers: { "content-type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const user_id = body.user_id as string | undefined;
    const message = body.message as string | undefined;
    if (!user_id || !message) return new Response(JSON.stringify({ error: "missing user_id or message" }), { status: 400, headers: { "content-type": "application/json" } });

    const { data: au } = await sb.from("app_user").select("line_user_id").eq("id", user_id).maybeSingle();
    if (!au?.line_user_id) {
      return new Response(JSON.stringify({ skip: "該使用者未綁定 LINE" }), { status: 200, headers: { "content-type": "application/json" } });
    }

    const r = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify({ to: au.line_user_id, messages: [{ type: "text", text: String(message).slice(0, 4900) }] }),
    });
    const txt = await r.text();
    return new Response(JSON.stringify({ line_status: r.status, line_body: txt }), { status: 200, headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { "content-type": "application/json" } });
  }
});
