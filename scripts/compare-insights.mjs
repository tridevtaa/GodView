#!/usr/bin/env node
// Compares AI models on the real Fee insights task, side by side. Same
// instructions, answer format and number check as the live feature
// (supabase/functions/_shared/fees-insights.js). Writes nothing to the
// database.
//
//   cd scripts && npm install          (once)
//   node scripts/compare-insights.mjs --school <school id>
//   node scripts/compare-insights.mjs --pack scripts/out/fees-pack.local.json
//
// Keys go in scripts/.env.local (git-ignored), one per line:
//   SUPABASE_SECRET_KEY=...   (only for --school: reads the fee figures)
//   ANTHROPIC_API_KEY=...
//   OPENROUTER_API_KEY=...    (GPT, Gemini, Mistral, Kimi, DeepSeek)
//
// The figures include student names. OpenRouter calls ask for providers
// that don't keep or train on data (zero data retention); a model with no
// such provider shows an error instead of running.
// Result: scripts/out/insights-compare.local.html (git-ignored).

import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FEES_SYSTEM, INSIGHT_SCHEMA, checkInsights, userMessage } from "../supabase/functions/_shared/fees-insights.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "out");
const SUPABASE_URL = "https://zvnsbuviuogrnquwkbsa.supabase.co";

// Models to compare. OpenRouter ones are matched against its live model
// list: every term must be in the id, none of "not". Edit freely.
const CANDIDATES = [
  { label: "Claude Sonnet 5.5", via: "anthropic", model: "claude-sonnet-5-5", price: [2, 10] },
  { label: "GPT-6.1 Sol", via: "openrouter", terms: ["openai/gpt-6.1-sol"], not: ["pro"] },
  { label: "Gemini 3.8 Flash", via: "openrouter", terms: ["google/gemini-3.8-flash"], not: ["lite", ":batch"] },
  { label: "Mistral Large 4", via: "openrouter", terms: ["mistralai/mistral-large-4"] },
  { label: "Kimi K3", via: "openrouter", terms: ["moonshotai/kimi-k3"], not: [":batch"] },
  { label: "DeepSeek V4 Pro", via: "openrouter", terms: ["deepseek/deepseek-v4-pro"] },
];

// ------------------------------------------------------------------ keys ---

const envFile = path.join(here, ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
};

// ----------------------------------------------------------------- figures ---

async function loadPack() {
  const file = arg("--pack");
  if (file) return JSON.parse(fs.readFileSync(file, "utf8"));
  const school = arg("--school");
  if (!school) throw new Error("Usage: node scripts/compare-insights.mjs --school <school id>  (or --pack <file>)");
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("Add SUPABASE_SECRET_KEY to scripts/.env.local (Project Settings → API Keys → secret).");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ai_fees_pack`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_school: school }),
  });
  if (!res.ok) throw new Error(`Couldn't read the fee figures (${res.status}): ${await res.text()}`);
  const pack = await res.json();
  if (pack?.error) throw new Error(`No figures: ${pack.error}`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "fees-pack.local.json"), JSON.stringify(pack, null, 2));
  return pack;
}

// ------------------------------------------------------------------ models ---

async function resolveOpenRouter() {
  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) throw new Error(`OpenRouter model list: ${res.status}`);
  const { data } = await res.json();
  const ids = data.map((m) => ({ id: m.id, pricing: m.pricing }));
  return (c) => {
    const hits = ids
      .filter((m) => c.terms.every((t) => m.id.includes(t)) && !(c.not ?? []).some((t) => m.id.includes(t)))
      // Never a free variant: free tiers may keep or train on what you send
      .filter((m) => !m.id.includes(":free"))
      .sort((a, b) => a.id.length - b.id.length);
    return hits[0] ?? null;
  };
}

const stripFence = (t) => t.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

async function runAnthropic(c, pack) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("No ANTHROPIC_API_KEY in scripts/.env.local");
  const client = new Anthropic();
  const message = await client.beta.messages.create({
    model: c.model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: FEES_SYSTEM,
    output_config: { format: { type: "json_schema", schema: INSIGHT_SCHEMA } },
    messages: [{ role: "user", content: userMessage(pack) }],
  });
  if (message.stop_reason === "refusal" || message.stop_reason === "max_tokens") throw new Error(`Stopped: ${message.stop_reason}`);
  const text = message.content.find((b) => b.type === "text")?.text ?? "";
  const { input_tokens: inT = 0, output_tokens: outT = 0 } = message.usage ?? {};
  return { id: message.model, json: JSON.parse(text), inT, outT, cost: (inT * c.price[0] + outT * c.price[1]) / 1e6 };
}

