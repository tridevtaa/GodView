import { useEffect, useState } from "react";
import { latestInsight, runInsight } from "../data/api.js";
import { rupees } from "../data/money.js";
import Icon from "./Icon.jsx";
import { useDismiss } from "./useDismiss.js";

// AI insights (Premium) on Fees, Transport and Results. The button opens a
// panel with the last analysis; "Analyse again" runs a new one. Other
// plans see the button locked, with one line on what it does.

const LIMIT = 30; // a month for each section; the edge function has the same

const COPY = {
  fees: {
    title: "Fee insights",
    locked: "AI reads your fee figures and tells you what needs attention and how to collect faster.",
    empty: "See what needs your attention in fee collection: which classes lag, who to call first, and how to get paid sooner.",
    running: "Reading this session’s fee figures.",
    person: "Collect",
  },
  transport: {
    title: "Transport insights",
    locked: "AI reads where students live and your routes and buses, and suggests new stops or routes and what to fix.",
    empty: "See where a new stop or route would help, which routes are too full or too empty, and which bus papers need renewing.",
    running: "Reading your villages, routes and buses.",
    person: null,
  },
  results: {
    title: "Results insights",
    locked: "AI reads this session’s exam results and points out weak subjects, classes and students who need help.",
    empty: "See which subjects and classes need help, which students are falling behind, and who is doing well.",
    running: "Reading this session’s exam results.",
    person: "Open",
  },
};
const OPEN_LABEL = {
  overdue: "See who owes",
  class: "See who owes",
  structure: "Open fee structure",
  routes: "Go to routes",
  buses: "Go to buses",
  map: "Open the map",
  students: "Go to students",
  marks: "Enter marks",
};
const ERRORS = {
  premium: "Insights are part of the Premium plan.",
  limit: `You’ve used all ${LIMIT} analyses this month. More next month.`,
  busy: "The AI is busy right now. Try again in a minute.",
  not_allowed: "Only the owner and admins can run this.",
  no_data: "There isn’t enough data yet to analyse.",
  ai_failed: "The analysis didn’t go through. Try again.",
};
const ago = (t) => {
  const m = Math.max(1, Math.round((Date.now() - new Date(t)) / 6e4));
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

export function InsightsButton({ school, section, label = "Insights", onOpen }) {
  const [locked, setLocked] = useState(false);
  const ref = useDismiss(locked, () => setLocked(false));
  const premium = school.plan === "premium";
  return (
    <span className="ai-btn-wrap" ref={ref}>
      <button className={`btn ai-btn${premium ? "" : " is-locked"}`} onClick={() => (premium ? onOpen() : setLocked((v) => !v))} aria-expanded={premium ? undefined : locked}>
        <Icon name={premium ? "sparkle" : "lock"} weight="fill" />
        {label}
        {!premium && <span className="ai-tag">Premium</span>}
      </button>
      {locked && (
        <span className="ai-locked" role="status">
          {COPY[section].locked} Available on the Premium plan.
        </span>
      )}
    </span>
  );
}

// onOpen(kind, insight): go to the screen an insight points at (kinds the
// page can't open are left out via `opens`). onPerson(id): a named student.
export function InsightsPanel({ school, section, opens = [], onClose, onOpen, onPerson }) {
  const copy = COPY[section];
  const [data, setData] = useState(null); // { insight, used }
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    latestInsight(school.id, section)
      .then(setData)
      .catch(() => setData({ insight: null, used: 0 }));
  }, [school.id, section]);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !running && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  async function run() {
    setRunning(true);
    setError("");
    try {
      const res = await runInsight(school.id, section);
      setData((d) => ({ insight: res.insight, used: (d?.used ?? 0) + 1 }));
    } catch (err) {
      setError(ERRORS[err.code] ?? ERRORS.ai_failed);
    }
    setRunning(false);
  }

  const insight = data?.insight;
  const left = Math.max(0, LIMIT - (data?.used ?? 0));
  const items = insight?.result?.insights ?? [];
  // Older fee results kept class and amount instead of a line
  const lineOf = (p) => p.line ?? [p.class, p.overdue != null ? rupees(p.overdue) : null].filter(Boolean).join(" · ");

  return (
    <div className="modal-backdrop" onClick={() => !running && onClose()}>
      <section className="modal ai-modal" role="dialog" aria-modal="true" aria-label={copy.title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <Icon name="sparkle" weight="fill" /> {copy.title}
          </h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close" disabled={running}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body ai-body">
          <div className="ai-bar">
            <span className="row-sub">{insight ? `Analysed ${ago(insight.created_at)} · ${left} left this month` : `${left} analyses left this month`}</span>
            <button className="btn btn-primary btn-sm" onClick={run} disabled={running || left === 0 || data === null}>
              <Icon name="sparkle" weight="fill" />
              {running ? "Analysing…" : insight ? "Analyse again" : "Analyse now"}
            </button>
          </div>
          {error && <p className="notice notice-error">{error}</p>}

          {running && (
            <div className="ai-running" aria-busy="true">
              <span className="ai-pulse" />
              {copy.running} This takes up to a minute.
            </div>
          )}

          {!running && data === null && <div className="ai-skeleton" aria-busy="true" />}

          {!running && data && !insight && !error && <p className="ai-empty">{copy.empty}</p>}

          {!running && insight && (
            <>
              {insight.result?.summary && <p className="ai-summary">{insight.result.summary}</p>}
              <ol className="ai-list">
                {items.map((it, i) => (
                  <li key={i} className={`ai-card is-${it.priority}`}>
                    <span className="ai-priority">{it.priority === "high" ? "Needs attention" : it.priority === "medium" ? "Worth a look" : "Good to know"}</span>
                    <strong className="ai-title">{it.title}</strong>
                    <p className="ai-detail">{it.detail}</p>
                    <p className="ai-action">
                      <Icon name="arrowRight" size={14} />
                      {it.action}
                    </p>
                    {it.people?.length > 0 && (
                      <ul className="ai-people">
                        {it.people.map((p) => (
                          <li key={p.id}>
                            <span>
                              <strong>{p.name}</strong>
                              <span className="row-sub"> · {lineOf(p)}</span>
                            </span>
                            {copy.person && onPerson && (
                              <button className="btn btn-secondary btn-sm" onClick={() => onPerson(p.id)}>
                                {copy.person}
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {opens.includes(it.open) && (
                      <button className="link-btn ai-open" onClick={() => onOpen(it.open, it)}>
                        {OPEN_LABEL[it.open]}
                        <Icon name="arrowRight" size={13} />
                      </button>
                    )}
                  </li>
                ))}
              </ol>
              {items.length === 0 && <p className="ai-empty">Nothing stood out this time. Try again after more data comes in.</p>}
              <p className="ai-foot row-sub">Suggestions from AI, based only on your figures. Check before acting.</p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
