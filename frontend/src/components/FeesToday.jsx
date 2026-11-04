import { useEffect, useState } from "react";
import { feeCollection } from "../data/api.js";
import { peek, swr } from "../data/cache.js";
import { METHODS, rupees } from "../data/money.js";
import { gradeLabel } from "./PersonCard.jsx";
import { ColumnChart } from "./charts.jsx";
import { useWide } from "./HomeTrend.jsx";

const DAYS = 7;
const LATEST = 3;

// A day as the school sees it, "YYYY-MM-DD" (not UTC: just after midnight here
// it's still yesterday there).
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const sum = (rows) => rows.reduce((t, r) => t + Number(r.amount), 0);
const payments = (n) => `${n.toLocaleString("en-IN")} payment${n === 1 ? "" : "s"}`;

// The Fees page's day-to-day view: what came in today, who paid, and the last
// week beside it. The longer views are the Collection and Class-wise reports.
// refreshAt: changes after a payment, so a new one shows at once.
export default function FeesToday({ school, students, refreshAt = 0, onOpenStudent }) {
  const now = new Date();
  const days = Array.from({ length: DAYS }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - (DAYS - 1 - i)));
  const today = dayKey(now);
  const from = dayKey(days[0]);
  const key = `fees:today:${school.id}:${today}`;
  const [rows, setRows] = useState(() => peek(key) ?? null);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const wide = useWide();

  useEffect(() => {
    swr(key, () => feeCollection(school.id, from, today), (r) => (setRows(r), setFailed(false))).catch(() => setFailed(true));
  }, [key, school.id, from, today, refreshAt]);

  const list = rows ?? [];
  const todays = list.filter((r) => r.paid_on === today);
  const yesterday = sum(list.filter((r) => r.paid_on === dayKey(days[DAYS - 2])));
  const total = sum(todays);
  const byMode = Object.keys(METHODS)
    .map((m) => [m, sum(todays.filter((r) => r.method === m))])
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1]);
  const classOf = new Map(students.map((s) => [s.id, s]));
  const week = days.map((d, i) => {
    const on = list.filter((r) => r.paid_on === dayKey(d));
    const isToday = i === DAYS - 1;
    return {
      key: dayKey(d),
      short: isToday ? "Today" : d.toLocaleDateString("en-IN", { weekday: "short" }),
      label: d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }),
      value: sum(on),
      note: on.length ? payments(on.length) : "No payments",
      current: isToday,
    };
  });

  return (
    <div className="fees-charts is-today">
      <section className="panel chart-panel fees-today">
        <h3>Collected today</h3>
        {rows === null && !failed ? (
          <div className="fees-today-wait" aria-busy="true" />
        ) : failed && rows === null ? (
          <p className="row-sub">Couldn’t load today’s payments. Reload to try again.</p>
        ) : (
          <>
            <p className="fees-today-total">{rupees(total)}</p>
            <p className="row-sub fees-today-line">{[todays.length ? payments(todays.length) : "No payments yet", `Yesterday ${rupees(yesterday)}`].join(" · ")}</p>
            {byMode.length > 0 && (
              <ul className="fees-today-modes">
                {byMode.map(([m, amount]) => (
                  <li key={m}>
                    {METHODS[m]} <strong>{rupees(amount)}</strong>
                  </li>
                ))}
              </ul>
            )}
            {todays.length > 0 && (
              <ul className={`fees-today-list${showAll ? " is-all" : ""}`}>
                {(showAll ? todays : todays.slice(0, LATEST)).map((r) => {
                  const s = classOf.get(r.student_id);
                  return (
                    <li key={r.id}>
                      <button type="button" onClick={() => onOpenStudent?.(r.student_id, "fees")}>
                        <span className="inbox-main">
                          <strong>{r.student?.name ?? "Student"}</strong>
                          <span className="row-sub">{[s && gradeLabel(s.class), s?.section, METHODS[r.method] ?? r.method].filter(Boolean).join(" · ")}</span>
                        </span>
                        <strong className="fees-today-amount">{rupees(r.amount)}</strong>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {todays.length > LATEST && (
              <button type="button" className="link-btn fees-today-all" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show fewer" : `See all ${todays.length}`}
              </button>
            )}
          </>
        )}
      </section>
      <section className="panel chart-panel">
        <ColumnChart title="Last 7 days" data={week} rowLabel="Day" width={wide ? 560 : 320} height={wide ? 270 : 190} />
      </section>
    </div>
  );
}
