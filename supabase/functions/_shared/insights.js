// AI insights: for each section (fees, transport, results, homework, staff), the database
// function with its figures, the instructions, the answer format and the
// number check. Shared by the ai-insights edge function (Deno) and the
// model comparison script (Node), so both test exactly the same thing.
// Plain JavaScript, no imports, so it runs in either.

const COMMON = `Rules:
- Use only the figures given. Every number must appear in the data exactly. Don't work out new totals, differences or percentages.
- Give at most 3 insights: only what matters most, most important first. Fewer is fine. Be specific to this school; skip generic advice.
- Each insight is a card read in two seconds:
  - "stat_value": the one number that matters, exactly as in the data; "stat_unit": rupees, count, percent, days or km.
  - "stat_label": 2 to 4 words saying what the number is, e.g. "overdue 90+ days", "students, no stop".
  - "title": the point in at most 7 words, e.g. "Most overdue money is very old".
  - "message": the same point as one short, plain sentence that fits on one line: at most 7 words and 40 characters. Put "{stat}" exactly once where "stat_value" goes; the app shows the number there, highlighted. Don't write that number yourself. E.g. "Math average is only {stat}." or "{stat} overdue for over 90 days."
  - "action": what to do this week in at most 7 words, starting with a verb, e.g. "Call the top 25 families".
  - "why": at most 20 words of context, with any other numbers.
  - List every number you use in "figures", with its exact value from the data.
- Plain words for a busy school owner in India. No full sentences where a phrase will do.`;

const inr = (n) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");

export const SECTIONS = {
  fees: {
    pack: "ai_fees_pack",
    title: "Fee insights",
    open: ["overdue", "class", "structure", "none"],
    people: (pack) => pack.top_overdue ?? [],
    line: (p) => `${p.class} · ${inr(p.overdue)}`,
    system: `You advise the owner of a private school in India on fee collection.

You get the school's fee figures for the current session as JSON. Find what most needs the owner's attention and what to do about it.

${COMMON}
- "Due now" (due_now) is everything due by today. A student is "overdue" when their oldest unpaid due is more than 15 days old; their overdue amount is all they owe today. Use these words this way, as the app does.
- Rupees go in "figures" as plain numbers, e.g. 125000. In the text, write amounts the Indian way, e.g. ₹1,25,000 or ₹1.25 L.
- Things worth checking: classes collecting less than others; fees overdue a long time; the students owing most (call those families); overdue families whose parents don't have the app, so reminders don't reach them; how late payments usually come; months with low collection; cash against UPI and other methods; fee heads lagging (e.g. transport); concessions.
- To name students, use only "top_overdue", and put their "id" values in "students". Mention at most a few by name in the text.
- "open" picks the screen to go to: "overdue" (the overdue list), "class" (one class; put its name exactly as in the data in "class_name"), "structure" (the fee structure), or "none". Leave "class_name" empty unless "open" is "class".`,
  },
  transport: {
    pack: "ai_transport_pack",
    title: "Transport insights",
    open: ["routes", "buses", "map", "none"],
    people: () => [],
    line: () => "",
    system: `You advise the owner of a private school in India on its school buses and routes.

You get the school's transport figures as JSON: villages and towns where students live (how many, how many take the bus, distance from school, which routes have a stop there), each route (its bus, seats, riders, stops in order with pickup times and distance), and each bus (seats, status, papers running out, safety kit missing). Find what most needs attention and what to do about it.

${COMMON}
- Things worth checking: villages with many students but no stop on any route (a new stop or a new route; nearby villages that one route could cover together); villages where few students take the bus (a chance to offer transport); routes with more riders than seats, or very few riders (merge or reroute); routes with no bus, or a bus in repair; papers that ran out or run out soon (negative days_left means it already ran out); missing driver, conductor or safety kit; pickup times out of order; students on the bus without a stop; students whose village isn't known.
- Kilometres are straight-line distance from the school, not road distance; say "about".
- Leave "students" empty. "open" picks the screen to go to: "routes" (bus routes and stops), "buses" (the bus list), "map" (the map of where students live), or "none". Leave "class_name" empty.`,
  },
  results: {
    pack: "ai_results_pack",
    title: "Results insights",
    open: ["students", "marks", "none"],
    people: (pack) => [...(pack.struggling ?? []), ...(pack.dropped ?? []), ...(pack.top ?? [])],
    line: (p) => `${p.class}${p.average_pct != null ? ` · ${p.average_pct}%` : p.last_pct != null ? ` · ${p.previous_pct}% → ${p.last_pct}%` : ""}`,
    system: `You advise the owner and principal of a private school in India on exam results.

You get the school's exam results for the current session as JSON: each exam, averages by class and by subject, students below 33% (the pass mark), and the students struggling most, those whose marks dropped most between their last two exams, and the top students. Find what most needs attention and what to do about it.

${COMMON}
- Percentages go in "figures" as plain numbers, e.g. 62 for 62%.
- Things worth checking: subjects or classes with low averages or many students below 33%; a subject weak across many classes (the teaching, not the students); classes that fell between exams; students failing several subjects (remedial classes, a parent meeting); students whose marks dropped sharply (a talk with them and their parents); classes where marks haven't been entered for everyone; strong students to encourage.
- To name students, use only "struggling", "dropped" and "top", and put their "id" values in "students". Mention at most a few by name in the text.
- "open" picks the screen to go to: "students" (the student list), "marks" (enter or fix marks), or "none". Leave "class_name" empty.`,
  },
  homework: {
    pack: "ai_homework_pack",
    title: "Homework insights",
    open: ["homework", "syllabus", "none"],
    people: () => [],
    line: () => "",
    system: `You advise the owner and principal of a private school in India on homework and syllabus coverage.

You get counts for the current session as JSON: homework given by each class, subject and teacher in the last 7 and 30 days and how many days since the last one, and which grades have no syllabus entries. You don't see what the homework says, so judge only how much is being given and where it has stopped. Find what most needs attention and what to do about it.

${COMMON}
- Things worth checking: classes with no homework in the last 7 days or none this session; a teacher or subject that has gone quiet; classes getting far less than others; homework without a due date; grades with no syllabus entries; a teacher doing well worth a word of thanks.
- Don't call a teacher careless: there may be a reason. Say what the numbers show and suggest a check.
- Leave "students" empty. "open" picks the screen to go to: "homework" (the homework list), "syllabus" (the syllabus), or "none". Leave "class_name" empty.`,
  },
  staff: {
    pack: "ai_staff_pack",
    title: "Staff insights",
    open: ["people", "access", "none"],
    people: () => [],
    line: () => "",
    system: `You advise the owner of a private school in India on its staff.

You get counts as JSON, with no names: staff who teach and don't, students per teaching staff, departments, gaps in staff records, classes with no class teacher, teaching staff with no class this session, and people waiting for app access. Find what most needs attention and what to do about it.

${COMMON}
- Things worth checking: classes without a class teacher (parents and attendance depend on one); teaching staff with no class this session (the classes may just not be assigned yet); people waiting for app access; missing phone numbers or joining dates; many students per teaching staff.
- You only see records, not how people work, so never judge anyone's performance. Say what's missing and suggest how to fix it.
- Leave "students" empty. "open" picks the screen to go to: "people" (the staff list), "access" (app access requests), or "none". Leave "class_name" empty.`,
  },
};

