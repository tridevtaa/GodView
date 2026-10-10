import { useCallback, useMemo, useState } from "react";
import { useDismiss } from "./useDismiss.js";
import { gradeLabel } from "./PersonCard.jsx";
import Icon from "./Icon.jsx";

const label = (g) => `${gradeLabel(g.klass)}${g.section ? ` · ${g.section}` : ""}`;
const FEW = 5;

// Picks a class (and section). A handful of classes show as chips; more
// than that (owners and admins see the whole school) become one button that
// opens a picker grouped by grade, so the page never fills with chips.
// groups: [{ key, klass, section }] in school order. value: a key or "".
// allLabel: offer an "all classes" choice (value ""). starred: keys to mark ★.
export default function ClassSwitcher({ groups, value, onChange, allLabel, starred = new Set(), ariaLabel = "Class" }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, useCallback(() => setOpen(false), []));
  const current = groups.find((g) => g.key === value);
  const byGrade = useMemo(() => {
    const m = new Map();
    for (const g of groups) m.set(g.klass, [...(m.get(g.klass) ?? []), g]);
    return [...m];
  }, [groups]);

  const pick = (key) => {
    onChange(key);
    setOpen(false);
  };

  if (groups.length <= FEW) {
    return (
      <nav className="hw-filter" aria-label={ariaLabel}>
        {allLabel && (
          <button type="button" className={!value ? "is-on" : ""} onClick={() => pick("")}>
            {allLabel}
          </button>
        )}
        {groups.map((g) => (
          <button type="button" key={g.key} className={value === g.key ? "is-on" : ""} onClick={() => pick(g.key)}>
            {starred.has(g.key) && "★ "}
            {label(g)}
          </button>
        ))}
      </nav>
    );
  }

  return (
    <div className="cls-switch" aria-label={ariaLabel}>
      {allLabel && (
        <button type="button" className={`cls-all${!value ? " is-on" : ""}`} onClick={() => pick("")}>
          {allLabel}
        </button>
      )}
      <div className="popover-anchor" ref={ref}>
        <button type="button" className={`btn btn-secondary cls-current${current ? " is-on" : ""}`} onClick={() => setOpen((o) => !o)} aria-haspopup="true" aria-expanded={open}>
          {current ? `${starred.has(current.key) ? "★ " : ""}${label(current)}` : "Choose a class"}
          <Icon name="chevronDown" className="icon-trailing" />
        </button>
        {open && (
          <div className="menu cls-menu" role="menu">
            {byGrade.map(([klass, list]) => (
              <div key={klass} className="cls-grade">
                <span className="cls-grade-name">{gradeLabel(klass)}</span>
                <span className="cls-sections">
                  {list.map((g) => (
                    <button type="button" key={g.key} role="menuitemradio" aria-checked={value === g.key} className={value === g.key ? "is-on" : ""} onClick={() => pick(g.key)}>
                      {starred.has(g.key) && "★ "}
                      {g.section || "All"}
                    </button>
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
