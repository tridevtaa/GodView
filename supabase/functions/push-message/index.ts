// Notifications for a new message: the app calls this right after sending
// one. message_push() in the database decides who hears about it (once per
// message, only while it is new), and each of their devices gets a push.
// Devices the push service says are gone are forgotten. Deploy with:
//   npx supabase functions deploy push-message
// Needs the VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY secrets (the public key
// is also in frontend/src/pwa/push.js). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

webpush.setVapidDetails("https://godview.in", Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ sent: 0 }, 405);

  const { message } = await req.json().catch(() => ({}));
  if (typeof message !== "string" || !/^[0-9a-f-]{36}$/.test(message)) return reply({ sent: 0 }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: rows, error } = await admin.rpc("message_push", { p_message: message });
  if (error) return reply({ sent: 0 }, 500);

  let sent = 0;
  await Promise.all(
    (rows ?? []).map(async (r: Record<string, string>) => {
      try {
        await webpush.sendNotification(
          { endpoint: r.sub_endpoint, keys: { p256dh: r.sub_p256dh, auth: r.sub_auth } },
          JSON.stringify({ title: r.title, body: r.body, url: r.url }),
          { TTL: 24 * 60 * 60, urgency: "high" }
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await admin.rpc("forget_push_subscription", { p_endpoint: r.sub_endpoint });
      }
    })
  );
  return reply({ sent });
});
