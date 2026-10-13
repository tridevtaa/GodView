import { useCallback, useEffect, useState } from "react";
import { useDismiss } from "./useDismiss.js";
import Icon from "./Icon.jsx";

// The + in the bottom-right corner (phones), above the search bar. Tapping
// it fans the quick actions out as icons on a half circle up and to the
// left of it; tap one to go and do it. Closes on a tap outside, Escape, or
// when the page changes (resetKey).
// actions: [[key, label, icon], …]
export default function QuickActions({ actions, onAction, resetKey }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, useCallback(() => setOpen(false), []));

  useEffect(() => setOpen(false), [resetKey]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!actions.length) return null;
  // From straight left (180°) round to straight up (90°), evenly; a little
  // further out when there are more, so icons never touch.
  const n = actions.length;
  const radius = n > 4 ? 150 : n > 2 ? 138 : 104;
  const spots = actions.map((_, i) => {
    const a = ((n === 1 ? 135 : 180 - (90 * i) / (n - 1)) * Math.PI) / 180;
    return { x: Math.cos(a) * radius, y: -Math.sin(a) * radius };
  });

  return (
    <div className={`fab${open ? " is-open" : ""}`} ref={ref}>
      {open && <div className="fab-dim" aria-hidden="true" onClick={() => setOpen(false)} />}
      <div className="fab-actions" role="menu" aria-hidden={!open}>
        {actions.map(([key, label, icon], i) => (
          <button
            key={key}
            role="menuitem"
            tabIndex={open ? 0 : -1}
            // Near the screen edge (straight up): the label sits to the left.
            className={`fab-action${spots[i].x > -40 ? " is-edge" : ""}`}
            style={{ "--x": `${spots[i].x}px`, "--y": `${spots[i].y}px`, "--d": `${i * 35}ms` }}
            onClick={() => {
              setOpen(false);
              onAction(key);
            }}
            aria-label={label}
          >
            <span className="fab-action-icon">
              <Icon name={icon} size={20} />
            </span>
            <span className="fab-action-label">{label}</span>
          </button>
        ))}
      </div>
      <button className="fab-main" onClick={() => setOpen((o) => !o)} aria-label={open ? "Close quick actions" : "Quick actions"} aria-expanded={open}>
        <Icon name="plus" size={26} />
      </button>
    </div>
  );
}
