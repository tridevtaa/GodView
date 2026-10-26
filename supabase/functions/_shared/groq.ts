// Groq (free plan) as the first try for the AI features; Claude answers
// whenever this returns null: no GROQ_API_KEY, over Groq's per-minute or
// daily limit, too slow, cut short, or not valid JSON for the schema.
//
// Model: GROQ_MODEL, GPT-OSS 120B by default (Groq retired its Llama models
// on 16 Aug 2026). Its free plan is about 30 requests and 8,000 tokens a
// minute and 200,000 tokens a day for the whole account. After a limit is
// hit, Groq is skipped for the time it asks (Retry-After), so the backup
// answers at once instead of after another refusal.
//
// The figures sent include student names: turn on Zero Data Retention at
// console.groq.com/settings/data-controls.

const KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const MODEL = Deno.env.get("GROQ_MODEL") || "openai/gpt-oss-120b";
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
// Tokens a minute on the plan (8,000 free). A request counts its question
// plus the longest answer it allows, so the answer allowance shrinks to fit.
const PER_MINUTE = Number(Deno.env.get("GROQ_TOKENS_PER_MINUTE")) || 8000;

let skipUntil = 0;

type Msg = { role: "user" | "assistant"; content: string };

export type GroqAnswer = { json: unknown; model: string; inputTokens: number | null; outputTokens: number | null };

export async function groqJson(opts: {
  system: string;
  messages: Msg[];
  schema: Record<string, unknown>;
  name: string;
  maxTokens: number;
  minTokens?: number;
  timeoutMs: number;
  effort?: "low" | "medium" | "high";
}): Promise<GroqAnswer | null> {
  if (!KEY || Date.now() < skipUntil) return null;
  // About 3.5 characters a token for this mix of English and JSON.
  const asked = Math.ceil((opts.system.length + opts.messages.reduce((t, m) => t + m.content.length, 0)) / 3.5) + 100;
  const room = Math.min(opts.maxTokens, PER_MINUTE - asked - 200);
  if (room < (opts.minTokens ?? 1000)) {
    console.log(`groq skipped: question ~${asked} tokens leaves ${room} for the answer`);
    return null;
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: ctl.signal,
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: opts.system }, ...opts.messages],
        response_format: { type: "json_schema", json_schema: { name: opts.name, strict: true, schema: opts.schema } },
        reasoning_effort: opts.effort ?? "low",
        include_reasoning: false,
        max_completion_tokens: room,
      }),
    });
    if (!res.ok) {
      // 429: over a limit. 413: one request bigger than the per-minute allowance.
      if (res.status === 429 || res.status === 413) {
        const wait = Number(res.headers.get("retry-after"));
        skipUntil = Date.now() + (Number.isFinite(wait) && wait > 0 ? Math.min(wait, 3600) : 60) * 1000;
      }
      console.log(`groq ${res.status} ${(await res.text()).slice(0, 300)}`);
      return null;
    }
    const body = await res.json();
    const choice = body.choices?.[0];
    if (choice?.finish_reason !== "stop") {
      console.log(`groq stopped: ${choice?.finish_reason}`);
      return null;
    }
    return {
      json: JSON.parse(choice.message?.content ?? ""),
      model: `${body.model ?? MODEL} (groq)`,
      inputTokens: body.usage?.prompt_tokens ?? null,
      outputTokens: body.usage?.completion_tokens ?? null,
    };
  } catch (err) {
    console.log(`groq ${err instanceof Error ? err.name : ""} ${String(err).slice(0, 200)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
