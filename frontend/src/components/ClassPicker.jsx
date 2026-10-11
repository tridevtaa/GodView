import { gradeLabel } from "./PersonCard.jsx";
import { gradeRank } from "./GradeFilter.jsx";

const key = (c) => `${c.class}|${c.section ?? ""}`;

// Pick class/sections, grouped by grade. `value` is [{ class, section }],
// where section "" means every section of that grade.
export default function ClassPicker({ options, value, onChange }) {
  const selected = new Set(value.map(key));
  const grades = new Map();
  options.forEach((o) => grades.set(o.class, [...(grades.get(o.class) ?? []), o.section ?? ""]));
  const ordered = [...grades].sort(([a], [b]) => gradeRank(a) - gradeRank(b));

  function toggle(klass, section) {
    const k = `${klass}|${section}`;
    let next = value.filter((c) => key(c) !== k);
    if (!selected.has(k)) {
      // "All sections" replaces individual ones, and vice versa.
      next = next.filter((c) => c.class !== klass || (section === "" ? false : c.section !== ""));
      next.push({ class: klass, section });
    }
    onChange(next);
  }

  if (!ordered.length) return <p className="row-sub">This school hasn’t added any classes yet.</p>;

  return (
    <div className="class-picker">
      {ordered.map(([klass, sections]) => {
        const named = sections.filter(Boolean).sort();
        const all = selected.has(`${klass}|`);
        return (
          <div key={klass} className="class-row">
            <span className="class-name">{gradeLabel(klass)}</span>
            <div className="chips">
              {named.length > 1 && (
                <button type="button" className={`chip-toggle${all ? " on" : ""}`} onClick={() => toggle(klass, "")}>
                  All sections
                </button>
              )}
              {(named.length ? named : [""]).map((s) => {
                // "All sections" covers every section, so show them all as chosen.
                const on = all || selected.has(`${klass}|${s}`);
                return (
                  <button
                    type="button"
                    key={s || "only"}
                    className={`chip-toggle${on ? " on" : ""}`}
                    onClick={() => toggle(klass, named.length > 1 ? s : "")}
                    aria-pressed={on}
                  >
                    {s || "Whole class"}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
