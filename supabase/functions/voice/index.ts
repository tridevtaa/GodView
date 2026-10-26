// The assistant's voice (Premium): turns one reply into speech with a
// Google Chirp 3 HD Indian English voice and returns an MP3. The mood
// sets her pace a little (a touch brighter for good news, slower for
// worrying news or an apology); the voice itself follows the wording.
// Lines already spoken ("Opening Fees.") come from a private storage
// cache, so they cost nothing the second time.
//
// Cost: Google gives 1 million Chirp 3 HD characters free a month and
// bills after that, so this function counts what it sends and stops at
// VOICE_MONTHLY_CHARS (900,000 by default). The app then uses the
// device's own voice until the next month.
//
// Deploy with:
//   npx supabase functions deploy voice
// Needs the GOOGLE_TTS_KEY secret (an API key allowed to use the Cloud
// Text-to-Speech API). VOICE_NAME (optional) picks another voice.

import { createClient } from "jsr:@supabase/supabase-js@2";

const KEY = Deno.env.get("GOOGLE_TTS_KEY") ?? "";
const VOICE = Deno.env.get("VOICE_NAME") || "en-IN-Chirp3-HD-Sulafat";
const MONTHLY = Number(Deno.env.get("VOICE_MONTHLY_CHARS")) || 900_000;
const BUCKET = "voice-cache";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const fail = (error: string, status: number) =>
  new Response(JSON.stringify({ error }), { status, headers: { ...cors, "Content-Type": "application/json" } });
const audio = (body: Blob | Uint8Array) => new Response(body, { headers: { ...cors, "Content-Type": "application/octet-stream" } });

// Mood from the app -> speaking rate.
const PACE: Record<string, number> = { pleased: 1.03, concerned: 0.94, sorry: 0.94 };

async function sha(s: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
}

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const store = () => admin.storage.from(BUCKET);

// Runs after the reply has gone out, where the runtime allows it.
function later(p: Promise<unknown>) {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (rt) rt.waitUntil(p);
}

async function save(path: string, body: Uint8Array | string, contentType: string) {
  const put = () => store().upload(path, body, { contentType, upsert: true });
  let { error } = await put();
  if (error && /not found/i.test(error.message)) {
    await admin.storage.createBucket(BUCKET, { public: false });
    ({ error } = await put());
  }
  if (error) console.log(`save ${path}: ${error.message}`);
}

// Characters sent this month (Asia/Kolkata), kept beside the cache.
// Two replies at the same moment can both count from the same number;
// the cap sits well under the free million to allow for that.
const monthPath = () => `usage/${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7)}.json`;
async function usedThisMonth() {
  const { data } = await store().download(monthPath());
  if (!data) return 0;
  try {
    return Number(JSON.parse(await data.text()).chars) || 0;
  } catch {
    return 0;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("method", 405);
  if (!KEY) return fail("voice_off", 501);

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
  const rate = PACE[mood] ?? 1;
  const path = `lines/${await sha(`${VOICE}|${rate}|${text}`)}.mp3`;
  const [no, cached, used] = await Promise.all([allowed, store().download(path), usedThisMonth()]);
  if (no) return fail(no, no === "signed_out" ? 401 : 403);
  if (cached.data) return audio(cached.data);
  if (used + text.length > MONTHLY) return fail("voice_unavailable", 503);

  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: "en-IN", name: VOICE },
      audioConfig: { audioEncoding: "MP3", speakingRate: rate },
    }),
  }).catch(() => null);
  if (!res?.ok) {
    console.log(`google ${res?.status ?? "network"} ${res ? (await res.text()).slice(0, 300) : ""}`);
    return fail("voice_unavailable", 503);
  }
  const { audioContent } = await res.json();
  const mp3 = Uint8Array.from(atob(audioContent ?? ""), (c) => c.charCodeAt(0));
  if (!mp3.length) return fail("voice_unavailable", 503);
  later(Promise.all([save(path, mp3, "audio/mpeg"), save(monthPath(), JSON.stringify({ chars: used + text.length }), "application/json")]));
  return audio(mp3);
});
