import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { gradeLabel } from "./PersonCard.jsx";
import { gradeOptions } from "./GradeFilter.jsx";
import Icon from "./Icon.jsx";

// Fees overview: one Filter button for the lists on both tabs (Monthly fee
// and Transport). Grades, sections, active or inactive and "late only"; changes apply straight
// away and the button counts what's on. Uses the Students page's filter
// sheet styles. value: { grades: [], sections: [], late: false, status }.
// status: "all", "active" or "inactive" (students who've left aren't listed).
export const NO_FEE_FILTER = { grades: [], sections: [], late: false, status: "all" };

export function feeFilterOn(f) {
  return (f.grades.length ? 1 : 0) + (f.sections.length ? 1 : 0) + (f.late ? 1 : 0) + (f.status !== "all" ? 1 : 0);
}

// Does a student pass the grade, section and status filters?
export function feeFilterMatch(f, s) {
  return (
    (!f.grades.length || f.grades.includes(s.class)) &&
    (!f.sections.length || f.sections.includes(s.section ?? "")) &&
    (f.status === "all" || (f.status === "inactive") === (s.status === "inactive"))
  );
}

export default function FeesFilter({ students, value, onChange, shown }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const grades = useMemo(() => gradeOptions(students), [students]);
  // Sections of the picked grades (all grades when none picked)
  const sections = useMemo(() => {
    const set = new Set();
    for (const s of students) if (s.section && (!value.grades.length || value.grades.includes(s.class))) set.add(s.section);
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [students, value.grades]);

  const on = feeFilterOn(value);
  const flip = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const set = (patch) => onChange({ ...value, ...patch });
  const pickGrade = (g) => {
    const next = flip(value.grades, g);
    // Drop sections no longer in the picked grades
    const keep = new Set(students.filter((s) => !next.length || next.includes(s.class)).map((s) => s.section));
    set({ grades: next, sections: value.sections.filter((x) => keep.has(x)) });
  };

  return (
    <>
      <button type="button" className={`btn btn-secondary${on ? " is-active" : ""}`} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon name="filter" />
        Filter
        {on > 0 && <span className="filter-count">{on}</span>}
      </button>
      {open &&
        createPortal(
          <div className="filter-back" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
            <section className="filter-sheet" role="dialog" aria-modal="true" aria-label="Filter">
              <header className="filter-head">
                <h2>Filter</h2>
                <button type="button" className="btn-icon" onClick={() => setOpen(false)} aria-label="Close" title="Close">
                  <Icon name="x" size={18} />
                </button>
              </header>
              <div className="filter-body">
                <h3>Grade</h3>
                <div className="filter-chips">
                  <button type="button" className={`chip-btn${value.grades.length ? "" : " is-on"}`} onClick={() => set({ grades: [], sections: [] })}>
                    All
                  </button>
                  {grades.map((o) => (
                    <button key={o.value} type="button" className={`chip-btn${value.grades.includes(o.value) ? " is-on" : ""}`} onClick={() => pickGrade(o.value)}>
                      {gradeLabel(o.value)}
                    </button>
                  ))}
                </div>
                {sections.length > 1 && (
                  <>
                    <h3>Section</h3>
                    <div className="filter-chips">
                      <button type="button" className={`chip-btn${value.sections.length ? "" : " is-on"}`} onClick={() => set({ sections: [] })}>
                        All
                      </button>
                      {sections.map((x) => (
                        <button key={x} type="button" className={`chip-btn${value.sections.includes(x) ? " is-on" : ""}`} onClick={() => set({ sections: flip(value.sections, x) })}>
                          {x}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <h3>Status</h3>
                <div className="filter-chips">
                  {[
                    ["all", "All"],
                    ["active", "Active"],
                    ["inactive", "Inactive"],
                  ].map(([v, label]) => (
                    <button key={v} type="button" className={`chip-btn${value.status === v ? " is-on" : ""}`} onClick={() => set({ status: v })}>
                      {label}
                    </button>
                  ))}
                </div>
                <h3>Dues</h3>
                <div className="filter-chips">
                  {[
                    [false, "All pending"],
                    [true, "Late only"],
                  ].map(([v, label]) => (
                    <button key={label} type="button" className={`chip-btn${value.late === v ? " is-on" : ""}`} onClick={() => set({ late: v })}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <footer className="filter-foot">
                <button type="button" className="link-btn" onClick={() => onChange(NO_FEE_FILTER)} disabled={!on}>
                  Clear all
                </button>
                <button type="button" className="btn btn-primary" onClick={() => setOpen(false)}>
                  Show {shown.toLocaleString("en-IN")} {shown === 1 ? "student" : "students"}
                </button>
              </footer>
            </section>
          </div>,
          document.body
        )}
    </>
  );
}
