// The assistant's voice (Premium): turns one reply into speech with
// Microsoft's Indian English voice "Neerja", in the mood of the reply
// (cheerful for good news, empathetic for worrying news or an apology).
// Returns an MP3. Lines already spoken ("Opening Fees.") come from a
// private storage cache, so they cost nothing the second time.
//
// Cost: Azure's free tier (F0) gives 0.5 million characters a month and
// then refuses instead of billing; the app then falls back to the
// device's own voice until the next check.
//
// Deploy with:
//   npx supabase functions deploy voice
// Needs the AZURE_SPEECH_KEY and AZURE_SPEECH_REGION secrets (the key and
// region of a Speech resource, e.g. "centralindia"). VOICE_NAME (optional)
// picks another Azure voice.

import { createClient } from "jsr:@supabase/supabase-js@2";

const KEY = Deno.env.get("AZURE_SPEECH_KEY") ?? "";
const REGION = Deno.env.get("AZURE_SPEECH_REGION") ?? "";
const VOICE = Deno.env.get("VOICE_NAME") || "en-IN-NeerjaNeural";
const BUCKET = "voice-cache";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const fail = (error: string, status: number) =>
  new Response(JSON.stringify({ error }), { status, headers: { ...cors, "Content-Type": "application/json" } });
const audio = (body: Blob | ArrayBuffer) => new Response(body, { headers: { ...cors, "Content-Type": "application/octet-stream" } });

// Mood from the app -> Azure speaking style and how strongly.
const STYLES: Record<string, [string, number]> = {
  pleased: ["cheerful", 0.8],
  concerned: ["empathetic", 1],
  sorry: ["empathetic", 1],
};

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function ssml(text: string, mood: string) {
  const style = STYLES[mood];
  const said = `<prosody rate="-4%">${xml(text)}</prosody>`;
  const inner = style ? `<mstts:express-as style="${style[0]}" styledegree="${style[1]}">${said}</mstts:express-as>` : said;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-IN"><voice name="${VOICE}">${inner}</voice></speak>`;
}

async function sha(s: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
}

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Runs after the reply has gone out, where the runtime allows it.
function later(p: Promise<unknown>) {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (rt) rt.waitUntil(p);
}

async function keep(path: string, mp3: ArrayBuffer) {
  const put = () => admin.storage.from(BUCKET).upload(path, mp3, { contentType: "audio/mpeg", upsert: true });
  let { error } = await put();
  if (error && /not found/i.test(error.message)) {
    await admin.storage.createBucket(BUCKET, { public: false });
    ({ error } = await put());
  }
  if (error) console.log(`cache: ${error.message}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("method", 405);
  if (!KEY || !REGION) return fail("voice_off", 501);

  const body = await req.json().catch(() => ({}));
  const { school_id } = body;
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 400) : "";
  const mood = typeof body.mood === "string" ? body.mood : "";
  if (typeof school_id !== "string" || !/^[0-9a-f-]{36}$/.test(school_id) || !text) return fail("bad_request", 400);

  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Same people as the assistant: owners, admins and the principal of a
  // Premium school. Checked while the cache is looked up.
  const allowed = (async () => {
    const { data: auth } = await user.auth.getUser();
    if (!auth?.user) return "signed_out";
    const { data: isAdmin } = await user.rpc("is_school_admin", { school: school_id });
    const { data: isPrincipal } = isAdmin ? { data: false } : await user.rpc("is_principal", { school: school_id });
    if (!isAdmin && !isPrincipal) return "not_allowed";
    const { data: school } = await user.from("schools").select("plan").eq("id", school_id).single();
    return school?.plan === "premium" ? "" : "premium";
  })();
  const path = `${await sha(`${VOICE}|${STYLES[mood]?.[0] ?? ""}|${text}`)}.mp3`;
  const [no, cached] = await Promise.all([allowed, admin.storage.from(BUCKET).download(path)]);
  if (no) return fail(no, no === "signed_out" ? 401 : 403);
  if (cached.data) return audio(cached.data);

  const res = await fetch(`https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": KEY,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "godview-voice",
    },
    body: ssml(text, mood),
  }).catch(() => null);
  if (!res?.ok) {
    // 429: the month's free characters are used up (or too many at once).
    console.log(`azure ${res?.status ?? "network"} ${res ? (await res.text()).slice(0, 200) : ""}`);
    return fail("voice_unavailable", 503);
  }
  const mp3 = await res.arrayBuffer();
  later(keep(path, mp3));
  return audio(mp3);
});
