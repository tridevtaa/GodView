import { useEffect, useReducer, useState } from "react";
import { latestInsight, runInsight } from "../data/api.js";
import { rupees } from "../data/money.js";
import Icon from "./Icon.jsx";
import { useDismiss } from "./useDismiss.js";

// AI insights (Premium) on Fees, Transport and Results, built into the
// pages: the main ones as big cards (KeyInsights, where Fees has its
// charts), the rest as short lines next to the figure they explain
// (Hint). Refreshed once a day by itself: the first owner or admin to open
// a page after that kicks off a new analysis in the background, and the
// last one shows meanwhile. Other plans see a locked "Insights" button.

const COPY = {
  fees: {
    locked: "AI reads your fee figures and tells you what needs attention and how to collect faster.",
    running: "Reading this session’s fee figures",
    person: "Collect",
  },
  transport: {
    locked: "AI reads where students live and your routes and buses, and suggests new stops or routes and what to fix.",
    running: "Reading your villages, routes and buses",
    person: null,
  },
  results: {
    locked: "AI reads this session’s exam results and points out weak subjects, classes and students who need help.",
    running: "Reading this session’s exam results",
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
  limit: "This month’s analyses are used up. The last one is shown.",
  busy: "The AI is busy right now. Try again in a minute.",
  no_data: "There isn’t enough data yet to analyse.",
  ai_failed: "The analysis didn’t go through. Try again.",
};
const STALE = 20 * 36e5; // the daily refresh, in ms (the edge function has the same)

const ago = (t) => {
  const m = Math.max(1, Math.round((Date.now() - new Date(t)) / 6e4));
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

// --------------------------------------------------------------- store ---

// One entry per school and section, shared by every component showing it:
// loaded once, refreshed once.
const store = new Map();
function entryFor(key) {
  if (!store.has(key)) store.set(key, { insight: undefined, running: false, error: "", tried: false, subs: new Set() });
  return store.get(key);
}
const notify = (e) => e.subs.forEach((f) => f());

async function load(e, schoolId, section, auto) {
  e.loading = true;
  try {
    const { insight } = await latestInsight(schoolId, section);
    e.insight = insight;
  } catch {
    e.insight = null;
  }
  e.loading = false;
  notify(e);
  if (auto && !e.tried && (!e.insight || Date.now() - new Date(e.insight.created_at) > STALE)) run(e, schoolId, section, true);
}

async function run(e, schoolId, section, auto) {
  if (e.running) return;
  e.tried = true;
  e.running = true;
  e.error = "";
  notify(e);
  try {
    const res = await runInsight(schoolId, section, auto);
    if (res?.insight) e.insight = res.insight;
  } catch (err) {
    e.error = ERRORS[err.code] ?? ERRORS.ai_failed;
  }
  e.running = false;
  notify(e);
}

// enabled: this person can see insights here (Premium, and a role allowed
// to); auto: and may start the daily refresh.
export function useInsights(school, section, enabled = true) {
  const on = Boolean(enabled && school?.plan === "premium");
  const key = `${school?.id}:${section}`;
  const [, rerender] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    if (!on) return;
    const e = entryFor(key);
    e.subs.add(rerender);
    if (e.insight === undefined && !e.loading) load(e, school.id, section, true);
    return () => e.subs.delete(rerender);
  }, [on, key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!on) return { on: false };
  const e = entryFor(key);
  return {
    on: true,
    section,
    insight: e.insight,
    running: e.running,
    error: e.error,
    refresh: () => run(e, school.id, section, false),
  };
}

// The hint for one spot ("" if none). target: a route name, bus number or
// student id, for spots that need one.
export function hintFor(ins, slot, target = "") {
  if (!ins?.on) return "";
  return (ins.insight?.result?.hints ?? []).find((h) => h.slot === slot && (h.target ?? "") === target)?.text ?? "";
}

// A short AI line next to a figure.
export function Hint({ ins, slot, target = "", className = "" }) {
  const text = hintFor(ins, slot, target);
  if (!text) return null;
  return (
    <span className={`ai-hint ${className}`}>
      <Icon name="sparkle" size={12} weight="fill" />
      {text}
    </span>
  );
}

// ------------------------------------------------------------ the cards ---

// The main insights as big cards, with when they were made, Refresh and
// (where there are charts) a way back to them. opens: screens this page
// can go to; onPerson(id): a named student.
export function KeyInsights({ ins, opens = [], onOpen, onPerson, onCharts, max = 4 }) {
  const copy = COPY[ins.section];
  const insight = ins.insight;
  const items = (insight?.result?.insights ?? []).slice(0, max);
  const lineOf = (p) => p.line ?? [p.class, p.overdue != null ? rupees(p.overdue) : null].filter(Boolean).join(" · ");
  const first = insight === undefined || (ins.running && !insight);

  return (
    <section className="ai-key">
      <header className="ai-key-head">
        <h2>
          <Icon name="sparkle" size={18} weight="fill" />
          Key insights
        </h2>
        <span className="ai-key-meta">
          {ins.running ? (
            <span className="ai-key-running">
              <span className="ai-pulse" /> {insight ? "Updating…" : `${copy.running}…`}
            </span>
          ) : (
            insight && <span className="row-sub">Updated {ago(insight.created_at)}</span>
          )}
          {!ins.running && insight !== undefined && (
            <button className="link-btn" onClick={ins.refresh}>
              Refresh
            </button>
          )}
          {onCharts && (
            <button className="link-btn" onClick={onCharts}>
              <Icon name="chart" size={14} /> Charts
            </button>
          )}
        </span>
      </header>

      {ins.error && <p className="notice notice-error ai-key-error">{ins.error}</p>}

      {first ? (
        <div className="ai-key-grid" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="ai-big is-skeleton" />
          ))}
        </div>
      ) : !insight ? (
        <p className="ai-empty">No analysis yet. Tap Refresh to run one.</p>
      ) : (
        <>
          {insight.result?.summary && <p className="ai-summary">{insight.result.summary}</p>}
          <div className="ai-key-grid">
            {items.map((it, i) => (
              <article key={i} className={`ai-big is-${it.priority}`} style={{ "--d": `${i * 60}ms` }}>
                <span className="ai-priority">{it.priority === "high" ? "Needs attention" : it.priority === "medium" ? "Worth a look" : "Good to know"}</span>
                <strong className="ai-big-title">{it.title}</strong>
                <p className="ai-detail">{it.detail}</p>
                <p className="ai-action">
                  <Icon name="arrowRight" size={14} />
                  {it.action}
                </p>
                {it.people?.length > 0 && (
                  <ul className="ai-people">
                    {it.people.slice(0, 3).map((p) => (
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
              </article>
            ))}
          </div>
          {items.length === 0 && <p className="ai-empty">Nothing stood out this time.</p>}
        </>
      )}
    </section>
  );
}

// Other plans: a locked button with one line on what insights do.
export function InsightsButton({ section, label = "Insights" }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <span className="ai-btn-wrap" ref={ref}>
      <button className="btn ai-btn is-locked" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name="lock" weight="fill" />
        {label}
        <span className="ai-tag">Premium</span>
      </button>
      {open && (
        <span className="ai-locked" role="status">
          {COPY[section].locked} Available on the Premium plan.
        </span>
      )}
    </span>
  );
}
