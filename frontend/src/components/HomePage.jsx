import { useEffect, useState } from "react";
import { admissionFollowUpsDue, listDatesheet, listHomework, resultKeys, staffInbox } from "../data/api.js";
import { peek, swr } from "../data/cache.js";
import { rupeesShort } from "../data/money.js";
import { NEEDS } from "../data/needs.js";
import { useUpcoming } from "./CalendarPage.jsx";
import { useNotices } from "./NoticeBoard.jsx";
import Icon from "./Icon.jsx";
import { NotifyPrompt } from "./Notify.jsx";
import { useFeeTrend, useWide } from "./HomeTrend.jsx";
import { usePerms } from "../data/permissions.js";
import CheckInCard from "./CheckIn.jsx";

const n = (v) => Number(v || 0).toLocaleString("en-IN");
const pl = (count, one, many = `${one}s`) => `${n(count)} ${count === 1 ? one : many}`;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayLabel = (d, todayIso) => (d <= todayIso ? "Today" : new Date(`${d}T12:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }));

// Home, kept calm: what needs doing at the very top as red cards (tap one
// to open it in place: the detail and the button that deals with it), then a bento of plain
// white cards: the numbers that matter to this person (the first one big)
// and what's coming up. Every card and row opens its page.
// Sundays and calendar holidays are days off: no attendance to chase.
export default function HomePage({ school, role, students, loading, session, today, pendingCount, actions = [], onAction, onGo, onNeed }) {
  const isAdmin = role === "owner" || role === "admin";
  const leads = isAdmin || role === "principal";
  const isOwner = role === "owner";
  const perms = usePerms();
  const seesFees = isAdmin && perms.fees >= 1;
  const seesAtt = leads ? perms.attendance >= 1 : Boolean(today);
  const go = (to) => () => onGo(to);
  // Quick actions show on computers; phones have the + beside search
  const wide = useWide();

  // Data (the same remembered lists as the pages, so it's quick)
  const [homework, setHomework] = useState(() => (session ? peek(`homework:${session.id}`) ?? null : null));
  useEffect(() => {
    if (!session) return;
    swr(`homework:${session.id}`, () => listHomework(school.id, session.id), setHomework).catch(() => setHomework([]));
  }, [school.id, session]);
  const [threads, setThreads] = useState(() => peek(`inbox:${school.id}`) ?? null);
  useEffect(() => {
    swr(`inbox:${school.id}`, () => staffInbox(school.id), setThreads).catch(() => setThreads([]));
  }, [school.id]);
  const [admissionsDue, setAdmissionsDue] = useState(0);
  useEffect(() => {
    if (!leads || perms.admissions < 1) return;
    admissionFollowUpsDue(school.id, iso(new Date())).then((c) => setAdmissionsDue(Number(c) || 0), () => {});
  }, [school.id, leads, perms.admissions]);
  const [notices] = useNotices(school.id);
  const upcoming = useUpcoming(school.id, true, 14);
  const feeTrend = useFeeTrend(school.id, seesFees);
  // The datesheet and which marks are in, for "results pending"
  const examsKey = session ? `home:results:${session.id}` : null;
  const [exams, setExams] = useState(() => (examsKey ? peek(examsKey) ?? null : null));
  useEffect(() => {
    if (!examsKey) return;
    swr(examsKey, () => Promise.all([listDatesheet(school.id, session.id), resultKeys(session.id)]).then(([sheet, keys]) => ({ sheet, keys })), setExams, {
      persist: true,
      maxAge: 300000,
    }).catch(() => setExams({ sheet: [], keys: [] }));
  }, [examsKey, school.id, session]);

  const todayIso = iso(new Date());
  const [openTask, setOpenTask] = useState(null);
  const holiday = (upcoming ?? []).find((it) => it.kind === "holiday" && it.start <= todayIso && (it.end ?? it.start) >= todayIso);
  const dayOff = holiday ? holiday.title : new Date().getDay() === 0 ? "Sunday" : null;

  // Numbers
  const active = students.filter((p) => (p.status || "active") === "active");
  const due = students.reduce((t, p) => t + Math.max(0, Number(p.fee_due) || 0), 0);
  const overdue = students.filter((p) => p.fee_status === "overdue").length;
  const monthIn = feeTrend?.chart?.cur?.at(-1);
  const left = today?.notMarked ?? 0;
  const tomorrow = iso(new Date(Date.now() + 864e5));
  const dueTomorrow = (homework ?? []).filter((h) => h.due_date === tomorrow).length;
  const unread = (threads ?? []).filter((t) => Number(t.unread) > 0).length;
  const requests = (threads ?? []).filter((t) => Number(t.open_requests) > 0).length;

  const cur = feeTrend?.chart?.cur ?? null;
  const todayIn = cur ? (cur.at(-1) ?? 0) - (cur.at(-2) ?? 0) : undefined;
  const attPct = today?.marked ? Math.round((today.present / today.marked) * 100) : null;
  // The focus cards: what's still outstanding for this person (the first
  // wide, the other two small), each with the button that gets on with it. The office: fees, documents,
  // results. Teachers: today's attendance, results, homework.
  const docRows = Object.entries(NEEDS)
    .filter(([, x]) => x.doc)
    .map(([key, x]) => ({ key, label: x.label, count: active.filter(x.test).length }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
  const docTotal = docRows.reduce((t, r) => t + r.count, 0);
  // Papers already held (on the datesheet) whose marks aren't in yet, for
  // the classes this person can see
  const pendingPapers = (() => {
    if (!exams) return null;
    const inClass = new Map();
    for (const p of active) {
      const k = `${p.class}|${p.section ?? ""}`;
      if (!inClass.has(k)) inClass.set(k, []);
      inClass.get(k).push(p.id);
    }
    const has = new Set(exams.keys.map((r) => `${r.student_id}|${r.exam}|${r.subject}`));
    const seen = new Set();
    const out = [];
    for (const e of exams.sheet) {
      if (!e.exam_date || e.exam_date >= todayIso) continue;
      const key = `${e.class}|${e.section ?? ""}|${e.exam_name}|${e.subject}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const ids = [...inClass].filter(([k]) => k.split("|")[0] === e.class && (!e.section || k.split("|")[1] === e.section)).flatMap(([, list]) => list);
      if (ids.length && !ids.some((id) => has.has(`${id}|${e.exam_name}|${e.subject}`))) out.push(e);
    }
    return out;
  })();
  const resultsSeg = {
    key: "results",
    label: "Results pending",
    value: pendingPapers === null ? undefined : n(pendingPapers.length),
    action: "Enter marks",
    onClick: go("marks"),
  };
  const docsSeg = {
    key: "docs",
    label: "Pending documents",
    value: loading ? undefined : n(docTotal),
    action: "Collect",
    onClick: docRows.length ? () => onNeed?.(docRows[0].key) : go("students"),
  };
  const attSeg = {
    key: "att",
    label: "Attendance today",
    value: dayOff ? "Closed" : today === null ? undefined : leads ? (today?.marked ? `${attPct}%` : "Not marked") : today?.marked ? `${n(today.present)} / ${n(today.marked)}` : "Not taken",
    action: !leads && !today?.marked && !dayOff ? "Take attendance" : "Open register",
    onClick: go("attendance"),
  };
  const focus = seesFees
    ? [
        { key: "fees", label: "Fees remaining", value: loading ? undefined : rupeesShort(due), action: "View fees", onClick: go("fees") },
        docsSeg,
        resultsSeg,
      ]
    : leads
      ? [seesAtt && attSeg, resultsSeg, perms.students >= 1 ? docsSeg : { key: "hw", label: "Homework due tomorrow", value: homework === null ? undefined : n(dueTomorrow), action: "See homework", onClick: go("homework") }].filter(Boolean)
      : [seesAtt && attSeg, resultsSeg, { key: "hw", label: "Homework due tomorrow", value: homework === null ? undefined : n(dueTomorrow), action: "See homework", onClick: go("homework") }].filter(Boolean);

  // To do: what's waiting on this person, most pressing first
  // Each task opens in place: a line of context, the rows behind it, and
  // the button that deals with it.
  const gapRows = Object.entries(NEEDS)
    .filter(([, x]) => !x.doc)
    .map(([key, x]) => ({ key, label: x.label, value: n(active.filter(x.test).length), count: active.filter(x.test).length, cta: "Fix", onClick: () => onNeed?.(key) }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
  const gapTotal = gapRows.reduce((t, r) => t + r.count, 0);
  const byId = new Map(students.map((p) => [p.id, p]));
  const overdueAmt = students.filter((p) => p.fee_status === "overdue").reduce((t, p) => t + Math.max(0, Number(p.fee_due) || 0), 0);
  const waiting = (threads ?? []).filter((t) => Number(t.open_requests) > 0);
  const hwTomorrow = (homework ?? []).filter((h) => h.due_date === tomorrow);
  const todo = [
    isOwner && pendingCount > 0 && {
      key: "access",
      text: `${pl(pendingCount, "person", "people")} waiting for app access`,
      info: "They've asked to use GodView. Approve each one and pick what they can see.",
      actions: [{ label: "Review requests", onClick: go("access") }],
    },
    !dayOff && seesAtt && left > 0 && {
      key: "att",
      text: leads ? `${pl(left, "class", "classes")} haven't marked attendance` : "Take today's attendance",
      info: leads
        ? today?.marked
          ? `${pl(today.marked, "student")} marked so far, ${n(today.present)} present. ${pl(left, "class", "classes")} still to go.`
          : "No class has marked attendance yet today."
        : "Mark who's in today for your class.",
      actions: [{ label: leads ? "Open attendance" : "Take attendance", onClick: go("attendance") }],
    },
    requests > 0 && {
      key: "requests",
      text: `${pl(requests, "parent request")} waiting`,
      rows: waiting.slice(0, 3).map((t) => ({ key: t.student_id, label: byId.get(t.student_id)?.name ?? "A parent", value: t.last_body, quiet: true })),
      actions: [{ label: "Open inbox", onClick: go("requests") }],
    },
    !leads && dueTomorrow > 0 && {
      key: "hw",
      text: `${pl(dueTomorrow, "homework")} due tomorrow`,
      rows: hwTomorrow.slice(0, 4).map((h) => ({ key: h.id, label: h.subject || "Homework", value: h.body, quiet: true })),
      actions: [{ label: "See homework", onClick: go("homework") }],
    },
    seesFees && overdue > 0 && actions.some(([k]) => k === "bulk") && {
      key: "remind",
      text: `Remind ${pl(overdue, "family", "families")} with overdue fees`,
      info: `${pl(overdue, "student")} ${overdue === 1 ? "is" : "are"} past the due date, ${rupeesShort(overdueAmt)} in all. Send their parents one reminder, or see who owes what first.`,
      actions: [
        { label: "Message parents", onClick: () => onAction("bulk"), primary: true },
        { label: "See who owes", onClick: go("fees") },
      ],
    },
    admissionsDue > 0 && {
      key: "admissions",
      text: `${pl(admissionsDue, "admission follow-up")} due`,
      info: "Families you planned to call back today about joining.",
      actions: [{ label: "Open admissions", onClick: go("admissions") }],
    },
    isAdmin && gapTotal > 0 && {
      key: "records",
      text: `${pl(gapTotal, "gap")} in student records`,
      info: "Active students with something missing. Fix opens just those students.",
      rows: gapRows,
    },
  ].filter(Boolean);

  const coming = (upcoming ?? []).filter((it) => (it.end ?? it.start) >= todayIso).slice(0, 3);
  // Teachers and the principal also get the latest notices (the office posts them)
  const latest = isAdmin ? [] : (notices ?? []).slice(0, 3);

  const tasks = todo.map((t) => ({ ...t, id: t.key }));
  return (
    <div className="hc">
      {tasks.length === 0 ? (
        <p className="hc-line hc-caught">
          <Icon name="check" size={14} weight="bold" />
          You're all caught up.
        </p>
      ) : (
        <ul className="hc-checks" aria-label="To do">
          {tasks.map((t, i) => {
            return (
              <li key={t.id} className={`hc-line${openTask === t.id ? " is-open" : ""}`} style={{ "--i": i }}>
                <div className="hc-line-row">
                  <button type="button" className="hc-task" aria-expanded={openTask === t.id} onClick={() => setOpenTask((cur) => (cur === t.id ? null : t.id))}>
                    <span>{t.text}</span>
                    <Icon name="chevronDown" size={15} />
                  </button>
                </div>
                <div className="hc-more" aria-hidden={openTask !== t.id}>
                  <div className="hc-more-inner">
                    {t.info && <p className="hc-info">{t.info}</p>}
                    {t.rows?.length > 0 && (
                      <ul className="hc-rows">
                        {t.rows.map((r) => (
                          <li key={r.key}>
                            <span>{r.label}</span>
                            <em className={r.quiet ? "is-quiet" : ""}>{r.value}</em>
                            {r.onClick && (
                              <button type="button" className="hc-mini" onClick={r.onClick} tabIndex={openTask === t.id ? 0 : -1}>
                                {r.cta}
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {t.actions?.length > 0 && (
                      <div className="hc-actions">
                        {t.actions.map((x, i) => (
                          <button type="button" key={x.label} className={`hc-act${x.primary || (i === 0 && t.actions.length === 1) ? " is-primary" : ""}`} onClick={x.onClick} tabIndex={openTask === t.id ? 0 : -1}>
                            {x.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {wide && <QuickActions actions={actions} onAction={onAction} />}

      {role !== "owner" && <CheckInCard schoolId={school.id} />}
      <NotifyPrompt text="Get notified when parents write." />

      <div className={`hc-bento ${seesFees ? "is-office" : "is-staff"}${latest.length ? " has-notices" : ""}${focus.length < 3 ? " has-two" : ""}`}>
        {focus.map((f, i) => (
          <button type="button" key={f.key} className={`hc-card hc-pick hc-f${i + 1}${i === 0 ? " is-lead" : ""}`} onClick={f.onClick}>
            <span className="hc-label">{f.label}</span>
            <strong className="hc-value">{f.value ?? "…"}</strong>
            <span className="hc-seg-go">
              {f.action}
              <Icon name="arrowRight" size={13} />
            </span>
          </button>
        ))}

        {seesFees && (
          <button type="button" className="hc-card hc-month" onClick={go("collection")} aria-label={feeTrend?.note?.text ? `Collected this month, ${feeTrend.note.text}` : "Collected this month"}>
            <span className="hc-label">Collected in {new Date().toLocaleDateString("en-IN", { month: "long" })}</span>
            <strong className="hc-value">{monthIn === undefined ? "…" : rupeesShort(monthIn)}</strong>
            {feeTrend?.chart && cur.length > 0 && <Area chart={feeTrend.chart} />}
          </button>
        )}

        {seesFees && seesAtt && (
          <button type="button" className="hc-card hc-present is-center" onClick={go("attendance")}>
            <span className="hc-label">Present today</span>
            {dayOff ? (
              <>
                <Pic name="sun" big />
                <strong className="hc-value">Closed</strong>
                <span className="hc-sub">{dayOff}</span>
              </>
            ) : (
              <>
                <Ring pct={attPct ?? 0} empty={!today?.marked} />
                <strong className="hc-value">{today === null ? "…" : today?.marked ? `${n(today.present)} / ${n(today.marked)}` : "Not marked"}</strong>
                <span className="hc-sub">{today?.marked ? "students in" : "No class has marked yet"}</span>
              </>
            )}
          </button>
        )}

        <button type="button" className="hc-card hc-students is-center" onClick={go("students")}>
          <span className="hc-label">{leads ? "Students" : "My students"}</span>
          <Pic name="backpack" big />
          <strong className="hc-value">{loading ? "…" : n(active.length)}</strong>
        </button>

        {seesFees ? (
          <button type="button" className="hc-card hc-today is-center" onClick={go("collection")}>
            <span className="hc-label">Collected today</span>
            <strong className="hc-value hc-glow">{todayIn === undefined ? "…" : rupeesShort(todayIn)}</strong>
            <span className="hc-sub">{dayOff ? "School's closed" : "so far today"}</span>
          </button>
        ) : (
          <button type="button" className="hc-card hc-today is-center" onClick={go("requests")}>
            <span className="hc-label">Unread messages</span>
            <Pic name="speech-balloon" big />
            <strong className="hc-value">{threads === null ? "…" : n(unread)}</strong>
          </button>
        )}

        <section className={`hc-card hc-coming${coming.length === 1 ? " is-solo" : ""}`}>
          <span className="hc-label">Coming up</span>
          {upcoming === null ? (
            <p className="hc-quiet">…</p>
          ) : coming.length === 0 ? (
            <div className="hc-next is-empty">
              <Pic name="calendar" big />
              <span className="hc-sub">Nothing in the next two weeks</span>
            </div>
          ) : (
            <>
              <button type="button" className="hc-next" onClick={go("calendar")}>
                <Leaf date={coming[0].start <= todayIso ? todayIso : coming[0].start} />
                <span className="hc-next-text">
                  <strong>{coming[0].title}</strong>
                  <span>{dayLabel(coming[0].start, todayIso)}</span>
                </span>
              </button>
              {coming.length > 1 && (
                <ul className="hc-list">
                  {coming.slice(1).map((it) => (
                    <li key={it.id}>
                      <button type="button" onClick={go("calendar")}>
                        <em>{dayLabel(it.start, todayIso)}</em>
                        <span>{it.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        {latest.length > 0 && (
          <section className="hc-card hc-notices">
            <span className="hc-label">Notices</span>
            <ul className="hc-list">
              {latest.map((x) => (
                <li key={x.id}>
                  <button type="button" onClick={go("notices")}>
                    <Pic name="loudspeaker" />
                    <span>{x.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

// Everyday shortcuts, one button each: the + menu's actions as
// [key, label, icon], each with its 3D picture.
const ACTION_PIC = { student: "backpack", enquiry: "telephone", fee: "rupee", attendance: "check-mark", homework: "books", result: "graduation-cap", datesheet: "memo", notice: "loudspeaker", bulk: "speech-balloon", event: "calendar" };

function QuickActions({ actions, onAction }) {
  if (!actions.length) return null;
  return (
    <div className="hc-quick">
      {actions.map(([key, label]) => (
        <button type="button" key={key} className="hc-act-card" onClick={() => onAction(key)}>
          <Pic name={ACTION_PIC[key] ?? "memo"} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

// A small 3D picture, the same set as the student profile's details
// (Fluent Emoji, public/icons/3d).
function Pic({ name, big = false }) {
  const size = big ? 60 : 28;
  return <img className={`hc-pic${big ? " is-big" : ""}`} src={`/icons/3d/${name}.png`} alt="" width={size} height={size} loading="lazy" decoding="async" />;
}

// Present today as a ring (pct 0 to 100).
function Ring({ pct, empty = false }) {
  const size = 96;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="hc-ring" role="img" aria-label={empty ? "Not marked yet" : `${pct}% present`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="hc-ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7c8cf0" />
            <stop offset="1" stopColor="#4c58c4" />
          </linearGradient>
        </defs>
        <circle className="hc-ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        {!empty && (
          <circle
            className="hc-ring-fill"
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={stroke}
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct / 100)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <span className="hc-ring-num">{empty ? "–" : `${pct}%`}</span>
    </span>
  );
}

// A tear-off calendar leaf: the month in a red strip, the day big.
function Leaf({ date }) {
  const d = new Date(`${date}T12:00:00`);
  return (
    <span className="hc-leaf" aria-hidden="true">
      <span>{d.toLocaleDateString("en-IN", { month: "short" })}</span>
      <strong>{d.getDate()}</strong>
    </span>
  );
}

// This month's running total (solid, soft fill under it) against last
// month's (dashed), each named at its end, last month with its total.
function Area({ chart }) {
  const { cur, prev, days, curName, prevName } = chart;
  const w = 300;
  const h = 76;
  const max = Math.max(...cur, ...prev, 1);
  const x = (i) => (days > 1 ? (i / (days - 1)) * w : 0);
  const y = (v) => h - 4 - (v / max) * (h - 14);
  const path = (list) => list.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const curLine = path(cur);
  const end = [x(cur.length - 1), y(cur.at(-1))];
  const prevEnd = [x(prev.length - 1), y(prev.at(-1) ?? 0)];
  const pct = ([px, py]) => ({ left: `${(px / w) * 100}%`, top: `${(py / h) * 100}%` });
  return (
    <span className="hc-area" aria-hidden="true">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="hc-area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5b68c4" stopOpacity="0.26" />
            <stop offset="1" stopColor="#5b68c4" stopOpacity="0" />
          </linearGradient>
        </defs>
        {prev.length > 1 && <polyline className="hc-area-prev" points={path(prev)} vectorEffect="non-scaling-stroke" />}
        {cur.length > 1 && <polygon points={`0,${h} ${curLine} ${end[0].toFixed(1)},${h}`} fill="url(#hc-area-grad)" />}
        {cur.length > 1 && <polyline className="hc-area-cur" points={curLine} vectorEffect="non-scaling-stroke" />}
      </svg>
      <span className="hc-area-dot" style={pct(end)} />
      <span className="hc-area-tag is-cur" style={pct(end)}>
        {curName}
      </span>
      {prev.length > 1 && (
        <span className="hc-area-tag is-prev" style={pct(prevEnd)}>
          {prevName} <strong>{rupeesShort(prev.at(-1) ?? 0)}</strong>
        </span>
      )}
    </span>
  );
}
