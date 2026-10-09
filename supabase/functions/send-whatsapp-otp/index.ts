// Supabase Auth "Send SMS" hook: delivers phone sign-in codes over WhatsApp
// (Meta WhatsApp Cloud API) instead of SMS.
//
// Secrets (supabase secrets set …):
//   SEND_SMS_HOOK_SECRET   from Auth → Hooks → Send SMS (starts with v1,whsec_)
//   WHATSAPP_TOKEN         permanent System User token with whatsapp_business_messaging
//   WHATSAPP_PHONE_ID      the WhatsApp Business phone number ID
//   WHATSAPP_TEMPLATE      approved Authentication template name, e.g. godview_login
//   WHATSAPP_LANGUAGE      template language code (default "en")
//   WHATSAPP_API_VERSION   Graph API version (default "v23.0")
import { Webhook } from "npm:standardwebhooks@1.0.0";
import { createClient } from "npm:@supabase/supabase-js@2.117.1";
import { handleSendSms } from "./core.js";

const env = (k: string, fallback?: string) => Deno.env.get(k) ?? fallback ?? "";
const hook = new Webhook(env("SEND_SMS_HOOK_SECRET").replace("v1,whsec_", ""));
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const graph = `https://graph.facebook.com/${env("WHATSAPP_API_VERSION", "v23.0")}/${env("WHATSAPP_PHONE_ID")}/messages`;

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const payload = await req.text();
  let event: { user: { phone: string }; sms: { otp: string } };
  try {
    event = hook.verify(payload, Object.fromEntries(req.headers)) as typeof event;
  } catch {
    return reply(401, { error: { http_code: 401, message: "Invalid hook signature" } });
  }

  const result = await handleSendSms(
    { phone: event.user.phone, otp: event.sms.otp },
    {
      template: env("WHATSAPP_TEMPLATE"),
      language: env("WHATSAPP_LANGUAGE", "en"),
      isLinked: async (e164: string) => {
        const { count, error } = await admin
          .from("guardian_students")
          .select("guardian_id, guardians!inner(phone)", { count: "exact", head: true })
          .eq("guardians.phone", e164)
          .eq("removed", false);
        if (error) throw error;
        return (count ?? 0) > 0;
      },
      send: (message: unknown) =>
        fetch(graph, {
          method: "POST",
          headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" },
          body: JSON.stringify(message),
        }),
    }
  );
  return reply(result.status, result.body);
});
