import { useCallback, useEffect, useMemo, useState } from "react";
import { feeClassSummary, feeMonthlyCollection, feeSessionSummary } from "../data/api.js";
import { peek, remember, swr } from "../data/cache.js";
import { rupees, rupeesShort } from "../data/money.js";
import { gradeLabel } from "./PersonCard.jsx";
import { gradeRank } from "./GradeFilter.jsx";
import { BarChart, ColumnChart } from "./charts.jsx";
import OpeningBalances from "./OpeningBalances.jsx";
import FeeStructure from "./FeeStructure.jsx";
import Icon from "./Icon.jsx";
import StatCards from "./StatCards.jsx";
import { InsightsButton, InsightsPanel } from "./FeeInsights.jsx";

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
// pastSession: a past session is open (picked on Students); say which.
// heading: the Students section switch, shown first in the header.
export default function FeesPage({ school, role, session, pastSession = false, students, grades, onGradesChanged, onChanged, heading, onCollect, refreshAt = 0 }) {
  const [tab, setTab] = useState("overview");
  const [summary, setSummary] = useState(() => (session ? peek(`fees:summary:${session.id}`) ?? null : null));
  const [monthly, setMonthly] = useState(() => (session ? peek(`fees:monthly:${session.id}`) ?? [] : []));
  const [byClass, setByClass] = useState(() => (session ? peek(`fees:class:${session.id}`) ?? [] : []));
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState(null); // "balances"
  const [showAll, setShowAll] = useState(false);
  const [insights, setInsights] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    // Each part loads on its own, so one slow chart doesn't blank the page.
    // Last numbers show at once; fresh ones replace them when they arrive.
    const [s, m, c] = await Promise.allSettled([
      swr(`fees:summary:${session.id}`, () => feeSessionSummary(session.id), setSummary),
      swr(`fees:monthly:${session.id}`, () => feeMonthlyCollection(session.id), setMonthly),
      swr(`fees:class:${session.id}`, () => feeClassSummary(session.id), setByClass),
    ]);
    if (s.status === "fulfilled") setSummary(s.value);
    if (m.status === "fulfilled") setMonthly(m.value);
    if (c.status === "fulfilled") setByClass(c.value);
    const err = [s, m, c].find((r) => r.status === "rejected")?.reason;
    setError(
      !err
        ? ""
        : err.code === "PGRST205" || err.code === "PGRST202"
          ? "Fee analytics aren’t set up in the database yet. The latest database update needs to be applied first."
          : err.code === "57014"
            ? "Some fee figures took too long to work out. Reload to try again."
            : `Couldn’t load some fee figures (${err.code || err.message || "network"}). Reload to try again.`
    );
  }, [session]);

  // Again after a payment (refreshAt), so the figures move at once.
  useEffect(() => {
    load();
  }, [load, refreshAt]);

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
          {heading}
          {isOwner && (
            <nav className="segmented segmented-sm" aria-label="Fee sections">
              {[["overview", "Overview"], ["structure", "Fee structure"]].map(([v, l]) => (
                <button key={v} className={tab === v ? "active" : ""} onClick={() => setTab(v)}>
                  {l}
                </button>
              ))}
            </nav>
          )}
          {pastSession && <span className="badge badge-neutral">Session {session.name}</span>}
        </div>
      </div>
      {tab === "overview" && (
        <div className="page-actions">
          {(role === "owner" || role === "admin") && !pastSession && <InsightsButton school={school} onOpen={() => setInsights(true)} />}
          <button className="btn btn-secondary" onClick={() => setDialog("balances")}>
            <Icon name="upload" />
            Old balances
          </button>
          <button className="btn btn-primary" onClick={() => onCollect()}>
            <Icon name="plus" />
            Collect fee
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

      <StatCards
        items={[
          {
            icon: "rupee",
            label: "Collected",
            value: summary ? Number(summary.collected) : undefined,
            format: rupeesShort,
            tone: "paid",
            bar: billed ? { value: collected, max: billed, label: `${rate}% of ${rupees(billed)}` } : undefined,
          },
          {
            icon: "rupee",
            label: "Due now",
            value: summary ? Number(summary.due_now) : undefined,
            format: rupeesShort,
            tone: "due",
            badge: summary ? Number(summary.students_due) : 0,
            badgeLabel: `${summary?.students_due ?? 0} students owe`,
          },
          { icon: "calendar", color: "indigo", label: "Due later", value: summary ? Number(summary.outstanding) - Number(summary.due_now) : undefined, format: rupeesShort },
        ]}
      />

      <div className="fees-charts">
        <section className="panel chart-panel">
          <ColumnChart title="Collected by month" data={months} />
        </section>
        <section className="panel chart-panel">
          <BarChart title="Due by class" data={classes} valueLabel="Due now" />
        </section>
      </div>

      {insights && (
        <InsightsPanel
          school={school}
          canOpenStructure={isOwner}
          onClose={() => setInsights(false)}
          onCollect={(id) => {
            const s = students.find((x) => x.id === id);
            if (s) {
              setInsights(false);
              onCollect(s);
            }
          }}
          onOpen={(kind) => {
            setInsights(false);
            if (kind === "structure") setTab("structure");
            else {
              setShowAll(true);
              setTimeout(() => document.getElementById("fees-owing")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
            }
          }}
        />
      )}

      <section className="panel" id="fees-owing">
        <div className="panel-title panel-title-row">
          <h2>
            {showAll ? "Everyone who owes" : "Paid nothing yet"} <span className="badge badge-danger">{list.length}</span>
          </h2>
          <button className="link-btn" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Paid nothing yet" : `Everyone who owes (${owing.length})`}
          </button>
        </div>
        {list.length === 0 ? (
          <p className="row-sub panel-empty">{showAll ? "Nobody owes anything right now. 🎉" : "Everyone has paid something. 🎉"}</p>
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
                  <button className="btn btn-secondary btn-sm" onClick={() => onCollect(s)}>
                    Collect
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

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
