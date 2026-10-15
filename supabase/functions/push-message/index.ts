// Notifications for a new message or notice: the app calls this right
// after sending one ({ message } or { notice }). message_push() or
// notice_push() in the database decides who hears about it (once, only
// while it is new), and each of their devices gets a push.
// The everyday ones ({ slot }: attendance reminders, morning to-do…) come
// from pg_cron; daily_push() decides those (see its migration).
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

  const { message, notice, slot } = await req.json().catch(() => ({}));
  const id = message ?? notice;
  const daily = typeof slot === "string" && /^[a-z-]{2,30}$/.test(slot);
  if (!daily && (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id))) return reply({ sent: 0 }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: rows, error } = daily
    ? await admin.rpc("daily_push", { p_slot: slot })
    : message
    ? await admin.rpc("message_push", { p_message: id })
    : await admin.rpc("notice_push", { p_notice: id });
  if (error) return reply({ sent: 0 }, 500);

  let sent = 0;
  const send = async (r: Record<string, string>) => {
    // Logged (push service, its answer, time taken) to tell our delays
    // from the push service's: Logs in the dashboard's function page.
    const host = new URL(r.sub_endpoint).host;
    const t0 = Date.now();
    try {
      const res = await webpush.sendNotification(
        { endpoint: r.sub_endpoint, keys: { p256dh: r.sub_p256dh, auth: r.sub_auth } },
        JSON.stringify({ title: r.title, body: r.body, url: r.url }),
        { TTL: 24 * 60 * 60, urgency: "high" }
      );
      console.log(`push ${host} ${res.statusCode} ${Date.now() - t0}ms`);
      sent++;
    } catch (e) {
      const { statusCode: status, body } = e as { statusCode?: number; body?: string };
      console.log(`push ${host} failed ${status ?? "?"} ${Date.now() - t0}ms ${String(body ?? e).slice(0, 200)}`);
      if (status === 404 || status === 410) await admin.rpc("forget_push_subscription", { p_endpoint: r.sub_endpoint });
    }
  };
  // A notice (or an everyday one) can go to a whole school: 50 devices at a time.
  const all = (rows ?? []) as Record<string, string>[];
  for (let i = 0; i < all.length; i += 50) await Promise.all(all.slice(i, i + 50).map(send));
  return reply({ sent });
});
