// The assistant (Premium): "Ask GodView". The app sends what was said or
// typed, the last few turns, the pages and forms this person can open,
// and a few figures it already shows them (students, dues, today's
// attendance). Claude answers in one or two spoken sentences and may pick
// one thing to do: open a page, a student (by name; the app finds them),
// a form, the bus map, or a report card shown beside the answer. It also
// picks a mood for the reply, which picks her expression. The app checks
// that choice again before acting.
// Owners, admins and the principal of a Premium school.
//
// Deploy with:
//   npx supabase functions deploy concierge
// Needs the ANTHROPIC_API_KEY secret. CONCIERGE_MODEL (optional secret)
// picks the model; Claude Opus 5.5 by default.

import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";

const MODEL = Deno.env.get("CONCIERGE_MODEL") || "claude-opus-5-5";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

// What each page is for, so Claude can pick the right one.
const PAGES: Record<string, string> = {
  home: "the overview: today's numbers, noticeboard and calendar",
  students: "the student list and each student's profile",
  homework: "homework given to classes",
  fees: "fee collection, dues and defaulters",
  marks: "entering exam results",
  requests: "Inbox: messages and requests from parents",
  employees: "staff list and app access",
  transport: "bus routes, stops and buses",
  calendar: "the school calendar, holidays and the exam datesheet",
  attendance: "the attendance register for today",
  notices: "the noticeboard",
  me: "my own profile",
};

const SYSTEM = `You are the GodView assistant, a calm, warm voice inside a school management app used in India. You speak to school owners, admins and principals.

Your reply is read aloud, so:
- One or two short sentences, at most 30 words. Plain words, no lists, no markdown, no emoji, no dashes used as punctuation.
- Money in rupees, written like "₹4.2 lakh" or "₹12,500".

You can do one thing per reply, chosen in "action":
- "go": open a page. target is a page key from the user's list.
- "student": open a student's profile. target is the student's name as the user said it.
- "start": open a form. target is a form key from the user's list.
- "map": open the full bus map. target is "".
- "card": show a report card right here, beside your answer, without leaving. target is a card key from the user's list.
- "none": just answer. target is "".

When they ask how something is going (fees, attendance) and there is a card for it, show the card and give the headline in your reply. Open the page instead when they want to work on it (mark attendance, collect a fee, see every defaulter).

Pick a "mood" for how your reply is said: "pleased" for good news or thanks, "concerned" for worrying figures (low attendance, large dues, classes still not marked late in the day), "sorry" when you can't help or can't find something, otherwise "neutral".

Only use page and form keys from the lists you are given. When you open something, say so in a few words ("Opening Fees for you."). Only quote numbers that appear in the figures you are given; if the answer needs data you don't have, open the page where it lives and say so. If you can't help, say what you can do instead. Never claim to have changed or saved anything: forms open for the user to fill in.`;

const SCHEMA = {
  type: "object",
  properties: {
    say: { type: "string" },
    mood: { type: "string", enum: ["neutral", "pleased", "concerned", "sorry"] },
    action: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["none", "go", "student", "start", "map", "card"] },
        target: { type: "string" },
      },
      required: ["type", "target"],
      additionalProperties: false,
    },
  },
  required: ["say", "mood", "action"],
  additionalProperties: false,
};

