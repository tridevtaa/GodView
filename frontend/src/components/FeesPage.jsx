import { useCallback, useEffect, useMemo, useState } from "react";
import { feeClassSummary, feeMonthlyCollection, feeSessionSummary } from "../data/api.js";
import { rupees } from "../data/money.js";
import { gradeLabel } from "./PersonCard.jsx";
import { gradeRank } from "./GradeFilter.jsx";
import { BarChart, ColumnChart } from "./charts.jsx";
import OpeningBalances from "./OpeningBalances.jsx";
import FeeStructure from "./FeeStructure.jsx";
import Icon from "./Icon.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The session's 12 months, April to March, as "YYYY-MM" keys.
function sessionMonths(session) {
  const start = Number((session.starts_on ?? session.name).slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((3 + i) % 12) + 1;
    const y = start + (m < 4 ? 1 : 0);
    return { key: `${y}-${String(m).padStart(2, "0")}`, short: MONTHS[m - 1], label: `${MONTHS[m - 1]} ${y}` };
  });
}

// Owners/admins: how fee collection is going. Setting fees up lives on the
// Owner page (Fee structure).
// Owners get two tabs: Overview (collection) and Structure (what each grade
// pays). Admins see the overview only.
export default function FeesPage({ school, role, session, students, grades, onGradesChanged, onOpenStudent, onChanged }) {
  const [tab, setTab] = useState("overview");
  const [summary, setSummary] = useState(null);
  const [monthly, setMonthly] = useState([]);
  const [byClass, setByClass] = useState([]);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState(null); // "collect" | "balances"
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const [s, m, c] = await Promise.all([feeSessionSummary(session.id), feeMonthlyCollection(session.id), feeClassSummary(session.id)]);
      setSummary(s);
      setMonthly(m);
      setByClass(c);
      setError("");
    } catch (err) {
      setError(
        err?.code === "PGRST205" || err?.code === "PGRST202"
          ? "Fee analytics aren’t set up in the database yet. The latest database update needs to be applied first."
          : "Couldn’t load fees. Check your connection and try again."
      );
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  const months = useMemo(() => {
    if (!session) return [];
    const got = new Map(monthly.map((r) => [String(r.month).slice(0, 7), r]));
    return sessionMonths(session).map((m) => ({
      ...m,
      value: Number(got.get(m.key)?.amount ?? 0),
      note: got.get(m.key) ? `${got.get(m.key).payments} payments` : "No payments",
    }));
  }, [monthly, session]);

  const classes = useMemo(
    () =>
      [...byClass]
        .sort((a, b) => gradeRank(a.class) - gradeRank(b.class))
        .map((c) => ({
          key: c.class,
          label: gradeLabel(c.class),
          value: Number(c.due_now),
          note: `${c.students_due} of ${c.students} students owe · collected ${rupees(c.collected)} of ${rupees(c.billed)}`,
        })),
    [byClass]
  );

  // Full-fee defaulters: something is due and nothing has been paid this session.
  const defaulters = useMemo(
    () => students.filter((s) => s.fee_due > 0 && !(s.fee_paid > 0)).sort((a, b) => b.fee_due - a.fee_due),
    [students]
  );
  const owing = useMemo(() => students.filter((s) => s.fee_due > 0).sort((a, b) => b.fee_due - a.fee_due), [students]);

  if (!session) return <p className="notice">Import your students first; fees are tracked per session.</p>;

  const isOwner = role === "owner";
  const header = (
    <div className="page-header">
      <div>
        <h1 className="sr-only">Fees</h1>
        <div className="page-meta">
          <span className="page-count">Fees</span>
          {isOwner && (
            <nav className="segmented segmented-sm" aria-label="Fee sections">
              {[["overview", "Overview"], ["structure", "Fee structure"]].map(([v, l]) => (
                <button key={v} className={tab === v ? "active" : ""} onClick={() => setTab(v)}>
                  {l}
                </button>
              ))}
            </nav>
          )}
          <span className="badge badge-neutral">Session {session.name}</span>
        </div>
      </div>
      {tab === "overview" && (
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => setDialog("balances")}>
            <Icon name="upload" />
            Old balances
          </button>
          <button className="btn btn-primary" onClick={() => setDialog("collect")}>
            <Icon name="plus" />
            Collect a payment
          </button>
        </div>
      )}
    </div>
  );

  if (isOwner && tab === "structure")
    return (
      <>
        {header}
        <FeeStructure
          school={school}
          session={session}
          grades={grades}
          onGradesChanged={onGradesChanged}
          students={students}
          onChanged={() => {
            onChanged?.();
            load();
          }}
        />
      </>
    );

  const billed = Number(summary?.billed) || 0;
  const collected = Number(summary?.collected) || 0;
  const rate = billed > 0 ? Math.round((collected / billed) * 100) : 0;
  const notSetUp = summary && billed === 0;
  const list = showAll ? owing : defaulters;

  return (
    <>
      {header}

      {error && <p className="notice notice-error">{error}</p>}

      {notSetUp && (
        <div className="callout fees-empty">
          <strong>No dues yet for {session.name}.</strong>{" "}
          {role === "owner" ? (
            <>
              Set the fee for each grade in{" "}
              <button className="link-btn" onClick={() => setTab("structure")}>
                Fee structure
              </button>{" "}
              and create the dues. Collection figures appear here after that.
            </>
          ) : (
            "The school owner sets up the fee structure. Collection figures appear here after that."
          )}
        </div>
      )}

      <section className="fee-cards">
        <Stat label="Collected so far" value={summary?.collected} tone="paid" note={billed ? `${rate}% of the year’s fees` : ""} />
        <Stat label="Total dues now" value={summary?.due_now} tone="due" note={summary ? `${summary.students_due} students` : ""} />
        <Stat label="Expected this year" value={summary?.billed} />
        <Stat label="Still to come" value={summary ? summary.outstanding - summary.due_now : undefined} note="Not due yet" />
      </section>

      <div className="fees-charts">
        <section className="panel chart-panel">
          <ColumnChart title="Collection, month by month" subtitle={`Payments received, Apr to Mar, ${session.name}`} data={months} />
        </section>
        <section className="panel chart-panel">
          <BarChart title="Dues by class" subtitle="Amount due by today, per class" data={classes} valueLabel="Due now" />
        </section>
      </div>

      <section className="panel">
        <div className="panel-title panel-title-row">
          <h2>
            {showAll ? "Everyone who owes" : "Full-fee defaulters"} <span className="badge badge-danger">{list.length}</span>
          </h2>
          <button className="link-btn" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show full-fee defaulters only" : `Show everyone who owes (${owing.length})`}
          </button>
        </div>
        {!showAll && <p className="row-sub panel-help">Students with fees due who haven’t paid anything this session.</p>}
        {list.length === 0 ? (
          <p className="row-sub panel-empty">{showAll ? "Nobody owes anything right now. 🎉" : "No full-fee defaulters. 🎉"}</p>
        ) : (
          <ul className="dues-list">
            {list.slice(0, 300).map((s) => (
              <li key={s.id}>
                <div className="dues-row">
                  <span>
                    <strong>{s.name}</strong>
                    <span className="row-sub">
                      {s.admission_no} · {gradeLabel(s.class)}
                      {s.section ? ` · ${s.section}` : ""}
                      {s.fee_paid > 0 ? ` · paid ${rupees(s.fee_paid)}` : " · nothing paid"}
                    </span>
                  </span>
                  <span className={`badge ${s.fee_status === "overdue" ? "badge-danger" : "badge-warning"}`}>{rupees(s.fee_due)}</span>
                  <button className="btn btn-secondary btn-sm" onClick={() => onOpenStudent(s.id, "fees")}>
                    Collect
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dialog === "collect" && (
        <Dialog title="Collect a payment" onClose={() => setDialog(null)}>
          <StudentPicker
            students={students}
            onPick={(s) => {
              setDialog(null);
              onOpenStudent(s.id, "fees");
            }}
          />
        </Dialog>
      )}
      {dialog === "balances" && (
        <Dialog title="Bring in old balances" onClose={() => setDialog(null)}>
          <OpeningBalances
            embedded
            school={school}
            session={session}
            students={students}
            onDone={async () => {
              await load();
              onChanged();
            }}
          />
        </Dialog>
      )}
    </>
  );
}

function Stat({ label, value, tone, note }) {
  return (
    <div className="fee-card">
      <span>{label}</span>
      <strong className={tone ? `is-${tone}` : ""}>{value === undefined ? "…" : rupees(value)}</strong>
      {note && <span className="row-sub">{note}</span>}
    </div>
  );
}

function Dialog({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

function StudentPicker({ students, onPick }) {
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return students
      .filter((s) => `${s.name} ${s.admission_no} ${s.parent_name ?? ""} ${s.parent_phone ?? ""}`.toLowerCase().includes(t))
      .slice(0, 8);
  }, [students, q]);
  return (
    <div className="picker">
      <label className="search">
        <Icon name="search" />
        <input autoFocus placeholder="Student name, admission no. or parent’s phone" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <ul className="picker-list">
        {matches.map((s) => (
          <li key={s.id}>
            <button onClick={() => onPick(s)}>
              <span>
                <strong>{s.name}</strong>
                <span className="row-sub">
                  {s.admission_no} · {gradeLabel(s.class)}
                  {s.section ? ` · ${s.section}` : ""}
                </span>
              </span>
              {s.fee_due > 0 ? <span className="badge badge-warning">{rupees(s.fee_due)} due</span> : <span className="badge badge-success">Nothing due</span>}
            </button>
          </li>
        ))}
        {q && matches.length === 0 && <li className="row-sub picker-empty">No student found.</li>}
      </ul>
    </div>
  );
}
