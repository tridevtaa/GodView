// AI insights: for each section (fees, transport, results), the database
// function with its figures, the instructions, the answer format and the
// number check. Shared by the ai-insights edge function (Deno) and the
// model comparison script (Node), so both test exactly the same thing.
// Plain JavaScript, no imports, so it runs in either.

const COMMON = `Rules:
- Use only the figures given. Every number you mention must appear in the data exactly. Don't work out new totals, differences or percentages.
- List each number you mention in "figures", with its exact value from the data.
- Give 3 to 6 insights, the most important first. Each says what is happening (with numbers), why it matters, and one concrete step the school can take this week.
- Be specific to this school. Skip generic advice the data doesn't call for.
- "summary" is one sentence on how things stand overall.
- Write plain, short English for a busy school owner in India.
- Also write "hints": short lines (under 90 characters) shown in the app next to the figure they explain. One hint per spot at most, only where you have something useful to say. Each hint's numbers go in its "figures" too, under the same rule. A hint adds what the spot's own figure doesn't say (which class, how old, what to do); never restate that figure, or give a different total for the same thing.`;

const inr = (n) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");

export const SECTIONS = {
  fees: {
    pack: "ai_fees_pack",
    title: "Fee insights",
    open: ["overdue", "class", "structure", "none"],
    slots: ["collected", "due_now", "due_later", "owing", "home"],
    targets: () => null,
    people: (pack) => pack.top_overdue ?? [],
    line: (p) => `${p.class} · ${inr(p.overdue)}`,
    system: `You advise the owner of a private school in India on fee collection.

You get the school's fee figures for the current session as JSON. Find what most needs the owner's attention and what to do about it.

${COMMON}
- Rupees go in "figures" as plain numbers, e.g. 125000. In the text, write amounts the Indian way, e.g. ₹1,25,000 or ₹1.25 L.
- Things worth checking: classes collecting less than others; fees overdue a long time; the students owing most (call those families); overdue families whose parents don't have the app, so reminders don't reach them; how late payments usually come; months with low collection; cash against UPI and other methods; fee heads lagging (e.g. transport); concessions.
- To name students, use only "top_overdue", and put their "id" values in "students". Mention at most a few by name in the text.
- "open" picks the screen to go to: "overdue" (the overdue list), "class" (one class; put its name exactly as in the data in "class_name"), "structure" (the fee structure), or "none". Leave "class_name" empty unless "open" is "class".
- Hint spots ("slot"; leave "target" empty): "collected" (under the amount collected so far), "due_now" (under the amount due now, e.g. which class owes most), "due_later" (under the amount due later), "owing" (above the list of students who owe), "home" (on the owner's home screen, the one line that matters most today).`,
  },
  transport: {
    pack: "ai_transport_pack",
    title: "Transport insights",
    open: ["routes", "buses", "map", "none"],
    slots: ["routes", "on_bus", "homes", "buses", "route", "bus"],
    targets: (pack, slot) =>
      slot === "route" ? (pack.routes ?? []).map((r) => r.route) : slot === "bus" ? (pack.buses ?? []).map((b) => b.bus) : null,
    people: () => [],
    line: () => "",
    system: `You advise the owner of a private school in India on its school buses and routes.

You get the school's transport figures as JSON: villages and towns where students live (how many, how many take the bus, distance from school, which routes have a stop there), each route (its bus, seats, riders, stops in order with pickup times and distance), and each bus (seats, status, papers running out, safety kit missing). Find what most needs attention and what to do about it.

${COMMON}
- Things worth checking: villages with many students but no stop on any route (a new stop or a new route; nearby villages that one route could cover together); villages where few students take the bus (a chance to offer transport); routes with more riders than seats, or very few riders (merge or reroute); routes with no bus, or a bus in repair; papers that ran out or run out soon (negative days_left means it already ran out); missing driver, conductor or safety kit; pickup times out of order; students on the bus without a stop; students whose village isn't known.
- Kilometres are straight-line distance from the school, not road distance; say "about".
- Leave "students" empty. "open" picks the screen to go to: "routes" (bus routes and stops), "buses" (the bus list), "map" (the map of where students live), or "none". Leave "class_name" empty.
- Hint spots: "routes" (under the number of routes), "on_bus" (under how many students take the bus), "homes" (under how many homes are pinned), "buses" (above the bus list), "route" (on one route; "target" is the route's name exactly as in the data), "bus" (on one bus; "target" is its "bus" number exactly as in the data). Leave "target" empty for the others.`,
  },
  results: {
    pack: "ai_results_pack",
    title: "Results insights",
    open: ["students", "marks", "none"],
    slots: ["students", "student"],
    targets: (pack, slot) => (slot === "student" ? [...(pack.struggling ?? []), ...(pack.dropped ?? []), ...(pack.top ?? [])].map((p) => p.id) : null),
    people: (pack) => [...(pack.struggling ?? []), ...(pack.dropped ?? []), ...(pack.top ?? [])],
    line: (p) => `${p.class}${p.average_pct != null ? ` · ${p.average_pct}%` : p.last_pct != null ? ` · ${p.previous_pct}% → ${p.last_pct}%` : ""}`,
    system: `You advise the owner and principal of a private school in India on exam results.

You get the school's exam results for the current session as JSON: each exam, averages by class and by subject, students below 33% (the pass mark), and the students struggling most, those whose marks dropped most between their last two exams, and the top students. Find what most needs attention and what to do about it.

${COMMON}
- Percentages go in "figures" as plain numbers, e.g. 62 for 62%.
- Things worth checking: subjects or classes with low averages or many students below 33%; a subject weak across many classes (the teaching, not the students); classes that fell between exams; students failing several subjects (remedial classes, a parent meeting); students whose marks dropped sharply (a talk with them and their parents); classes where marks haven't been entered for everyone; strong students to encourage.
- To name students, use only "struggling", "dropped" and "top", and put their "id" values in "students". Mention at most a few by name in the text.
- "open" picks the screen to go to: "students" (the student list), "marks" (enter or fix marks), or "none". Leave "class_name" empty.
- Hint spots: "students" (one line on the student list page; leave "target" empty), "student" (on one student's profile; "target" is their "id"). Write student hints for the struggling, dropped and top students worth a word, e.g. "Down 19 points since Term 1, weakest in Maths".`,
  },
};

