import { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";

// Overview cards. A card is short (label, number, one line) unless it has
// real detail to show: a ring or bar plus breakdown rows. Short cards sit
// side by side; detailed ones take the full width on phones.
//
// items: [{
//   label, icon?, value,     value: number (counts up) or text; undefined = loading
//   format?: (n) => text,
//   note?, tone?: "paid" | "due" | "overdue",
//   ring?: 0..100, bar?: { value, max, label? }, rows?: [[label, value, tone?]],
//   onClick?
// }]
export default function StatCards({ items, className = "" }) {
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return (
    <section className={`stat-cards ${className}`}>
      {shown.map((item, i) => (
        <Card key={item.label} {...item} index={i} />
      ))}
    </section>
  );
}

const hasDetail = ({ ring, bar, rows }) => {
  const r = (rows ?? []).filter(Boolean).length;
  const viz = (ring !== undefined && ring !== null) || (bar && bar.max > 0);
  return (viz && r >= 1) || r >= 2;
};

function Card({ label, icon, value, format, note, tone, ring, bar, rows, onClick, index }) {
  const rich = hasDetail({ ring, bar, rows });
  const Tag = onClick ? "button" : "div";
  const list = (rows ?? []).filter(Boolean);
  return (
    <Tag
      type={onClick ? "button" : undefined}
      className={`stat-card${rich ? " is-rich" : ""}${onClick ? " is-link" : ""}`}
      onClick={onClick}
      style={{ "--d": `${index * 70}ms` }}
    >
      <span className="stat-label">
        {icon && <Icon name={icon} size={15} />}
        {label}
      </span>
      <div className="stat-main">
        <div className="stat-head">
          <strong className={tone ? `is-${tone}` : ""}>{value === undefined ? "…" : typeof value === "number" ? <CountUp to={value} format={format} /> : value}</strong>
          {note && <span className="row-sub stat-note">{note}</span>}
        </div>
        {rich && ring !== undefined && ring !== null && <Ring pct={ring} tone={tone} />}
      </div>
      {rich && bar && bar.max > 0 && (
        <div className="stat-bar" title={bar.label}>
          <span className="stat-bar-fill" style={{ "--to": `${Math.min(100, (bar.value / bar.max) * 100)}%` }} />
        </div>
      )}
      {rich && list.length > 0 && (
        <ul className="stat-rows">
          {list.map(([k, v, t]) => (
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
// Counting isn't motion, so it runs even with reduced motion on.
export function CountUp({ to, format = (n) => n.toLocaleString("en-IN") }) {
  const [n, setN] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = from.current;
    if (start === to) return setN(to);
    const t0 = performance.now();
    const dur = 900;
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
export function Ring({ pct, tone }) {
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
