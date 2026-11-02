import { useEffect, useRef, useState } from "react";

// The tile at the top of a page: one big number and its label, then what else
// there is to know. Side by side once the tile is wide enough (see .sw-tile).
//
// items: [{
//   label, value,     value: number (counts up) or text; undefined = loading
//   format?: (n) => text,
//   tone?: "paid" | "due" | "overdue"   (green, amber, red)
//   color?: indigo | violet | teal | pink | orange | amber | green | red
//   note?: the facts, one to a line (<span className="sw-facts">)
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

function Card({ label, value, format, tone, color, note, index }) {
  const c = color ?? TONE_COLOR[tone] ?? PALETTE[index % PALETTE.length];
  return (
    <div className={`sw-tile t-${c}`} style={{ "--d": `${index * 60}ms` }}>
      <strong className="sw-value">{value === undefined ? "…" : typeof value === "number" ? <CountUp to={value} format={format} /> : value}</strong>
      <span className="sw-label">{label}</span>
      {note && <span className="sw-note">{note}</span>}
    </div>
  );
}

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