export function schemaFor(section) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "insights", "hints"],
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
            open: { type: "string", enum: SECTIONS[section].open },
            class_name: { type: "string" },
          },
        },
      },
      hints: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["slot", "target", "text", "figures"],
          properties: {
            slot: { type: "string", enum: SECTIONS[section].slots },
            target: { type: "string" },
            text: { type: "string" },
            figures: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["label", "value"],
                properties: { label: { type: "string" }, value: { type: "number" } },
              },
            },
          },
        },
      },
    },
  };
}

export const userMessage = (section, pack) =>
  `${SECTIONS[section].title.replace(" insights", "")} figures for this school${pack.today ? ` (today is ${pack.today})` : ""}:\n\n${JSON.stringify(pack)}`;

// Every number in the data
function numbersIn(value, out = []) {
  if (typeof value === "number") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => numbersIn(v, out));
  return out;
}

// Keeps the insights whose figures are all in the data (within rounding)
// and whose students are ones the AI was allowed to name. Adds each named
// student's name and a short line, so the app can show them.
// Returns { summary, insights, dropped }.
export function checkInsights(section, result, pack) {
  const s = SECTIONS[section];
  const known = numbersIn(pack);
  const inData = (v) => known.some((k) => Math.abs(k - v) <= Math.max(1, Math.abs(k) * 0.005));
  const people = new Map(s.people(pack).map((p) => [p.id, p]));
  const insights = [];
  let dropped = 0;
  for (const it of result?.insights ?? []) {
    const figuresOk = (it.figures ?? []).every((f) => typeof f.value === "number" && inData(f.value));
    const studentsOk = (it.students ?? []).every((id) => people.has(id));
    if (!figuresOk || !studentsOk || !s.open.includes(it.open)) {
      dropped++;
      continue;
    }
    insights.push({
      ...it,
      people: [...new Set(it.students ?? [])].map((id) => {
        const p = people.get(id);
        return { id, name: p.name, line: s.line(p) };
      }),
    });
  }
  // Hints: known spot, a target that exists, numbers in the data, one per spot
  const hints = [];
  const seen = new Set();
  for (const h of result?.hints ?? []) {
    const targets = s.targets(pack, h.slot);
    const target = targets ? String(h.target ?? "") : "";
    const ok =
      s.slots.includes(h.slot) &&
      (!targets || targets.includes(target)) &&
      (h.figures ?? []).every((f) => typeof f.value === "number" && inData(f.value)) &&
      String(h.text ?? "").trim() &&
      !seen.has(`${h.slot}|${target}`);
    if (!ok) {
      dropped++;
      continue;
    }
    seen.add(`${h.slot}|${target}`);
    hints.push({ slot: h.slot, target, text: String(h.text).trim().slice(0, 140) });
  }
  return { summary: String(result?.summary ?? ""), insights, hints, dropped };
}
