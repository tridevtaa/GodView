import { useEffect, useRef, useState } from "react";

// The overview at the top of a page: up to three key numbers, each with the
// details that belong to it. Computers: side by side. Phones: one full-width
// card at a time, swiped sideways, with dots.
//
// items: [{
//   label, value,            value: number (counts up) or text; undefined = loading
//   format?: (n) => text,    how a counted number is shown (e.g. rupees)
//   note?, tone?: "paid" | "due" | "overdue",
//   ring?: 0..100,           a ring beside the number (e.g. attendance %)
//   bar?: { value, max, label? },  a bar that fills (e.g. fees paid of billed)
//   rows?: [[label, value, tone?]],  short breakdown lines
//   onClick?
// }]
export default function StatCards({ items }) {
  const shown = items.filter(Boolean);
  const track = useRef(null);
  const [at, setAt] = useState(0);
  if (!shown.length) return null;

  // The card nearest the left edge is the current one.
  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const kids = [...el.children];
    let best = 0;
    kids.forEach((k, i) => {
      if (Math.abs(k.offsetLeft - el.offsetLeft - el.scrollLeft) < Math.abs(kids[best].offsetLeft - el.offsetLeft - el.scrollLeft)) best = i;
    });
    setAt(best);
  };
  const go = (i) => {
    const el = track.current;
    const k = el?.children[i];
    if (k) el.scrollTo({ left: k.offsetLeft - el.offsetLeft, behavior: "smooth" });
  };

  return (
    <section className="stat-cards-wrap">
      <div className="stat-cards" style={{ "--n": shown.length }} ref={track} onScroll={onScroll}>
        {shown.map((item) => (
          <Card key={item.label} {...item} />
        ))}
      </div>
      {shown.length > 1 && (
        <div className="stat-dots" role="tablist" aria-label="Overview">
          {shown.map((item, i) => (
            <button key={item.label} type="button" role="tab" aria-selected={at === i} aria-label={item.label} className={at === i ? "is-on" : ""} onClick={() => go(i)} />
          ))}
        </div>
      )}
    </section>
  );
}

function Card({ label, value, format, note, tone, ring, bar, rows, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} className={`stat-card${onClick ? " is-link" : ""}`} onClick={onClick}>
      <div className="stat-main">
        <div className="stat-head">
          <span className="stat-label">{label}</span>
          <strong className={tone ? `is-${tone}` : ""}>{value === undefined ? "…" : typeof value === "number" ? <CountUp to={value} format={format} /> : value}</strong>
          {note && <span className="row-sub stat-note">{note}</span>}
        </div>
        {ring !== undefined && ring !== null && <Ring pct={ring} tone={tone} />}
      </div>
      {bar && bar.max > 0 && (
        <div className="stat-bar" title={bar.label}>
          <span className="stat-bar-fill" style={{ "--to": `${Math.min(100, (bar.value / bar.max) * 100)}%` }} />
          {bar.label && <span className="stat-bar-label">{bar.label}</span>}
        </div>
      )}
      {rows?.length > 0 && (
        <ul className="stat-rows">
          {rows.filter(Boolean).map(([k, v, t]) => (
            <li key={k}>
              <span>{k}</span>
              <b className={t ? `is-${t}` : ""}>{v}</b>
            </li>
          ))}
        </ul>
      )}
    </Tag>
  );
}

// The number counts up the first time it's shown (and eases to new values).
function CountUp({ to, format = (n) => n.toLocaleString("en-IN") }) {
  const [n, setN] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = from.current;
    if (reduce || start === to) {
      setN(to);
      from.current = to;
      return;
    }
    const t0 = performance.now();
    const dur = 700;
    let raf;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(start + (to - start) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return format(n);
}

// A ring that fills to pct.
function Ring({ pct, tone }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <svg className={`stat-ring${tone ? ` is-${tone}` : ""}`} viewBox="0 0 56 56" aria-hidden="true">
      <circle cx="28" cy="28" r={r} className="stat-ring-bg" />
      <circle cx="28" cy="28" r={r} className="stat-ring-fg" style={{ "--c": c, "--off": c * (1 - Math.max(0, Math.min(100, pct)) / 100) }} />
      <text x="28" y="32" textAnchor="middle">{Math.round(pct)}%</text>
    </svg>
  );
}
