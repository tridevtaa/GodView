import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { latestInsight, runInsight } from "../data/api.js";
import { rupees, rupeesShort } from "../data/money.js";
import Icon from "./Icon.jsx";
import { useDismiss } from "./useDismiss.js";

// AI insights (Premium) on Fees, Transport, Results, Homework and Staff, built into the
// pages, in the AI card (AiCard). No refresh button: they renew by themselves once a day. The first owner or
// admin to open a page after that starts a new analysis in the background,
// and the last one shows meanwhile. Other plans see a locked button.

const COPY = {
  fees: {
    locked: "AI reads your fee figures and tells you what needs attention and how to collect faster.",
    running: "Reading this session’s fee figures",
    person: "Open",
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
  staff: {
    locked: "AI reads your staff numbers and points out classes with no class teacher, gaps in records and who is waiting for access.",
    running: "Reading your staff records",
    person: null,
  },
  homework: {
    locked: "AI reads how much homework each class and subject gets, and points out who has gone quiet.",
    running: "Reading this session’s homework",
    person: null,
  },
};
const ERRORS = {
  limit: "This month’s analyses are used up. The last one is shown.",
  busy: "The AI is busy right now. Try again in a minute.",
  no_data: "There isn’t enough data yet to analyse.",
  ai_failed: "The analysis didn’t go through. Try again.",
};
const RANK = { high: 0, medium: 1, low: 2 };
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
  if (auto && !e.tried && (!e.insight || Date.now() - new Date(e.insight.created_at) > STALE)) run(e, schoolId, section);
}

async function run(e, schoolId, section) {
  if (e.running) return;
  e.tried = true;
  e.running = true;
  e.error = "";
  notify(e);
  try {
    const res = await runInsight(schoolId, section);
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
  };
}

// ------------------------------------------------------------ the cards ---

// The number on a card, formatted by the app (the AI only picks it)
function statText(it, v = Number(it.stat_value)) {
  if (!Number.isFinite(v)) return "";
  if (it.stat_unit === "rupees") return rupeesShort(v);
  if (it.stat_unit === "percent") return `${Math.round(v)}%`;
  if (it.stat_unit === "days") return Math.round(v) === 1 ? "1 day" : `${Math.round(v)} days`;
  if (it.stat_unit === "km") return `${v} km`;
  return Math.round(v).toLocaleString("en-IN");
}

// A new analysis writes itself in once, for a few seconds after it first
// shows on this device; after that it just sits there.
const firstSeen = new Map();
function isFresh(stamp) {
  if (!stamp) return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  if (!firstSeen.has(stamp)) firstSeen.set(stamp, Date.now());
  return Date.now() - firstSeen.get(stamp) < 4000;
}

