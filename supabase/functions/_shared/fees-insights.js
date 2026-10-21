// Fee insights: the instructions, the answer format and the number check.
// Shared by the ai-insights edge function (Deno) and the model comparison
// script (Node), so both test exactly the same thing. Plain JavaScript, no
// imports, so it runs in either.

export const FEES_SYSTEM = `You advise the owner of a private school in India on fee collection.

You get the school's fee figures for the current session as JSON. Find what most needs the owner's attention and what to do about it.

Rules:
- Use only the figures given. Every number you mention must appear in the data exactly. Don't work out new totals, differences or percentages.
- List each number you mention in "figures", with its exact value from the data (rupees as plain numbers, e.g. 125000).
- Give 3 to 6 insights, the most important first. Each says what is happening (with numbers), why it matters, and one concrete step the office can take this week.
- Be specific to this school. Skip generic advice the data doesn't call for.
- Things worth checking: classes collecting less than others; fees overdue a long time; the students owing most (call those families); overdue families whose parents don't have the app, so reminders don't reach them; how late payments usually come; months with low collection; cash against UPI and other methods; fee heads lagging (e.g. transport); concessions.
- To name students, use only "top_overdue", and put their "id" values in "students". Mention at most a few by name in the text.
- "open" picks the screen the owner should go to: "overdue" (the overdue list), "class" (one class; put its name exactly as in the data in "class_name"), "structure" (the fee structure), or "none". Leave "class_name" empty unless "open" is "class".
- "summary" is one sentence on how fee collection is going overall.
- Write plain, short English for a busy school owner. Write amounts the Indian way, e.g. ₹1,25,000 or ₹1.25 L.`;

export const INSIGHT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "insights"],
  properties: {
    summary: { type: "string" },
    insights: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail", "action", "priority", "figures", "students", "open", "class_name"],
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          action: { type: "string" },
          priority: { type: "string", enum: ["high", "medium", "low"] },
          figures: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "value"],
              properties: { label: { type: "string" }, value: { type: "number" } },
            },
          },
          students: { type: "array", items: { type: "string" } },
          open: { type: "string", enum: ["overdue", "class", "structure", "none"] },
          class_name: { type: "string" },
        },
      },
    },
  },
};

export const userMessage = (pack) => `Fee figures for this school (today is ${pack.today}):\n\n${JSON.stringify(pack)}`;

// Every number in the data
function numbersIn(value, out = []) {
  if (typeof value === "number") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => numbersIn(v, out));
  return out;
}

// Keeps the insights whose figures are all in the data (within rounding)
// and whose students are in top_overdue. Adds each named student's name
// and class, so the app can show them. Returns { summary, insights, dropped }.
export function checkInsights(result, pack) {
  const known = numbersIn(pack);
  const inData = (v) => known.some((k) => Math.abs(k - v) <= Math.max(1, Math.abs(k) * 0.005));
  const people = new Map((pack.top_overdue ?? []).map((p) => [p.id, p]));
  const insights = [];
  let dropped = 0;
  for (const it of result?.insights ?? []) {
    const figuresOk = (it.figures ?? []).every((f) => typeof f.value === "number" && inData(f.value));
    const studentsOk = (it.students ?? []).every((id) => people.has(id));
    if (!figuresOk || !studentsOk) {
      dropped++;
      continue;
    }
    insights.push({
      ...it,
      people: (it.students ?? []).map((id) => {
        const p = people.get(id);
        return { id, name: p.name, class: p.class, overdue: p.overdue };
      }),
    });
  }
  return { summary: String(result?.summary ?? ""), insights, dropped };
}
