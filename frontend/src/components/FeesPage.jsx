import { useCallback, useEffect, useMemo, useState } from "react";
import { feeClassSummary, feeMonthlyCollection, feeSessionSummary } from "../data/api.js";
import { peek, swr } from "../data/cache.js";
import { rupees, rupeesShort } from "../data/money.js";
import { gradeLabel } from "./PersonCard.jsx";
import { gradeRank } from "./GradeFilter.jsx";
import { BarChart, ColumnChart } from "./charts.jsx";
import FeesToday from "./FeesToday.jsx";
import OpeningBalances from "./OpeningBalances.jsx";
import FeeReport from "./FeeReport.jsx";
import FeeStructure from "./FeeStructure.jsx";
import PaymentLog from "./PaymentLog.jsx";
import FeesTransport, { transportShownRows, useTransportPending } from "./FeesTransport.jsx";
import { downloadCsv } from "../data/exportCsv.js";
import FeesFilter, { NO_FEE_FILTER, feeFilterMatch, feeFilterOn } from "./FeesFilter.jsx";
import Icon from "./Icon.jsx";
import StatCards from "./StatCards.jsx";
import { AiCard, InsightsButton, useInsights } from "./AiInsights.jsx";

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

// Owners/admins: how fee collection is going, and the two reports. Owners also
// get Structure (what each grade pays).
// pastSession: a past session is open (picked on Students); say which.
// view, onView: which tab shows.
export default function FeesPage({ computerOnly = false, school, role, session, pastSession = false, students, routes = [], grades, onGradesChanged, onChanged, view: tab, onView: setTab, onCollect, onOpenStudent, refreshAt = 0, onOpened, editsFees = false, onStructureRequests }) {
  const [summary, setSummary] = useState(() => (session ? peek(`fees:summary:${session.id}`) ?? null : null));
  const [monthly, setMonthly] = useState(() => (session ? peek(`fees:monthly:${session.id}`) ?? [] : []));
  const [byClass, setByClass] = useState(() => (session ? peek(`fees:class:${session.id}`) ?? [] : []));
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState(null); // "balances"
  const [showAll, setShowAll] = useState(false);
  // The Overview's two tabs, and the Filter that applies to both lists
  const [feeTab, setFeeTab] = useState("monthly"); // "monthly" | "transport"
  const [filter, setFilter] = useState(NO_FEE_FILTER);
  const [transportScope, setTransportScope] = useState("now"); // "now" | "all"
  const [transportRoute, setTransportRoute] = useState(null);
  // Premium: the AI card above the charts, and short lines by the figures
  const ins = useInsights(school, "fees", (role === "owner" || role === "admin" || role === "principal") && !pastSession);
  // Transport dues on their own (the Overview's Transport tile and list)
  const transport = useTransportPending(school, tab === "overview" ? session : null, students, refreshAt);

  const load = useCallback(async () => {
    if (!session) return;
    // Each part loads on its own, so one slow chart doesn't blank the page.
    // Last numbers show at once; fresh ones replace them when they arrive.
    // A past session's charts only: the current one shows today and this week.
    const [s, m, c] = await Promise.allSettled([
      swr(`fees:summary:${session.id}`, () => feeSessionSummary(session.id), setSummary),
      pastSession ? swr(`fees:monthly:${session.id}`, () => feeMonthlyCollection(session.id), setMonthly) : [],
      pastSession ? swr(`fees:class:${session.id}`, () => feeClassSummary(session.id), setByClass) : [],
    ]);
    if (s.status === "fulfilled") setSummary(s.value);
    if (pastSession && m.status === "fulfilled") setMonthly(m.value);
    if (pastSession && c.status === "fulfilled") setByClass(c.value);
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
  }, [session, pastSession]);

  // The student list may have sat open for a while (another device took a fee)
  useEffect(() => {
    onOpened?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
          note: `${c.students_due} of ${c.students} student${Number(c.students) === 1 ? "" : "s"} ${Number(c.students_due) === 1 ? "owes" : "owe"} · collected ${rupees(c.collected)} of ${rupees(c.billed)}`,
        })),
    [byClass]
  );

  // Full-fee defaulters: something is due and nothing has been paid this session.
  // Both lists follow the Filter (grade, section, late only).
  const owing = useMemo(
    () => students.filter((s) => s.fee_due > 0 && feeFilterMatch(filter, s) && (!filter.late || s.fee_status === "overdue")).sort((a, b) => b.fee_due - a.fee_due),
    [students, filter]
  );
  const defaulters = useMemo(() => owing.filter((s) => !(s.fee_paid > 0)), [owing]);
  // Transport dues, filtered the same way (the tile keeps the whole school's)
  const transportShown = useMemo(
    () => transport && { ...transport, list: transport.list.filter((t) => feeFilterMatch(filter, t.student) && (!filter.late || t.late)) },
    [transport, filter]
  );

  if (!session) return <p className="notice">Import your students first; fees are tracked per session.</p>;

  const isOwner = role === "owner";
  // The page's name, and its buttons on the right
  const headerWith = (actions) => (
    <div className="page-header">
      <div>
        <div className="page-meta">
          <h1 className="page-title">{{ overview: "Overview", collection: "Report", class: "Class-wise", structure: "Fee structure", log: "Payment log" }[tab]}</h1>
          {pastSession && <span className="badge badge-neutral">Session {session.name}</span>}
        </div>
      </div>
      {actions}
    </div>
  );
  const header = headerWith(
    tab === "overview" && (
        <div className="page-actions">
          {(role === "owner" || role === "admin") && !pastSession && school.plan !== "premium" && <InsightsButton section="fees" />}
          {!computerOnly && (
            <button className="btn btn-secondary" onClick={() => setDialog("balances")}>
              <Icon name="upload" />
              Old balances
            </button>
          )}
          {onCollect && <button className="btn btn-primary" onClick={() => onCollect()}>
            <Icon name="plus" />
            Collect fee
          </button>}
        </div>
    )
  );

  // Reached with a link from elsewhere, or a window made narrow
  if (computerOnly && tab !== "overview")
    return (
      <>
        {headerWith(null)}
        <p className="notice">Open Godview on a computer to use this.</p>
      </>
    );

  if (tab === "collection" || tab === "class") return <FeeReport view={tab} school={school} session={session} students={students} header={headerWith} onOpenStudent={onOpenStudent} />;

  if (isOwner && tab === "log") return <PaymentLog school={school} header={headerWith} />;

  // Owners save straight away; admins who edit fees send changes for approval
  if ((isOwner || editsFees) && tab === "structure")
    return (
      <>
        {header}
        <FeeStructure
          school={school}
          session={session}
          grades={grades}
          onGradesChanged={onGradesChanged}
          students={students}
          approver={isOwner}
          onRequestsChanged={onStructureRequests}
          onChanged={() => {
            onChanged?.();
            load();
          }}
        />
      </>
    );

  const billed = Number(summary?.billed) || 0;
  const collected = Number(summary?.collected) || 0;
  const notSetUp = summary && billed === 0;
  const list = showAll ? owing : defaulters;

  // Export (owners): exactly the list on screen, with only name, roll no.,
  // class, a parent phone and what's pending. The Transport tab's list
  // follows its Due now / All pending switch and route too.
  const exportRows =
    feeTab === "monthly"
      ? list.map((s) => ({ s, amount: s.fee_due }))
      : (() => {
          const t = transportShownRows(transportShown, routes, transportScope, transportRoute);
          return t.shown.map((r) => ({ s: r.student, amount: t.amount(r) }));
        })();
  const downloadPending = () => {
    const what = feeTab === "monthly" ? (showAll ? "fees-pending" : "fees-paid-nothing") : "transport-pending";
    downloadCsv(
      ["Name", "Roll no.", "Class", "Phone", feeTab === "monthly" ? "Fee pending" : "Transport pending"],
      exportRows.map(({ s, amount }) => [
        s.name,
        s.roll_no,
        gradeLabel(s.class) + (s.section ? ` ${s.section}` : ""),
        s.parent_phone || s.father_phone || s.mother_phone,
        Math.round(Number(amount) * 100) / 100,
      ]),
      `${school.slug}-${what}-${new Date().toISOString().slice(0, 10)}.csv`
    );
  };
  // One tile: what's due now, with what's collected and what's still to come
  const tile = (
    <StatCards
      className="fees-tiles"
      items={[
        {
          label: "Due now",
          value: summary ? Number(summary.due_now) : undefined,
          format: rupeesShort,
          tone: "due",
          note: summary && (
            <span className="sw-facts">
              <span>{rupeesShort(collected)} collected</span>
              <span>{rupeesShort(Number(summary.outstanding) - Number(summary.due_now))} due later</span>
            </span>
          ),
        },
        transport &&
          transport.list.length > 0 && {
            label: "Transport due now",
            value: transport.now,
            format: rupeesShort,
            color: "teal",
            note: (
              <span className="sw-facts">
                <span>
                  {transport.owingNow} {transport.owingNow === 1 ? "student" : "students"}
                  {transport.late > 0 && ` · ${transport.late} late`}
                </span>
                <span>{rupeesShort(transport.later)} due later</span>
                <button
                  type="button"
                  className="link-btn sw-link"
                  onClick={() => {
                    setFeeTab("transport");
                    setTimeout(() => document.getElementById("fees-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                  }}
                >
                  See who owes
                </button>
              </span>
            ),
          },
      ]}
    />
  );

  return (
    <>
      {ins.on ? (
        <AiCard
          ins={ins}
          lead={tile}
          opens={isOwner && !computerOnly ? ["overdue", "class", "structure"] : ["overdue", "class"]}
          // A name opens that student's page (their fees are a tab there)
          onPerson={onOpenStudent}
          onOpen={(kind) => {
            if (kind === "structure") setTab("structure");
            else {
              setShowAll(true);
              setFeeTab("monthly");
              setFilter(NO_FEE_FILTER);
              setTimeout(() => document.getElementById("fees-owing")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
            }
          }}
        />
      ) : (
        tile
      )}

      {header}

      {error && <p className="notice notice-error">{error}</p>}

      {notSetUp && (
        <div className="callout fees-empty">
          <strong>No dues yet for {session.name}.</strong>{" "}
          {computerOnly && role === "owner" ? (
            "Set the fee for each grade in Fee structure on a computer. Collection figures appear here after that."
          ) : role === "owner" ? (
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

      {pastSession ? (
        <div className="fees-charts">
          <section className="panel chart-panel">
            <ColumnChart title="Collected by month" data={months} />
          </section>
          <section className="panel chart-panel">
            <BarChart title="Due by class" data={classes} valueLabel="Due now" />
          </section>
        </div>
      ) : (
        <FeesToday school={school} students={students} refreshAt={refreshAt} onOpenStudent={onOpenStudent} />
      )}

      <div className="fees-tabs-row" id="fees-tabs">
        <div className="tabs fees-tabs" role="tablist" aria-label="Which fees">
          {[
            ["monthly", "Monthly fee"],
            ["transport", "Transport"],
          ].map(([v, l]) => (
            <button key={v} type="button" role="tab" aria-selected={feeTab === v} className={feeTab === v ? "active" : ""} onClick={() => setFeeTab(v)}>
              {l}
            </button>
          ))}
        </div>
        <div className="fees-tabs-actions">
          <FeesFilter students={students} value={filter} onChange={setFilter} shown={feeTab === "monthly" ? list.length : transportShown?.list.length ?? 0} />
          {isOwner && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!exportRows.length}
              onClick={downloadPending}
              title={`Download ${exportRows.length} ${exportRows.length === 1 ? "student" : "students"}: name, roll no., class, phone and fee pending`}
            >
              <Icon name="download" />
              <span className="btn-label">Export</span>
            </button>
          )}
        </div>
      </div>

      {feeTab === "transport" ? (
        <FeesTransport
          pending={transportShown}
          routes={routes}
          filtered={feeFilterOn(filter) > 0}
          scope={transportScope}
          onScope={setTransportScope}
          routeId={transportRoute}
          onRoute={setTransportRoute}
          onOpenStudent={onOpenStudent} onCollect={onCollect} />
      ) : (
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
                  <button type="button" className="dues-open" onClick={() => onOpenStudent?.(s.id, "fees")}>
                    <strong>{s.name}</strong>
                    <span className="row-sub">
                      {s.admission_no} · {gradeLabel(s.class)}
                      {s.section ? ` · ${s.section}` : ""}
                      {s.fee_paid > 0 ? ` · paid ${rupees(s.fee_paid)}` : " · nothing paid"}
                    </span>
                  </button>
                  <span className={`badge ${s.fee_status === "overdue" ? "badge-danger" : "badge-warning"}`}>{rupees(s.fee_due)}</span>
                  {onCollect && <button className="btn btn-secondary btn-sm" onClick={() => onCollect(s)}>
                    Collect
                  </button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
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