// The number, counting up to its value when fresh.
function CountUp({ it, play }) {
  const [p, setP] = useState(play && it.stat_unit !== "km" ? 0 : 1);
  useEffect(() => {
    if (p === 1) return;
    const start = performance.now();
    let raf;
    const tick = (t) => {
      const x = Math.min(1, (t - start) / 1100);
      setP(x === 1 ? 1 : 1 - (1 - x) ** 3);
      if (x < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return p === 1 ? statText(it) : statText(it, Math.round(Number(it.stat_value) * p));
}

// Text arriving word by word when fresh.
function Words({ text, play, from = 0 }) {
  if (!play) return text;
  let n = from;
  return text.split(/(\s+)/).map((w, i) =>
    w.trim() ? (
      <span key={i} className="ai-word" style={{ "--w": n++ }}>
        {w}
      </span>
    ) : (
      w
    )
  );
}

// An insight as one short sentence, its number highlighted inside it: the
// AI's own wording ("{stat}" marks the number) if it fits on a line, or built
// from its parts. A plain count needs its label to say what it counts.
const MESSAGE_MAX = 46;
function Message({ it, play, from }) {
  const stat = statText(it);
  const title = String(it.title ?? "").replace(/[.:\s]+$/, "");
  if (!stat) return <Words text={`${title}.`} play={play} from={from} />;
  const own = it.message?.includes("{stat}") && it.message.replace("{stat}", stat).length <= MESSAGE_MAX;
  const text = own ? it.message : it.stat_unit === "count" ? `{stat} ${it.stat_label}.` : `${title} at {stat}.`;
  const at = text.indexOf("{stat}");
  const before = text.slice(0, at);
  const after = text.slice(at + "{stat}".length);
  const n = before.split(/\s+/).filter(Boolean).length;
  return (
    <>
      <Words text={before} play={play} from={from} />
      <mark className={`ai-kpi${play ? " ai-word" : ""}`} style={{ "--w": from + n }}>
        <CountUp it={it} play={play} />
      </mark>
      <Words text={after} play={play} from={from + n + 1} />
    </>
  );
}

// The AI card, no title: the Goddess's thoughts, one card per insight in the
// glass of her panel, stacked like messages, the top one's tail pointing up at
// her portrait in the top bar. Closed, one short sentence; open, each grows in
// place to show why and what to do. lead: the page's own tile, first in the
// row. Open or closed is remembered on this device.
// opens: screens this page can go to; onPerson(id): a named student.
export function AiCard({ ins, lead, opens = [], onOpen, onPerson, max = 3 }) {
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
  // The most important few (the sort keeps the AI's own order within a priority)
  const items = [...(insight?.result?.insights ?? [])].sort((a, b) => (RANK[a.priority] ?? 3) - (RANK[b.priority] ?? 3)).slice(0, max);
  const loading = insight === undefined || (ins.running && !insight);
  const when = ins.running ? (insight ? "Updating" : "") : insight ? ago(insight.created_at) : "";
  const play = isFresh(insight?.created_at && `${ins.section}:${insight.created_at}`);
  // The tail of her top message points at her portrait in the top bar,
  // wherever that is
  const card = useRef(null);
  const [tailRight, setTailRight] = useState(null);
  useLayoutEffect(() => {
    const place = () => {
      const face = document.querySelector(".ask-btn")?.getBoundingClientRect();
      const box = card.current?.getBoundingClientRect();
      setTailRight(face && box ? box.right - (face.left + face.width / 2) : null);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);
  const lineOf = (p) => p.line ?? [p.class, p.overdue != null ? rupees(p.overdue) : null].filter(Boolean).join(" · ");

  return (
    <section ref={card} className={`ai-card${open ? " is-open" : ""}`}>
      {tailRight !== null && (
        <svg className="ai-tail" style={{ right: tailRight - 9 }} width="18" height="9" viewBox="0 0 18 9" aria-hidden="true">
          <path d="M0 9C5 9 6.5 1 9 1s4 8 9 8z" />
          <path d="M0 9C5 9 6.5 1 9 1s4 8 9 8" />
        </svg>
      )}
      {open && ins.error && <p className="notice notice-error ai-key-error">{ins.error}</p>}
      <div className={`ai-cards${lead ? " has-lead" : ""}`}>
        {lead && <div className="ai-lead">{lead}</div>}
        <div className="ai-msgs">
          {loading || !items.length ? (
            <div className="ai-thought">
              <p className="ai-card-note">{loading ? `${copy.running}…` : insight ? "Nothing stands out right now." : "First insights are on their way."}</p>
            </div>
          ) : (
            items.map((it, i) => (
              <article key={i} className={`ai-thought is-${it.priority}`} style={{ "--i": i + 1 }} onClick={open ? undefined : toggle}>
                <p className="ai-message">
                  <Message it={it} play={play} from={i * 5} />
                </p>
                <div className="ai-col-more">
                  <div className="ai-col-more-in">
                    {it.why && <p className="ai-col-why">{it.why}</p>}
                    {opens.includes(it.open) ? (
                      <button type="button" className="ai-col-action" onClick={() => onOpen(it.open, it)}>
                        {it.action}
                        <Icon name="arrowRight" size={13} />
                      </button>
                    ) : (
                      <p className="ai-col-action is-text">{it.action}</p>
                    )}
                    {it.people?.length > 0 && (
                      <p className="ai-col-people">
                        {it.people.slice(0, 3).map((p, j) => (
                          <span key={p.id}>
                            {j > 0 && " · "}
                            {copy.person && onPerson ? (
                              <button type="button" className="link-btn" onClick={() => onPerson(p.id)} title={`${copy.person}: ${lineOf(p)}`}>
                                {p.name.split(" ")[0]}
                              </button>
                            ) : (
                              p.name.split(" ")[0]
                            )}
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                </div>
              </article>
            ))
          )}
          {items.length > 0 && (
            <button type="button" className="ai-card-toggle" onClick={toggle} aria-expanded={open} aria-label={open ? "Hide insights" : "Show insights"}>
              {when && (
                <span className="ai-key-when">
                  {ins.running && <span className="ai-pulse" />}
                  {when}
                </span>
              )}
              <Icon name="chevronDown" size={18} className="ai-card-chev" />
            </button>
          )}
        </div>
      </div>
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
