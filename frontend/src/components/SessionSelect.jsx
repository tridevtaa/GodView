import { useCallback, useState } from "react";
import { useDismiss } from "./useDismiss.js";
import Icon from "./Icon.jsx";

// Pill dropdown for the academic session; past sessions are view-only.
export default function SessionSelect({ sessions, value, current, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, useCallback(() => setOpen(false), []));
  const selected = sessions.find((s) => s.id === value);

  return (
    <div className="popover-anchor" ref={ref}>
      <button
        className="session-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        disabled={!sessions.length}
      >
        Session {selected?.name ?? "…"}
        <Icon name="chevronDown" />
      </button>
      {open && (
        <div className="menu" role="menu">
          {sessions.map((s) => (
            <button
              key={s.id}
              role="menuitemradio"
              aria-checked={s.id === value}
              className="menu-item"
              onClick={() => {
                onChange(s.id);
                setOpen(false);
              }}
            >
              <span className="menu-check">{s.id === value && <Icon name="check" />}</span>
              <span className="menu-label">{s.name}</span>
              <span className="menu-meta">{s.id === current?.id ? "Current" : "View only"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
