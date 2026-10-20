import { Photo } from "./PersonCard.jsx";

// Small pictures of a tile's data, on its right side (Home tiles). They
// hide when the tile is too narrow for them (see .hw-visual in App.css).

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// A short line under a visual
export function Caption({ children }) {
  return <span className="tv-caption">{children}</span>;
}

// Overlapping round photos, those with a photo first, then "+N" for the rest
export function FacePile({ people, total = people.length, max = 4 }) {
  const withPhoto = (p) => Boolean(p.photo_src || p.photo_path || p.photo_url);
  const shown = [...people].sort((a, b) => withPhoto(b) - withPhoto(a)).slice(0, max);
  const more = total - shown.length;
  if (!shown.length) return null;
  return (
    <span className="tv-faces">
      {shown.map((p) => (
        <Photo key={p.id} person={p} className="tv-face" />
      ))}
      {more > 0 && <span className="tv-face tv-more">+{more > 999 ? "999" : more}</span>}
    </span>
  );
}

// Monday to Saturday of this week, a dot under each day with something due
// (dates: "yyyy-mm-dd"), today ringed
export function WeekStrip({ dates }) {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const today = iso(now);
  const count = dates.reduce((m, d) => m.set(d, (m.get(d) ?? 0) + 1), new Map());
  return (
    <span className="tv-week">
      {["M", "T", "W", "T", "F", "S"].map((l, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const day = iso(d);
        const n = count.get(day) ?? 0;
        return (
          <span key={i} className={`tv-day${day === today ? " is-today" : ""}${day < today ? " is-past" : ""}`}>
            <span>{l}</span>
            <i className={n ? `is-on${n > 1 ? " is-many" : ""}` : ""} />
          </span>
        );
      })}
    </span>
  );
}

// A ring that fills to pct, the number in the middle
export function MiniRing({ pct }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <svg className="tv-ring" viewBox="0 0 56 56" aria-hidden="true">
      <circle cx="28" cy="28" r={r} className="tv-ring-bg" />
      <circle cx="28" cy="28" r={r} className="tv-ring-fg" strokeDasharray={`${(p / 100) * c} ${c}`} transform="rotate(-90 28 28)" />
      <text x="28" y="32" textAnchor="middle">
        {Math.round(p)}%
      </text>
    </svg>
  );
}

// Thin bars, one per subject (rows: [{ label, pct }])
export function SubjectBars({ rows }) {
  if (!rows.length) return null;
  return (
    <span className="tv-bars">
      {rows.slice(0, 5).map((r) => (
        <span key={r.label} className="tv-bar" title={`${r.label}: ${Math.round(r.pct)}%`}>
          <i style={{ height: `${Math.max(8, r.pct)}%` }} />
          <span>{r.label.slice(0, 3)}</span>
        </span>
      ))}
    </span>
  );
}

// The latest notice's picture
export function Thumb({ src }) {
  return src ? <img className="tv-thumb" src={src} alt="" loading="lazy" /> : null;
}

// Students with a birthday in the next 7 days (today first)
export function birthdaysSoon(people) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return people
    .filter((p) => p.dob)
    .map((p) => {
      const b = new Date(p.dob);
      let next = new Date(start.getFullYear(), b.getMonth(), b.getDate());
      if (next < start) next = new Date(start.getFullYear() + 1, b.getMonth(), b.getDate());
      return { p, days: Math.round((next - start) / 864e5) };
    })
    .filter((x) => x.days <= 6)
    .sort((a, b) => a.days - b.days)
    .map((x) => x.p);
}
