import { useEffect, useState } from "react";
import { latestInsight, runInsight } from "../data/api.js";
import { rupees } from "../data/money.js";
import Icon from "./Icon.jsx";
import { useDismiss } from "./useDismiss.js";

// AI insights on Fees (Premium, owners and admins). The button opens a
// panel with the last analysis; "Analyse now" runs a new one. Other plans
// see the button locked, with one line on what it does.

const LIMIT = 30; // a month; the edge function has the same
const ERRORS = {
  premium: "Insights are part of the Premium plan.",
  limit: `You’ve used all ${LIMIT} analyses this month. More next month.`,
  busy: "The AI is busy right now. Try again in a minute.",
  ai_failed: "The analysis didn’t go through. Try again.",
};
const ago = (t) => {
  const m = Math.max(1, Math.round((Date.now() - new Date(t)) / 6e4));
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

export function InsightsButton({ school, onOpen }) {
  const [locked, setLocked] = useState(false);
  const ref = useDismiss(locked, () => setLocked(false));
  const premium = school.plan === "premium";
  return (
    <span className="ai-btn-wrap" ref={ref}>
      <button className={`btn ai-btn${premium ? "" : " is-locked"}`} onClick={() => (premium ? onOpen() : setLocked((v) => !v))} aria-expanded={premium ? undefined : locked}>
        <Icon name={premium ? "sparkle" : "lock"} weight="fill" />
        Insights
        {!premium && <span className="ai-tag">Premium</span>}
      </button>
      {locked && (
        <span className="ai-locked" role="status">
          AI reads your fee figures and tells you what needs attention and how to collect faster. Available on the Premium plan.
        </span>
      )}
    </span>
  );
}

// open(kind, insight): "overdue" | "class" | "structure"; collect(id): a student
export function InsightsPanel({ school, canOpenStructure, onClose, onOpen, onCollect }) {
  const [data, setData] = useState(null); // { insight, used }
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    latestInsight(school.id)
      .then(setData)
      .catch(() => setData({ insight: null, used: 0 }));
  }, [school.id]);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !running && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  async function run() {
    setRunning(true);
    setError("");
    try {
      const res = await runInsight(school.id);
      setData((d) => ({ insight: res.insight, used: (d?.used ?? 0) + 1 }));
    } catch (err) {
      setError(ERRORS[err.code] ?? ERRORS.ai_failed);
    }
    setRunning(false);
  }

  const insight = data?.insight;
  const left = Math.max(0, LIMIT - (data?.used ?? 0));
  const items = insight?.result?.insights ?? [];

  return (
    <div className="modal-backdrop" onClick={() => !running && onClose()}>
      <section className="modal ai-modal" role="dialog" aria-modal="true" aria-label="Fee insights" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <Icon name="sparkle" weight="fill" /> Fee insights
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
              Reading this session’s fee figures. This takes up to a minute.
            </div>
          )}

          {!running && data === null && <div className="ai-skeleton" aria-busy="true" />}

          {!running && data && !insight && !error && (
            <p className="ai-empty">See what needs your attention in fee collection: which classes lag, who to call first, and how to get paid sooner.</p>
          )}

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
                              <span className="row-sub">
                                {" "}
                                · {p.class} · {rupees(p.overdue)}
                              </span>
                            </span>
                            <button className="btn btn-secondary btn-sm" onClick={() => onCollect(p.id)}>
                              Collect
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {(it.open === "overdue" || it.open === "class" || (it.open === "structure" && canOpenStructure)) && (
                      <button className="link-btn ai-open" onClick={() => onOpen(it.open, it)}>
                        {it.open === "structure" ? "Open fee structure" : "See who owes"}
                        <Icon name="arrowRight" size={13} />
                      </button>
                    )}
                  </li>
                ))}
              </ol>
              {items.length === 0 && <p className="ai-empty">Nothing stood out this time. Try again after more payments come in.</p>}
              <p className="ai-foot row-sub">Suggestions from AI, based only on your fee figures. Check before acting.</p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
