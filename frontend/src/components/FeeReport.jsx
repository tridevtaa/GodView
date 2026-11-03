import { useEffect, useMemo, useState } from "react";
import { feeCollection, listSessions } from "../data/api.js";
import { downloadCsv } from "../data/exportCsv.js";
import { METHODS, rupees } from "../data/money.js";
import FeeClassReport from "./FeeClassReport.jsx";
import StatCards from "./StatCards.jsx";
import { classOf } from "./StudentPicker.jsx";
import Icon from "./Icon.jsx";

// Fees > Reports: Collection, money received in a period by payment mode
// (cancelled payments don't count), or Class-wise (FeeClassReport.jsx).
// header: the page's switch, under the total.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shortDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const SHOW = 100;

export default function FeeReport(props) {
  const [view, setView] = useState("collection");
  const tabs = (
    <nav className="segmented segmented-sm report-switch" aria-label="Report">
      {[["collection", "Collection"], ["class", "Class-wise"]].map(([v, l]) => (
        <button key={v} className={view === v ? "active" : ""} onClick={() => setView(v)}>
          {l}
        </button>
      ))}
    </nav>
  );
  return view === "class" ? <FeeClassReport {...props} tabs={tabs} /> : <Collection {...props} tabs={tabs} />;
}

function Collection({ school, session, students, header, tabs, onOpenStudent }) {
  const [sessions, setSessions] = useState([]);
  useEffect(() => {
    listSessions(school.id).then(setSessions, () => {});
  }, [school.id]);

  const periods = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const today = iso(now);
    const earlier = sessions.filter((s) => s.starts_on && session?.starts_on && s.starts_on < session.starts_on).sort((a, b) => b.starts_on.localeCompare(a.starts_on))[0];
    return [
      ["today", "Today", today, today],
      ["month", "This month", iso(new Date(y, m, 1)), today],
      ["last", "Last month", iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))],
      session?.starts_on && ["session", `This session`, session.starts_on, today],
      earlier && ["earlier", earlier.name, earlier.starts_on, earlier.ends_on],
    ].filter(Boolean);
  }, [sessions, session]);

  const [period, setPeriod] = useState("month");
  const chosen = periods.find((p) => p[0] === period) ?? periods[1];
  const [from, setFrom] = useState(chosen[2]);
  const [to, setTo] = useState(chosen[3]);
  const pick = (p) => {
    setPeriod(p[0]);
    setFrom(p[2]);
    setTo(p[3]);
  };
  const custom = (set) => (e) => {
    setPeriod("custom");
    set(e.target.value);
  };

  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const backwards = from && to && from > to;
  useEffect(() => {
    if (!from || !to || backwards) return;
    let stale = false;
    setRows(null);
    setError("");
    feeCollection(school.id, from, to).then(
      (r) => !stale && setRows(r),
      () => !stale && (setRows([]), setError("Couldn’t load the report. Try again."))
    );
    return () => {
      stale = true;
    };
  }, [school.id, from, to, backwards]);

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

  const line = (p) => [shortDate(p.paid_on), METHODS[p.method] ?? p.method, klass(p), p.receipt_no].filter(Boolean).join(" · ");

  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [from, to, modes]);
  const shown = more ? list : list.slice(0, SHOW);

  function download() {
    const title = shownModes.length === used.length ? "all-modes" : shownModes.join("-");
    downloadCsv(
      ["Date", "Receipt no.", "Student", "Reg no.", "Class", "Mode", "Reference", "Received by", "Amount"],
      [
        ...list.map((p) => [p.paid_on, p.receipt_no, p.student?.name, p.student?.admission_no, klass(p), METHODS[p.method] ?? p.method, p.reference, p.received_by, Number(p.amount)]),
        ["Total", "", "", "", "", "", "", "", total],
      ],
      `${school.slug}-fee-collection-${from}-to-${to}-${title}.csv`
    );
  }

  const label = chosen && period !== "custom" ? `Collected: ${chosen[1].toLowerCase()}` : "Collected";
  return (
    <>
      <StatCards
        items={[
          {
            color: "green",
            label: period === "earlier" ? `Collected: ${chosen[1]}` : label,
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
      {header}

      <div className="report-filters">
        {tabs}
        <div className="filter-chips">
          {periods.map((p) => (
            <button key={p[0]} type="button" className={`chip-btn${period === p[0] ? " is-on" : ""}`} onClick={() => pick(p)}>
              {p[1]}
            </button>
          ))}
          <span className="report-dates">
            <input className="input" type="date" value={from} max={to || undefined} onChange={custom(setFrom)} aria-label="From" />
            <span className="row-sub">to</span>
            <input className="input" type="date" value={to} min={from || undefined} onChange={custom(setTo)} aria-label="To" />
          </span>
        </div>
        {(used.length > 1 || modes.length > 0) && (
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
        )}
      </div>

      {error && <p className="notice notice-error">{error}</p>}
      {backwards ? (
        <p className="notice">The start date is after the end date.</p>
      ) : rows === null ? (
        <div className="card card-skeleton att-skeleton" aria-busy="true" />
      ) : !count ? (
        <p className="notice">No payments in this period.</p>
      ) : (
        <section className="panel report-panel">
          <div className="panel-title panel-title-row">
            <h2>Payments</h2>
            <button type="button" className="btn btn-secondary btn-sm" onClick={download}>
              <Icon name="download" /> Download
            </button>
          </div>
          <ul className="payment-list report-list">
            {shown.map((p) => (
              <li key={p.id}>
                {/* Someone no longer in this session has no page to open here */}
                {byId.has(p.student_id) && onOpenStudent ? (
                  <button type="button" className="dues-open" onClick={() => onOpenStudent(p.student_id, "fees")}>
                    <strong>{p.student?.name ?? "Student"}</strong>
                    <span className="row-sub">{line(p)}</span>
                  </button>
                ) : (
                  <div>
                    <strong>{p.student?.name ?? "Student"}</strong>
                    <span className="row-sub">{line(p)}</span>
                  </div>
                )}
                <strong>{rupees(p.amount)}</strong>
              </li>
            ))}
          </ul>
          {list.length > shown.length && (
            <button type="button" className="link-btn report-more" onClick={() => setMore(true)}>
              Show all {list.length.toLocaleString("en-IN")}
            </button>
          )}
        </section>
      )}
    </>
  );
}
