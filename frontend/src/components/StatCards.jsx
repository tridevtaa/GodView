import { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";

// Overview tiles at the top of a page, in the same style as Home's
// widgets: each a colour, an icon (or a small ring for a percentage), one
// big number and a short label; a thin bar under it for "how much of";
// a red badge for what's waiting. No sentences.
//
// items: [{
//   label, icon?, value,     value: number (counts up) or text; undefined = loading
//   format?: (n) => text,
//   tone?: "paid" | "due" | "overdue"   (green, amber, red)
//   color?: indigo | violet | teal | pink | orange | amber | green | red
//   ring?: 0..100, bar?: { value, max, label? },
//   badge?, badgeLabel?, onClick?
// }]
const TONE_COLOR = { paid: "green", due: "amber", overdue: "red" };
const PALETTE = ["indigo", "violet", "teal", "pink", "orange"];

export default function StatCards({ items, className = "" }) {
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return (
    <section className={`sw-row ${className}`} style={{ "--n": shown.length }}>
      {shown.map((item, i) => (
        <Card key={item.label} {...item} index={i} />
      ))}
    </section>
  );
}

function Card({ label, icon = "chart", value, format, tone, color, ring, bar, note, badge = 0, badgeLabel, onClick, index }) {
  const Tag = onClick ? "button" : "div";
  const c = color ?? TONE_COLOR[tone] ?? PALETTE[index % PALETTE.length];
  const pct = bar && bar.max > 0 ? Math.min(100, (bar.value / bar.max) * 100) : null;
  return (
    <Tag
      type={onClick ? "button" : undefined}
      className={`sw-tile t-${c}${onClick ? " is-link" : ""}${badge > 0 ? " is-hot" : ""}`}
      onClick={onClick}
      style={{ "--d": `${index * 60}ms` }}
    >
      <span className="sw-top">
        {ring !== undefined && ring !== null ? (
          <Ring pct={ring} />
        ) : (
          <span className="sw-icon">
            <Icon name={icon} size={16} weight="fill" />
          </span>
        )}
        {badge > 0 && (
          <span className="hw-badge sw-badge" aria-label={badgeLabel} title={badgeLabel}>
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </span>
      <strong className="sw-value">{value === undefined ? "…" : typeof value === "number" ? <CountUp to={value} format={format} /> : value}</strong>
      <span className="sw-label">{label}</span>
      {note && <span className="sw-note">{note}</span>}
      {pct !== null && (
        <span className="sw-bar" title={bar.label}>
          <span style={{ "--to": `${pct}%` }} />
        </span>
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
