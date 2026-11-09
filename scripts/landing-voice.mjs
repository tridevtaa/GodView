#!/usr/bin/env node
// Records Goddess's answers for the landing page's FAQ chips, in the same
// Google voice the assistant uses (supabase/functions/voice), so visitors
// hear her real voice without signing in.
//
//   node scripts/landing-voice.mjs
//
// Reads frontend/src/data/landing-faq.json and writes one MP3 per answer to
// frontend/public/landing/voice/, plus voice.json listing the text each file
// says. The page only plays a file whose text still matches the answer, so
// after editing an answer, run this again.
//
// Keys go in scripts/.env.local (git-ignored):
//   GOOGLE_TTS_KEY=...   (the same key as the voice function's secret)
//   VOICE_NAME=...       (optional; the voice function's VOICE_NAME if set)
//
// About 600 characters in all: well inside Google's free monthly allowance.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const OUT = path.join(root, "frontend/public/landing/voice");

const env = Object.fromEntries(
  (fs.existsSync(path.join(here, ".env.local")) ? fs.readFileSync(path.join(here, ".env.local"), "utf8") : "")
    .split("\n")
    .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map(([, k, v]) => [k, v.replace(/^["']|["']$/g, "")])
);
const KEY = process.env.GOOGLE_TTS_KEY || env.GOOGLE_TTS_KEY;
const VOICE = process.env.VOICE_NAME || env.VOICE_NAME || "en-GB-Chirp3-HD-Sulafat";
const LANG = VOICE.split("-").slice(0, 2).join("-");
if (!KEY) {
  console.error("Add GOOGLE_TTS_KEY=... to scripts/.env.local first.");
  process.exit(1);
}

const { faq } = JSON.parse(fs.readFileSync(path.join(root, "frontend/src/data/landing-faq.json"), "utf8"));
fs.mkdirSync(OUT, { recursive: true });
const said = {};

for (const { id, a } of faq) {
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text: a },
      voice: { languageCode: LANG, name: VOICE },
      audioConfig: { audioEncoding: "MP3", speakingRate: 1 },
    }),
  });
  if (!res.ok) {
    console.error(`${id}: Google said ${res.status} ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
  const { audioContent } = await res.json();
  const mp3 = Buffer.from(audioContent ?? "", "base64");
  fs.writeFileSync(path.join(OUT, `${id}.mp3`), mp3);
  said[id] = a;
  console.log(`${id}.mp3  ${Math.round(mp3.length / 1024)} KB`);
}

fs.writeFileSync(path.join(OUT, "voice.json"), `${JSON.stringify(said, null, 2)}\n`);
console.log(`Voice ${VOICE}. Written to frontend/public/landing/voice/`);