const FIGURES = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["label", "value"],
    properties: { label: { type: "string" }, value: { type: "number" } },
  },
};

export function schemaFor(section) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["insights"],
    properties: {
      insights: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["priority", "stat_value", "stat_unit", "stat_label", "title", "message", "action", "why", "figures", "students", "open", "class_name"],
          properties: {
            priority: { type: "string", enum: ["high", "medium", "low"] },
            stat_value: { type: "number" },
            stat_unit: { type: "string", enum: ["rupees", "count", "percent", "days", "km"] },
            stat_label: { type: "string" },
            title: { type: "string" },
            message: { type: "string" },
            action: { type: "string" },
            why: { type: "string" },
            figures: FIGURES,
            students: { type: "array", items: { type: "string" } },
            open: { type: "string", enum: SECTIONS[section].open },
            class_name: { type: "string" },
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
// Returns { insights, dropped }.
export function checkInsights(section, result, pack) {
  const s = SECTIONS[section];
  const known = numbersIn(pack);
  const inData = (v) => known.some((k) => Math.abs(k - v) <= Math.max(1, Math.abs(k) * 0.005));
  const people = new Map(s.people(pack).map((p) => [p.id, p]));
  const insights = [];
  let dropped = 0;
  for (const it of result?.insights ?? []) {
    const figuresOk =
      typeof it.stat_value === "number" && inData(it.stat_value) && (it.figures ?? []).every((f) => typeof f.value === "number" && inData(f.value));
    const studentsOk = (it.students ?? []).every((id) => people.has(id));
    if (!figuresOk || !studentsOk || !s.open.includes(it.open)) {
      dropped++;
      continue;
    }
    if (insights.length >= 3) continue;
    // The note must hold the number's spot exactly once; the app builds one if not
    const message = String(it.message ?? "").trim();
    insights.push({
      ...it,
      message: message.split("{stat}").length === 2 ? message : "",
      people: [...new Set(it.students ?? [])].map((id) => {
        const p = people.get(id);
        return { id, name: p.name, line: s.line(p) };
      }),
    });
  }
  return { insights, dropped };
}