async function runOpenRouter(c, pack, model) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("No OPENROUTER_API_KEY in scripts/.env.local");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json", "X-Title": "GodView insights comparison" },
    body: JSON.stringify({
      model: model.id,
      max_tokens: 16000,
      messages: [
        { role: "system", content: FEES_SYSTEM },
        { role: "user", content: userMessage(pack) },
      ],
      response_format: { type: "json_schema", json_schema: { name: "fee_insights", strict: true, schema: INSIGHT_SCHEMA } },
      // Student names are in the figures: only hosts that keep nothing
      provider: { data_collection: "deny", zdr: true, require_parameters: true },
      usage: { include: true },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  const text = body.choices?.[0]?.message?.content ?? "";
  const inT = body.usage?.prompt_tokens ?? 0;
  const outT = body.usage?.completion_tokens ?? 0;
  const cost = body.usage?.cost ?? (inT * Number(model.pricing?.prompt ?? 0) + outT * Number(model.pricing?.completion ?? 0));
  return { id: `${model.id}${body.provider ? ` via ${body.provider}` : ""}`, json: JSON.parse(stripFence(text)), inT, outT, cost };
}

// ------------------------------------------------------------------ report ---

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

function html(pack, results) {
  const col = (r) => {
    if (r.error) return `<section class="col"><h2>${esc(r.label)}</h2><p class="err">${esc(r.error)}</p></section>`;
    const cards = r.checked.insights
      .map(
        (it) => `<li class="${esc(it.priority)}"><b>${esc(it.title)}</b><p>${esc(it.detail)}</p><p class="act">→ ${esc(it.action)}</p>${
          it.people.length ? `<p class="who">${it.people.map((p) => esc(`${p.name} (${p.class})`)).join(", ")}</p>` : ""
        }</li>`
      )
      .join("");
    return `<section class="col"><h2>${esc(r.label)}</h2>
      <p class="meta">${esc(r.id)}<br>${r.seconds}s · ${r.inT.toLocaleString()} in / ${r.outT.toLocaleString()} out · $${r.cost.toFixed(4)} (₹${(r.cost * 84).toFixed(2)})<br>
      ${r.checked.insights.length} kept · <span class="${r.checked.dropped ? "bad" : ""}">${r.checked.dropped} dropped for wrong numbers</span></p>
      <p class="sum">${esc(r.checked.summary)}</p><ol>${cards}</ol>
      <p class="score">Your score: correct numbers __/5 · specific advice __/5 · would act on it __/5</p></section>`;
  };
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fee insights comparison</title>
<style>
body{font:14px/1.45 system-ui,sans-serif;margin:0;padding:24px;background:#f6f6f9;color:#1a1a2e}
h1{margin:0 0 4px;font-size:22px}.top{color:#555;margin:0 0 20px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px;align-items:start}
.col{background:#fff;border-radius:16px;padding:18px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
h2{margin:0 0 6px;font-size:17px}.meta{color:#666;font-size:12px;margin:0 0 10px}.bad{color:#c2412d;font-weight:700}
.sum{font-weight:600}ol{padding:0;margin:0;list-style:none;display:grid;gap:10px}
li{border:1px solid #e4e4e8;border-left:4px solid #999;border-radius:12px;padding:10px 12px}
li.high{border-left-color:#c2412d}li.medium{border-left-color:#a8670a}li.low{border-left-color:#5b68c4}
li p{margin:4px 0}.act{font-weight:600}.who{color:#555;font-size:12.5px}.err{color:#c2412d}
.score{margin-top:12px;padding:8px 10px;background:#f3f4fa;border-radius:10px;font-size:12.5px}
</style></head><body>
<h1>Fee insights: model comparison</h1>
<p class="top">${esc(pack.session)} · ${pack.students} students · figures as of ${esc(pack.today)} · same instructions for every model. Dropped = an insight quoted a number that isn’t in the data.</p>
<div class="grid">${results.map(col).join("")}</div></body></html>`;
}

// -------------------------------------------------------------------- run ---

const pack = await loadPack();
console.log(`Figures: ${pack.session}, ${pack.students} students, ${(pack.top_overdue ?? []).length} top overdue.`);

let pick = null;
if (CANDIDATES.some((c) => c.via === "openrouter")) {
  pick = await resolveOpenRouter().catch((e) => {
    console.log(`OpenRouter model list failed: ${e.message}`);
    return null;
  });
}

const results = await Promise.all(
  CANDIDATES.map(async (c) => {
    const t0 = Date.now();
    try {
      let out;
      if (c.via === "anthropic") out = await runAnthropic(c, pack);
      else {
        const model = pick?.(c);
        if (!model) throw new Error(`Not found on OpenRouter (looked for ${c.terms.join(" + ")})`);
        out = await runOpenRouter(c, pack, model);
      }
      const seconds = ((Date.now() - t0) / 1000).toFixed(0);
      const checked = checkInsights(out.json, pack);
      console.log(`✓ ${c.label}: ${checked.insights.length} kept, ${checked.dropped} dropped, ${seconds}s, $${out.cost.toFixed(4)}`);
      return { label: c.label, ...out, seconds, checked };
    } catch (e) {
      console.log(`✗ ${c.label}: ${e.message}`);
      return { label: c.label, error: e.message };
    }
  })
);

fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, "insights-compare.local.html");
fs.writeFileSync(file, html(pack, results));
console.log(`\nOpen: ${file}`);
