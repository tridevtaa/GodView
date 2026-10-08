import { useEffect, useRef, useState } from "react";
import { gradeLabel } from "./PersonCard.jsx";

// Nursery, KG 1, KG 2, then 1–12; anything unrecognised goes last.
function gradeRank(klass) {
  if (/^nursery$/i.test(klass)) return -3;
  const kg = /^kg\s*(\d)$/i.exec(klass);
  if (kg) return -3 + Number(kg[1]);
  return /^\d+$/.test(klass) ? Number(klass) : 100;
}

export function gradeOptions(students) {
  const counts = new Map();
  for (const s of students) if (s.class) counts.set(s.class, (counts.get(s.class) || 0) + 1);
  return [...counts]
    .sort(([a], [b]) => gradeRank(a) - gradeRank(b) || a.localeCompare(b))
    .map(([value, count]) => ({ value, count }));
}

export default function GradeFilter({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (e.type === "keydown" ? e.key === "Escape" : !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  function pick(next) {
    onChange(next);
    setOpen(false);
  }

  return (
    <div className="filter" ref={ref}>
      <button
        className={`btn-filter${value ? " active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M3 5h18l-7 8v6l-4 2v-8z" />
        </svg>
        {value ? gradeLabel(value) : "Filter"}
      </button>
      {open && (
        <div className="filter-menu" role="menu">
          <button role="menuitemradio" aria-checked={!value} className={!value ? "selected" : ""} onClick={() => pick("")}>
            All grades
          </button>
          {options.map((o) => (
            <button
              key={o.value}
              role="menuitemradio"
              aria-checked={value === o.value}
              className={value === o.value ? "selected" : ""}
              onClick={() => pick(o.value)}
            >
              {gradeLabel(o.value)}
              <span className="filter-count">{o.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
