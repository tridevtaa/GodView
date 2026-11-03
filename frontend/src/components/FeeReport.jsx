import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { feeCollection, listSessions } from "../data/api.js";
import { downloadCsv } from "../data/exportCsv.js";
import { METHODS, rupees } from "../data/money.js";
import FeeClassReport from "./FeeClassReport.jsx";
import StatCards from "./StatCards.jsx";
import { classOf } from "./StudentPicker.jsx";
import Icon from "./Icon.jsx";

// Fees' two reports: Collection, money received in a period by payment mode
// (cancelled payments don't count), or Class-wise (FeeClassReport.jsx).
// header(buttons): the page's name with its buttons, under the total.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayMonth = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
// "Tue, 3 Nov", with the year when it isn't this one
const dayName = (d) => {
  const when = new Date(`${d}T12:00:00`);
  const options = { weekday: "short", day: "numeric", month: "short" };
  if (when.getFullYear() !== new Date().getFullYear()) options.year = "numeric";
  return when.toLocaleDateString("en-IN", options);
};
const SHOW = 100;

export default function FeeReport({ view, ...props }) {
  return view === "class" ? <FeeClassReport {...props} /> : <Collection {...props} />;
}

// Collection: the money received in a period, day by day. The period and modes
// sit behind one button, so the payments start high up on the page.
function Collection({ school, session, students, header, onOpenStudent }) {
  const [sessions, setSessions] = useState([]);
  useEffect(() => {
    listSessions(school.id).then(setSessions, () => {});
  }, [school.id]);

  const periods = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const today = iso(now);
    const yesterday = iso(new Date(y, m, now.getDate() - 1));
    const earlier = sessions.filter((s) => s.starts_on && session?.starts_on && s.starts_on < session.starts_on).sort((a, b) => b.starts_on.localeCompare(a.starts_on))[0];
    return [
      ["today", "Today", today, today],
      ["yesterday", "Yesterday", yesterday, yesterday],
      ["month", "This month", iso(new Date(y, m, 1)), today],
      ["last", "Last month", iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))],
      session?.starts_on && ["session", "This session", session.starts_on, today],
      earlier && ["earlier", earlier.name, earlier.starts_on, earlier.ends_on],
    ].filter(Boolean);
  }, [sessions, session]);

  const [period, setPeriod] = useState("month");
  const chosen = periods.find((p) => p[0] === period);
  const start = periods.find((p) => p[0] === "month");
  const [from, setFrom] = useState(start[2]);
  const [to, setTo] = useState(start[3]);
  const pick = (p) => {
    setPeriod(p[0]);
    setFrom(p[2]);
    setTo(p[3]);
  };

  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const backwards = from && to && from > to;
  useEffect(() => {
    if (!from || !to || backwards) return;
    let stale = false;
    setRows(null);
    setError(false);
    feeCollection(school.id, from, to).then(
      (r) => !stale && setRows(r),
      () => !stale && setError(true)
    );
    return () => {
      stale = true;
    };
  }, [school.id, from, to, backwards, attempt]);

  // Modes: none picked means all. Only modes used in this period show.
  const [modes, setModes] = useState([]);
  const used = Object.keys(METHODS).filter((k) => (rows ?? []).some((p) => p.method === k));
  const shownModes = used.filter((k) => !modes.length || modes.includes(k));
  const toggle = (k) => setModes((m) => (m.includes(k) ? m.filter((x) => x !== k) : [...m, k]));
  const list = useMemo(() => (rows ?? []).filter((p) => !modes.length || modes.includes(p.method)), [rows, modes]);
  const sum = (xs) => xs.reduce((t, p) => t + Number(p.amount), 0);
  const total = sum(list);
  const count = list.length;
  const byId = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const klass = (p) => (byId.has(p.student_id) ? classOf(byId.get(p.student_id)) : "");
  const modeName = (p) => METHODS[p.method] ?? p.method;

  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [from, to, modes]);
  const shown = more ? list : list.slice(0, SHOW);
  // Day by day, newest first; each day's total counts all of that day.
  const days = useMemo(() => {
    const totals = new Map();
    for (const p of list) totals.set(p.paid_on, (totals.get(p.paid_on) ?? 0) + Number(p.amount));
    const groups = new Map();
    for (const p of shown) {
      if (!groups.has(p.paid_on)) groups.set(p.paid_on, []);
      groups.get(p.paid_on).push(p);
    }
    return [...groups].map(([day, payments]) => ({ day, payments, total: totals.get(day) }));
  }, [list, shown]);

  function download() {
    const title = shownModes.length === used.length ? "all-modes" : shownModes.join("-");
    downloadCsv(
      ["Date", "Receipt no.", "Student", "Reg no.", "Class", "Mode", "Reference", "Received by", "Amount"],
      [
        ...list.map((p) => [p.paid_on, p.receipt_no, p.student?.name, p.student?.admission_no, klass(p), modeName(p), p.reference, p.received_by, Number(p.amount)]),
        ["Total", "", "", "", "", "", "", "", total],
      ],
      `${school.slug}-fee-collection-${from}-to-${to}-${title}.csv`
    );
  }

  const [filtering, setFiltering] = useState(false);
  useEffect(() => {
    if (!filtering) return;
    const onKey = (e) => e.key === "Escape" && setFiltering(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [filtering]);
  const periodWords = chosen ? chosen[1] : from && to ? `${dayMonth(from)} to ${dayMonth(to)}` : "Pick dates";
  const modeWords = modes.length === 1 ? ` · ${METHODS[modes[0]]}` : modes.length > 1 ? ` · ${modes.length} modes` : "";

  const actions = (
    <div className="page-actions report-actions">
      <button type="button" className={`btn btn-secondary report-filter${period !== "month" || modes.length ? " is-active" : ""}`} aria-haspopup="dialog" onClick={() => setFiltering(true)}>
        <Icon name="filter" />
        <span>
          {periodWords}
          {modeWords}
        </span>
      </button>
      <button type="button" className="btn btn-secondary report-download" onClick={download} disabled={!count} aria-label="Download" title="Download">
        <Icon name="download" />
      </button>
    </div>
  );

  return (
    <>
      {!error && (
        <StatCards
          items={[
            {
              color: "green",
              label: chosen ? `Collected: ${chosen[0] === "earlier" ? chosen[1] : chosen[1].toLowerCase()}` : "Collected",
              value: rows === null ? undefined : rupees(total),
              note: rows !== null && (
                <span className="sw-facts">
                  <span>
                    {count.toLocaleString("en-IN")} {count === 1 ? "payment" : "payments"}
                  </span>
                  {shownModes.map((k) => (
                    <span key={k}>
                      {METHODS[k]} {rupees(sum(list.filter((p) => p.method === k)))}
                    </span>
                  ))}
                </span>
              ),
            },
          ]}
        />
      )}
      {header(actions)}

      {error ? (
        <div className="notice notice-error report-retry">
          <span>Couldn’t load the payments.</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      ) : backwards ? (
        <p className="notice">The start date is after the end date.</p>
      ) : rows === null ? (
        <div className="card card-skeleton att-skeleton" aria-busy="true" />
      ) : !count ? (
        <p className="notice">No payments in this period.</p>
      ) : (
        <section className="panel report-panel">
          {days.map(({ day, payments, total: dayTotal }) => (
            <div key={day} className="report-day">
              <h3>
                <span>{dayName(day)}</span>
                <span>{rupees(dayTotal)}</span>
              </h3>
              <ul>
                {payments.map((p) => {
                  const body = (
                    <>
                      <span className="report-who">
                        <strong>{p.student?.name ?? "Student"}</strong>
                        <span className="row-sub">
                          {klass(p)}
                          <span className="report-inline-mode">
                            {klass(p) ? " · " : ""}
                            {modeName(p)}
                          </span>
                        </span>
                      </span>
                      <span className="report-mode">{modeName(p)}</span>
                      <span className="report-receipt">{p.receipt_no}</span>
                      <strong className="report-amount">{rupees(p.amount)}</strong>
                    </>
                  );
                  return (
                    <li key={p.id}>
                      {/* Someone no longer in this session has no page to open here */}
                      {byId.has(p.student_id) && onOpenStudent ? (
                        <button type="button" className="report-row" onClick={() => onOpenStudent(p.student_id, "fees")}>
                          {body}
                        </button>
                      ) : (
                        <div className="report-row">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {list.length > shown.length && (
            <button type="button" className="link-btn report-more" onClick={() => setMore(true)}>
              Show all {list.length.toLocaleString("en-IN")}
            </button>
          )}
        </section>
      )}

      {filtering &&
        createPortal(
          <div className="filter-back" onMouseDown={(e) => e.target === e.currentTarget && setFiltering(false)}>
            <section className="filter-sheet" role="dialog" aria-modal="true" aria-label="Filter payments">
              <header className="filter-head">
                <h2>Filter payments</h2>
                <button type="button" className="btn-icon" onClick={() => setFiltering(false)} aria-label="Close" title="Close">
                  <Icon name="x" size={18} />
                </button>
              </header>
              <div className="filter-body">
                <h3>Period</h3>
                <div className="filter-chips">
                  {periods.map((p) => (
                    <button key={p[0]} type="button" className={`chip-btn${period === p[0] ? " is-on" : ""}`} onClick={() => pick(p)}>
                      {p[1]}
                    </button>
                  ))}
                  <button type="button" className={`chip-btn${period === "custom" ? " is-on" : ""}`} onClick={() => setPeriod("custom")}>
                    Custom dates
                  </button>
                </div>
                {period === "custom" && (
                  <div className="report-dates">
                    <input className="input" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
                    <span className="row-sub">to</span>
                    <input className="input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To" />
                  </div>
                )}
                {(used.length > 1 || modes.length > 0) && (
                  <>
                    <h3>Payment mode</h3>
                    <div className="filter-chips">
                      <button type="button" className={`chip-btn${modes.length ? "" : " is-on"}`} onClick={() => setModes([])}>
                        All modes
                      </button>
                      {used.map((k) => (
                        <button key={k} type="button" className={`chip-btn${modes.includes(k) ? " is-on" : ""}`} onClick={() => toggle(k)} aria-pressed={modes.includes(k)}>
                          {METHODS[k]}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <footer className="filter-foot">
                <button type="button" className="link-btn" onClick={() => (pick(start), setModes([]))} disabled={period === "month" && !modes.length}>
                  Reset
                </button>
                <button type="button" className="btn btn-primary" onClick={() => setFiltering(false)}>
                  {rows === null ? "Show payments" : `Show ${count.toLocaleString("en-IN")} ${count === 1 ? "payment" : "payments"}`}
                </button>
              </footer>
            </section>
          </div>,
          document.body
        )}
    </>
  );
}