const list = (v: unknown) => (Array.isArray(v) ? v : []).filter((x) => Array.isArray(x) && typeof x[0] === "string" && typeof x[1] === "string").slice(0, 20) as [string, string][];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "method" }, 405);

  const body = await req.json().catch(() => ({}));
  const { school_id, message, history = [], page = "home", facts = {}, name = "" } = body;
  if (typeof school_id !== "string" || !/^[0-9a-f-]{36}$/.test(school_id) || typeof message !== "string" || !message.trim() || message.length > 500) {
    return reply({ error: "bad_request" }, 400);
  }
  const pages = list(body.pages).filter(([k]) => Object.hasOwn(PAGES, k));
  const forms = list(body.forms);
  const cards = list(body.cards);
  const card = typeof body.card === "string" ? body.card.slice(0, 20) : "";

  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth } = await user.auth.getUser();
  if (!auth?.user) return reply({ error: "signed_out" }, 401);
  const { data: isAdmin } = await user.rpc("is_school_admin", { school: school_id });
  const { data: isPrincipal } = isAdmin ? { data: false } : await user.rpc("is_principal", { school: school_id });
  if (!isAdmin && !isPrincipal) return reply({ error: "not_allowed" }, 403);
  const { data: school } = await user.from("schools").select("name, plan").eq("id", school_id).single();
  if (school?.plan !== "premium") return reply({ error: "premium" }, 403);

  const context = [
    `School: ${school.name}. Speaking with: ${String(name).slice(0, 60) || "a school lead"}. They are on the "${String(page).slice(0, 20)}" page.`,
    `Pages they can open:\n${pages.map(([k, l]) => `- ${k} (${l}): ${PAGES[k]}`).join("\n")}`,
    `Forms they can open:\n${forms.map(([k, l]) => `- ${k}: ${l}`).join("\n") || "- none"}`,
    `Cards you can show:\n${cards.map(([k, l]) => `- ${k}: ${l}`).join("\n") || "- none"}${card ? `\nOn screen now: the ${card} card.` : ""}`,
    `Figures (now, ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}):\n${JSON.stringify(facts).slice(0, 3000)}`,
  ].join("\n\n");

  // Earlier turns as plain text; the last user turn carries the context.
  const turns: Anthropic.MessageParam[] = [];
  for (const t of (Array.isArray(history) ? history : []).slice(-8)) {
    const role = t?.role === "assistant" ? "assistant" : "user";
    const text = typeof t?.text === "string" ? t.text.slice(0, 500) : "";
    if (!text || (!turns.length && role === "assistant")) continue;
    if (turns.at(-1)?.role === role) continue;
    turns.push({ role, content: text });
  }
  if (turns.at(-1)?.role === "user") turns.pop();
  turns.push({ role: "user", content: `${context}\n\nThey said: ${message.trim()}` });

  let response;
  try {
    // Server-side fallback: if the model declines, Anthropic retries on
    // another model in the same call. Cast: the SDK's types may not list
    // the "default" form yet.
    response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: turns,
    } as unknown as Parameters<typeof anthropic.beta.messages.create>[0]);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return reply({ error: "busy" }, 503);
    console.log(`claude ${err instanceof Anthropic.APIError ? err.status : ""} ${String(err instanceof Error ? err.message : err).slice(0, 300)}`);
    return reply({ error: "ai_failed" }, 502);
  }

  const msg = response as unknown as Anthropic.Message;
  if (msg.stop_reason === "refusal" || msg.stop_reason === "max_tokens") {
    console.log(`claude stopped: ${msg.stop_reason}`);
    return reply({ error: "ai_failed" }, 502);
  }
  const text = msg.content.find((b) => b.type === "text");
  let out;
  try {
    out = JSON.parse(text && text.type === "text" ? text.text : "");
  } catch {
    return reply({ error: "ai_failed" }, 502);
  }

  // Only what this person can open; anything else becomes a plain answer.
  const say = String(out?.say ?? "").replaceAll("\u2014", ", ").slice(0, 400);
  let action = { type: String(out?.action?.type ?? "none"), target: String(out?.action?.target ?? "").slice(0, 80) };
  const ok =
    (action.type === "go" && pages.some(([k]) => k === action.target)) ||
    (action.type === "start" && forms.some(([k]) => k === action.target)) ||
    (action.type === "student" && action.target.trim()) ||
    (action.type === "map" && pages.some(([k]) => k === "transport")) ||
    (action.type === "card" && cards.some(([k]) => k === action.target));
  if (!ok) action = { type: "none", target: "" };

  const mood = ["pleased", "concerned", "sorry"].includes(out?.mood) ? out.mood : "neutral";

  return reply({ say, mood, action });
});
