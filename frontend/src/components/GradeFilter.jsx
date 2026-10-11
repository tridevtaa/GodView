import { useCallback, useState } from "react";
import { useDismiss } from "./useDismiss.js";
import Icon from "./Icon.jsx";
import { gradeLabel } from "./PersonCard.jsx";

// Nursery, KG 1, KG 2, then 1–12; anything unrecognised goes last.
export function gradeRank(klass) {
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

// Pick any number of grades; none picked means all grades. The menu stays
// open while picking.
export function gradesText(value) {
  if (!value.length) return "All grades";
  if (value.length <= 2) return value.map(gradeLabel).join(", ");
  return `${value.length} grades`;
}

export default function GradeFilter({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, useCallback(() => setOpen(false), []));
  const picked = new Set(value);

  function toggle(grade) {
    if (!grade) return onChange([]);
    const next = picked.has(grade) ? value.filter((g) => g !== grade) : [...value, grade];
    // Keep the grades in school order.
    onChange(options.map((o) => o.value).filter((g) => next.includes(g)));
  }

  return (
    <div className="popover-anchor" ref={ref}>
      <button
        className={`btn btn-secondary${value.length ? " is-active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        {gradesText(value)}
        <Icon name="chevronDown" className="icon-trailing" />
      </button>
      {open && (
        <div className="menu menu-scroll" role="menu">
          {[{ value: "", count: null }, ...options].map((o) => {
            const on = o.value ? picked.has(o.value) : !value.length;
            return (
              <button
                key={o.value || "all"}
                role="menuitemcheckbox"
                aria-checked={on}
                className="menu-item"
                onClick={() => toggle(o.value)}
              >
                <span className={`menu-box${on ? " is-on" : ""}`}>{on && <Icon name="check" size={12} />}</span>
                <span className="menu-label">{o.value ? gradeLabel(o.value) : "All grades"}</span>
                {o.count !== null && <span className="menu-meta">{o.count}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
