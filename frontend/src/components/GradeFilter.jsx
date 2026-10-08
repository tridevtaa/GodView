import { useCallback, useState } from "react";
import { useDismiss } from "./useDismiss.js";
import Icon from "./Icon.jsx";
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
  const ref = useDismiss(open, useCallback(() => setOpen(false), []));

  function pick(next) {
    onChange(next);
    setOpen(false);
  }

  return (
    <div className="popover-anchor" ref={ref}>
      <button
        className={`btn btn-secondary${value ? " is-active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        {value ? gradeLabel(value) : "All grades"}
        <Icon name="chevronDown" className="icon-trailing" />
      </button>
      {open && (
        <div className="menu menu-scroll" role="menu">
          {[{ value: "", count: null }, ...options].map((o) => (
            <button
              key={o.value || "all"}
              role="menuitemradio"
              aria-checked={value === o.value}
              className="menu-item"
              onClick={() => pick(o.value)}
            >
              <span className="menu-check">{value === o.value && <Icon name="check" />}</span>
              <span className="menu-label">{o.value ? gradeLabel(o.value) : "All grades"}</span>
              {o.count !== null && <span className="menu-meta">{o.count}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
