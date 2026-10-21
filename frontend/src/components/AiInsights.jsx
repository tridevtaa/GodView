import { useEffect, useReducer, useState } from "react";
import { latestInsight, runInsight } from "../data/api.js";
import { rupees, rupeesShort } from "../data/money.js";
import Icon from "./Icon.jsx";
import { useDismiss } from "./useDismiss.js";

// AI insights (Premium) on Fees, Transport and Results, built into the
// pages: the main ones in the AI card (AiCard, "What AI thinks can help"),
// the rest as short lines next to the figure they explain (Hint). Refreshed once a day by itself: the first owner or admin to open
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
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
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

// The number on a card, formatted by the app (the AI only picks it)
function statText(it) {
  const v = Number(it.stat_value);
  if (!Number.isFinite(v)) return "";
  if (it.stat_unit === "rupees") return rupeesShort(v);
  if (it.stat_unit === "percent") return `${Math.round(v)}%`;
  if (it.stat_unit === "days") return `${Math.round(v)} days`;
  if (it.stat_unit === "km") return `${v} km`;
  return Math.round(v).toLocaleString("en-IN");
}

function InsightCard({ it, index, copy, opens, onOpen, onPerson }) {
  const [why, setWhy] = useState(false);
  const stat = statText(it);
  const lineOf = (p) => p.line ?? [p.class, p.overdue != null ? rupees(p.overdue) : null].filter(Boolean).join(" · ");
  const canOpen = opens.includes(it.open);
  const whyText = it.why ?? it.detail;
  return (
    <article className={`ai-big is-${it.priority}`} style={{ "--d": `${index * 60}ms` }}>
      {stat ? (
        <p className="ai-stat">
          <strong>{stat}</strong>
          <span>{it.stat_label}</span>
        </p>
      ) : (
        <span className="ai-priority">{it.priority === "high" ? "Needs attention" : it.priority === "medium" ? "Worth a look" : "Good to know"}</span>
      )}
      <p className="ai-big-title">{it.title}</p>
      <p className="ai-action">
        <Icon name="arrowRight" size={14} />
        {it.action}
      </p>
      {it.people?.length > 0 && (
        <div className="ai-chips">
          {it.people.slice(0, 3).map((p) =>
            copy.person && onPerson ? (
              <button key={p.id} type="button" className="ai-chip" onClick={() => onPerson(p.id)} title={`${copy.person}: ${p.name} · ${lineOf(p)}`}>
                {p.name.split(" ")[0]}
              </button>
            ) : (
              <span key={p.id} className="ai-chip" title={lineOf(p)}>
                {p.name.split(" ")[0]}
              </span>
            )
          )}
        </div>
      )}
      {(whyText || canOpen) && (
        <div className="ai-big-foot">
          {whyText && (
            <button type="button" className="link-btn ai-why-btn" onClick={() => setWhy((v) => !v)} aria-expanded={why}>
              Why {why ? "−" : "+"}
            </button>
          )}
          {canOpen && (
            <button type="button" className="link-btn ai-open" onClick={() => onOpen(it.open, it)}>
              {OPEN_LABEL[it.open]}
              <Icon name="arrowRight" size={13} />
            </button>
          )}
        </div>
      )}
      {why && whyText && <p className="ai-why">{whyText}</p>}
    </article>
  );
}

const UNIT_ICON = { rupees: "rupee", count: "users", percent: "chart", days: "calendar", km: "pin" };

// The AI card, "What AI thinks can help": closed, a short line per insight
// (icon, number, title); tapped, the full cards. Open or closed is
// remembered on this device. opens: screens this page can go to;
// onPerson(id): a named student.
export function AiCard({ ins, opens = [], onOpen, onPerson, max = 4 }) {
  const copy = COPY[ins.section];
  const memo = `gv-ai-open:${ins.section}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(memo) === "1";
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setOpen((v) => {
      try {
        localStorage.setItem(memo, v ? "0" : "1");
      } catch {
        // Private mode: just not remembered
      }
      return !v;
    });

  const insight = ins.insight;
  const items = (insight?.result?.insights ?? []).slice(0, max);
  const loading = insight === undefined || (ins.running && !insight);
  const when = ins.running ? (insight ? "Updating" : "Analysing") : insight ? ago(insight.created_at) : "";

  const head = (
    <>
      <span className="ai-card-badge">
        <Icon name="sparkle" size={18} weight="fill" />
      </span>
      <span className="ai-card-titles">
        <strong>What AI thinks can help</strong>
        {when && (
          <span className="ai-key-when">
            {ins.running && <span className="ai-pulse" />}
            {when}
          </span>
        )}
      </span>
      <Icon name="chevronDown" size={18} className="ai-card-chev" />
    </>
  );

  return (
    <section className={`ai-card${open ? " is-open" : ""}`}>
      {!open ? (
        // Closed: the whole card opens it
        <button type="button" className="ai-card-tap" onClick={toggle} aria-expanded="false">
          <span className="ai-card-head">{head}</span>
          {loading ? (
            <span className="ai-mini-wait">{copy.running}…</span>
          ) : items.length ? (
            <span className="ai-mini">
              {items.map((it, i) => (
                <span key={i} className={`ai-mini-row is-${it.priority}`}>
                  <span className="ai-mini-icon">
                    <Icon name={UNIT_ICON[it.stat_unit] ?? "sparkle"} size={14} weight="bold" />
                  </span>
                  {statText(it) && <strong>{statText(it)}</strong>}
                  <span className="ai-mini-text">{it.title}</span>
                </span>
              ))}
            </span>
          ) : (
            <span className="ai-mini-wait">{insight ? "Nothing stands out right now." : "Tap to run the first analysis."}</span>
          )}
        </button>
      ) : (
        <>
          <button type="button" className="ai-card-tap ai-card-head" onClick={toggle} aria-expanded="true">
            {head}
          </button>
          <div className="ai-card-body">
            {ins.error && <p className="notice notice-error ai-key-error">{ins.error}</p>}
            {loading ? (
              <div className="ai-key-grid" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="ai-big is-skeleton" />
                ))}
              </div>
            ) : items.length ? (
              <div className="ai-key-grid">
                {items.map((it, i) => (
                  <InsightCard key={i} it={it} index={i} copy={copy} opens={opens} onOpen={onOpen} onPerson={onPerson} />
                ))}
              </div>
            ) : (
              <p className="ai-empty">{insight ? "Nothing stands out right now." : "No analysis yet."}</p>
            )}
            {!ins.running && insight !== undefined && (
              <button type="button" className="link-btn ai-refresh" onClick={ins.refresh}>
                <Icon name="refresh" size={14} /> {insight ? "Analyse again" : "Analyse now"}
              </button>
            )}
          </div>
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
