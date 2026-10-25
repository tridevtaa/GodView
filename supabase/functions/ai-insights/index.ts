// AI insights (Premium). The app sends { school_id, section } where
// section is "fees", "transport" or "results". Owners and admins of a
// Premium school (and the principal, for results), up to MONTHLY_LIMIT
// times a month for each section. The figures come from that section's
// database function (as the signed-in user, so the database checks
// they're allowed); see _shared/insights.js. The AI's answer is checked:
// an insight quoting a number that isn't in the data is dropped. Each
// result is saved in ai_insights, which the app reads to show the latest.
//
// Insights renew by themselves, at most once a day: if this section was
// analysed in the last FRESH_HOURS, that result comes back and nothing
// runs (so many people opening the page cost one run a day). There is no
// way to force a new one.
// { pack_only: true } returns the figures instead (Premium owners and
// admins only), for the model comparison script.
//
// Deploy with:
//   npx supabase functions deploy ai-insights
// Needs the ANTHROPIC_API_KEY secret. AI_MODEL (optional secret) picks
// the model; Claude Sonnet 5.5 by default. SUPABASE_URL, SUPABASE_ANON_KEY
// and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { SECTIONS, checkInsights, schemaFor, userMessage } from "../_shared/insights.js";

const MONTHLY_LIMIT = 60; // a month for each section: a daily refresh plus some by hand
const FRESH_HOURS = 20;
const MODEL = Deno.env.get("AI_MODEL") || "claude-sonnet-5-5";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "method" }, 405);

  const { school_id, section = "fees", pack_only = false } = await req.json().catch(() => ({}));
  if (typeof school_id !== "string" || !/^[0-9a-f-]{36}$/.test(school_id) || !Object.hasOwn(SECTIONS, section)) {
    return reply({ error: "bad_request" }, 400);
  }

  // As the signed-in user: the database decides what they may see
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: auth } = await user.auth.getUser();
  if (!auth?.user) return reply({ error: "signed_out" }, 401);
  const { data: isAdmin } = await user.rpc("is_school_admin", { school: school_id });
  const { data: isPrincipal } = section === "results" ? await user.rpc("is_principal", { school: school_id }) : { data: false };
  if (!isAdmin && !isPrincipal) return reply({ error: "not_allowed" }, 403);
  // As the user: the service role has no grant on schools in this project
  const { data: school } = await user.from("schools").select("plan").eq("id", school_id).single();
  if (school?.plan !== "premium") return reply({ error: "premium" }, 403);

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { count } = await admin
    .from("ai_insights")
    .select("id", { count: "exact", head: true })
    .eq("school_id", school_id)
    .eq("section", section)
    .gte("created_at", monthStart.toISOString());
  const used = count ?? 0;
  if (!pack_only) {
    const { data: latest } = await admin
      .from("ai_insights")
      .select("*")
      .eq("school_id", school_id)
      .eq("section", section)
      .order("created_at", { ascending: false })
      .limit(1);
    const last = latest?.[0];
    const fresh = last && Date.now() - new Date(last.created_at).getTime() < FRESH_HOURS * 36e5;
    if (fresh || (last && used >= MONTHLY_LIMIT)) return reply({ insight: last, used, fresh: true });
  }
  if (!pack_only && used >= MONTHLY_LIMIT) return reply({ error: "limit", limit: MONTHLY_LIMIT }, 429);

  const { data: pack, error: packError } = await user.rpc(SECTIONS[section].pack, { p_school: school_id });
  if (packError || !pack || pack.error) return reply({ error: "no_data" }, 500);
  if (pack_only) return reply({ pack });

  let response;
  try {
    // Server-side fallback: if the model declines, Anthropic retries on
    // another model in the same call. Cast: the SDK's types may not list
    // the "default" form yet.
    response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SECTIONS[section].system,
      output_config: { format: { type: "json_schema", schema: schemaFor(section) } },
      messages: [{ role: "user", content: userMessage(section, pack) }],
    } as unknown as Parameters<typeof anthropic.beta.messages.create>[0]);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return reply({ error: "busy" }, 503);
    if (err instanceof Anthropic.APIError) {
      console.log(`claude ${err.status} ${String(err.message).slice(0, 300)}`);
      return reply({ error: "ai_failed" }, 502);
    }
    console.log(`claude ${String(err).slice(0, 300)}`);
    return reply({ error: "ai_failed" }, 502);
  }

  const message = response as unknown as Anthropic.Message;
  if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens") {
    console.log(`claude stopped: ${message.stop_reason}`);
    return reply({ error: "ai_failed" }, 502);
  }
  const text = message.content.find((b) => b.type === "text");
  let parsed;
  try {
    parsed = JSON.parse(text && text.type === "text" ? text.text : "");
  } catch {
    return reply({ error: "ai_failed" }, 502);
  }

  const result = checkInsights(section, parsed, pack);
  const { data: saved, error: saveError } = await admin
    .from("ai_insights")
    .insert({
      school_id,
      section,
      model: message.model ?? MODEL,
      result: { insights: result.insights, hints: result.hints },
      dropped: result.dropped,
      input_tokens: message.usage?.input_tokens ?? null,
      output_tokens: message.usage?.output_tokens ?? null,
      created_by: auth.user.email ?? null,
    })
    .select()
    .single();
  if (saveError) console.log(`save ${saveError.message}`);

  return reply({ insight: saved ?? { result, created_at: new Date().toISOString() }, used: used + 1 });
});
