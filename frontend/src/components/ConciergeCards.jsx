import { useEffect, useState } from "react";
import Icon from "./Icon.jsx";
import { attendanceOverview, feeClassSummary, feeMonthlyCollection, feeSessionSummary } from "../data/api.js";
import { swr } from "../data/cache.js";
import { rupees, rupeesShort } from "../data/money.js";

// Report cards on the assistant's page: fees and today's attendance, shown
// beside the answer without leaving. Same remembered data (and cache keys)
// as the Fees and Attendance pages, so they open instantly.

const num = (v) => Number(v) || 0;
const pct = (r) => `${Math.round(r * 100)}%`;
const count = (n, word) => `${n.toLocaleString("en-IN")} ${word}${n === 1 ? "" : "s"}`;
const className = (c) => (/^\d+$/.test(String(c)) ? `Class ${c}` : String(c || "No class"));
// Read aloud: "₹4.2 lakh", not "₹4.2 L".
const spoken = (n) => rupeesShort(n).replace(/ L$/, " lakh").replace(/ Cr$/, " crore");

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The last six months, oldest first, as "YYYY-MM".
function lastMonths(n = 6) {
  const d = new Date();
  return Array.from({ length: n }, (_, i) => {
    const m = new Date(d.getFullYear(), d.getMonth() - (n - 1 - i), 1);
    return { key: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`, label: m.toLocaleString("en-IN", { month: "short" }) };
  });
}

function feeReport({ summary, monthly, byClass }) {
  if (!summary) return null;
  const collected = num(summary.collected);
  const dueNow = num(summary.due_now);
  const sums = new Map((monthly ?? []).map((m) => [String(m.month).slice(0, 7), num(m.amount)]));
  const months = lastMonths().map((m) => ({ ...m, amount: sums.get(m.key) ?? 0 }));
  return {
    collected,
    dueNow,
    billed: num(summary.billed),
    studentsDue: num(summary.students_due),
    // Share of what has fallen due so far that is paid: the year's later
    // installments don't count against the school yet.
    rate: collected + dueNow > 0 ? collected / (collected + dueNow) : null,
    thisMonth: months.at(-1).amount,
    months,
    mostDue: (byClass ?? [])
      .filter((c) => num(c.due_now) > 0)
      .sort((a, b) => num(b.due_now) - num(a.due_now))
      .slice(0, 3)
      .map((c) => ({ name: className(c.class), due: num(c.due_now), students: num(c.students_due) })),
  };
}

function attendanceReport(rows) {
  if (!rows) return null;
  const sum = (k) => rows.reduce((t, r) => t + num(r[k]), 0);
  const students = sum("students");
  const present = sum("present") + sum("late");
  const marked = students - sum("unmarked");
  const label = (r) => [r.class, r.section].filter(Boolean).join("-");
  return {
    students,
    present,
    absent: sum("absent"),
    leave: sum("on_leave"),
    marked,
    classes: rows.length,
    rate: marked > 0 ? present / marked : null,
    notMarked: rows.filter((r) => num(r.students) > 0 && num(r.unmarked) === num(r.students)).map(label),
    lowest: rows
      .filter((r) => num(r.students) - num(r.unmarked) > 0)
      .map((r) => ({ name: label(r), rate: (num(r.present) + num(r.late)) / (num(r.students) - num(r.unmarked)) }))
      .sort((a, b) => a.rate - b.rate)
      .slice(0, 3),
  };
}

// Loads both reports when the assistant opens. fees: may this person see fees.
export function useReports(sessionId, fees) {
  const [raw, setRaw] = useState({});
  useEffect(() => {
    if (!sessionId) return;
    const put = (k) => (v) => setRaw((r) => ({ ...r, [k]: v }));
    const day = todayIso();
    swr(`att-overview:${sessionId}:${day}`, () => attendanceOverview(sessionId, day), put("attendance")).catch(() => {});
    if (!fees) return;
    swr(`fees:summary:${sessionId}`, () => feeSessionSummary(sessionId), put("summary")).catch(() => {});
    swr(`fees:monthly:${sessionId}`, () => feeMonthlyCollection(sessionId), put("monthly")).catch(() => {});
    swr(`fees:class:${sessionId}`, () => feeClassSummary(sessionId), put("byClass")).catch(() => {});
  }, [sessionId, fees]);
  return { fees: fees ? feeReport(raw) : null, attendance: attendanceReport(raw.attendance) };
}

// The figures behind the cards, for Claude to quote.
export function reportFacts({ fees, attendance }) {
  const f = {};
  if (fees) {
    f.fee_report = {
      collected_this_session: fees.collected,
      due_now: fees.dueNow,
      students_with_dues: fees.studentsDue,
      billed_whole_session: fees.billed,
      collected_this_month: fees.thisMonth,
      classes_with_most_due: fees.mostDue.map((c) => ({ class: c.name, due_now: c.due, students: c.students })),
    };
  }
  if (attendance) {
    f.attendance_by_class = {
      lowest_today: attendance.lowest.map((c) => ({ class: c.name, present: pct(c.rate) })),
      not_marked_yet: attendance.notMarked.slice(0, 12),
    };
  }
  return f;
}

// What she says when a card opens from a chip, and how she says it.
export function cardLine(kind, r) {
  if (kind === "fees" && r.fees) {
    const f = r.fees;
    if (f.rate === null) return { say: "No fees have fallen due yet this session.", mood: "" };
    const due = f.dueNow > 0 ? ` ${spoken(f.dueNow)} is due now from ${count(f.studentsDue, "student")}.` : " Nothing is overdue.";
    return {
      say: `You've collected ${spoken(f.collected)} so far, ${Math.round(f.rate * 100)} percent of what's due.${due}`,
      mood: f.rate >= 0.9 ? "pleased" : f.rate < 0.7 ? "concerned" : "",
    };
  }
  if (kind === "attendance" && r.attendance) {
    const a = r.attendance;
    if (a.rate === null) return { say: "No attendance has been marked yet today.", mood: new Date().getHours() >= 11 ? "concerned" : "" };
    const left = a.notMarked.length ? ` ${count(a.notMarked.length, "class")} ${a.notMarked.length === 1 ? "hasn't" : "haven't"} marked yet.` : "";
    return {
      say: `${Math.round(a.rate * 100)} percent present today: ${a.present} present and ${a.absent} absent${a.leave ? `, ${a.leave} on leave` : ""}.${left}`,
      mood: a.rate >= 0.9 && !a.notMarked.length ? "pleased" : a.rate < 0.8 ? "concerned" : "",
    };
  }
  return null;
}

function Meter({ value, label }) {
  return (
    <div className="cg-meter" role="img" aria-label={label}>
      <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

function Head({ title, open, onOpen, onClose }) {
  return (
    <header className="cg-card-head">
      <h2>{title}</h2>
      <button type="button" className="cg-card-open" onClick={onOpen}>
        Open<span className="cg-card-page"> {open}</span>
        <Icon name="arrowRight" size={14} />
      </button>
      <button type="button" className="cg-card-x" onClick={onClose} aria-label="Close card" title="Close">
        <Icon name="x" size={16} />
      </button>
    </header>
  );
}

function FeeCard({ f, onOpen, onClose }) {
  const top = Math.max(...f.months.map((m) => m.amount), 1);
  return (
    <article className="cg-card" aria-label="Fees this session">
      <Head title="Fees this session" open="Fees" onOpen={onOpen} onClose={onClose} />
      <div className="cg-hero">
        {rupeesShort(f.collected)}
        <span>collected</span>
      </div>
      {f.rate !== null && (
        <>
          <Meter value={f.rate} label={`${pct(f.rate)} of what's due so far is collected`} />
          <p className="cg-card-note">{pct(f.rate)} of what's due so far</p>
        </>
      )}
      <dl className="cg-stats">
        <div>
          <dt>Due now</dt>
          <dd>
            {rupeesShort(f.dueNow)}
            {f.studentsDue > 0 && <small>{count(f.studentsDue, "student")}</small>}
          </dd>
        </div>
        <div>
          <dt>This month</dt>
          <dd>{rupeesShort(f.thisMonth)}</dd>
        </div>
      </dl>
      <figure className="cg-cols" aria-label="Collected each month">
        {f.months.map((m, i) => (
          <div key={m.key} className={`cg-col${i === f.months.length - 1 ? " is-now" : ""}`} title={`${m.label}: ${rupees(m.amount)}`}>
            <b>
              <i style={{ height: `${m.amount > 0 ? Math.max(4, (m.amount / top) * 100) : 0}%` }} />
            </b>
            <span>{m.label}</span>
          </div>
        ))}
      </figure>
      {f.mostDue.length > 0 && (
        <ul className="cg-rows" aria-label="Classes with the most due">
          {f.mostDue.map((c) => (
            <li key={c.name}>
              <span>{c.name}</span>
              <small>{count(c.students, "student")}</small>
              <b>{rupeesShort(c.due)}</b>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function AttendanceCard({ a, onOpen, onClose }) {
  return (
    <article className="cg-card" aria-label="Attendance today">
      <Head title="Attendance today" open="Attendance" onOpen={onOpen} onClose={onClose} />
      {a.rate === null ? (
        <div className="cg-hero">
          Not marked yet
          <span>0 of {a.classes} classes</span>
        </div>
      ) : (
        <>
          <div className="cg-hero">
            {pct(a.rate)}
            <span>present</span>
          </div>
          <Meter value={a.rate} label={`${pct(a.rate)} present`} />
          <dl className="cg-stats cg-stats-3">
            <div>
              <dt>Present</dt>
              <dd>{a.present.toLocaleString("en-IN")}</dd>
            </div>
            <div>
              <dt>Absent</dt>
              <dd>{a.absent.toLocaleString("en-IN")}</dd>
            </div>
            <div>
              <dt>On leave</dt>
              <dd>{a.leave.toLocaleString("en-IN")}</dd>
            </div>
          </dl>
          {a.lowest.length > 1 && (
            <ul className="cg-rows" aria-label="Lowest attendance">
              {a.lowest.map((c) => (
                <li key={c.name}>
                  <span>{c.name}</span>
                  <Meter value={c.rate} label={`${c.name}: ${pct(c.rate)} present`} />
                  <b>{pct(c.rate)}</b>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {a.notMarked.length > 0 && a.rate !== null && (
        <p className="cg-card-note">
          Not marked yet: {a.notMarked.slice(0, 4).join(", ")}
          {a.notMarked.length > 4 ? ` and ${a.notMarked.length - 4} more` : ""}
        </p>
      )}
    </article>
  );
}

// kind: "fees" | "attendance". Nothing until its data has arrived.
export default function ReportCard({ kind, reports, onOpen, onClose }) {
  if (kind === "fees" && reports.fees) return <FeeCard f={reports.fees} onOpen={onOpen} onClose={onClose} />;
  if (kind === "attendance" && reports.attendance) return <AttendanceCard a={reports.attendance} onOpen={onOpen} onClose={onClose} />;
  return null;
}
