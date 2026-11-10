import { useCallback, useEffect, useState } from "react";
import { useDismiss } from "./useDismiss.js";
import Icon from "./Icon.jsx";

// The + above the tab bar (phones). Tapping it lists the quick actions in a
// short column rising from it: each a named pill with its icon, the most
// used nearest the thumb. Tap one to go and do it. Closes on a tap
// outside, Escape, or when the page changes (resetKey).
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

  return (
    <div className={`fab${open ? " is-open" : ""}`} ref={ref}>
      {open && <div className="fab-dim" aria-hidden="true" onClick={() => setOpen(false)} />}
      <div className="fab-actions" role="menu" aria-hidden={!open}>
        {actions.map(([key, label, icon], i) => (
          <button
            key={key}
            role="menuitem"
            tabIndex={open ? 0 : -1}
            className="fab-action"
            style={{ "--d": `${i * 30}ms` }}
            onClick={() => {
              setOpen(false);
              onAction(key);
            }}
          >
            <span className="fab-action-label">{label}</span>
            <span className="fab-action-icon" aria-hidden="true">
              <Icon name={icon} size={19} />
            </span>
          </button>
        ))}
      </div>
      <button className="fab-main" onClick={() => setOpen((o) => !o)} aria-label={open ? "Close quick actions" : "Quick actions"} aria-expanded={open}>
        <Icon name="plus" size={24} />
      </button>
    </div>
  );
}
