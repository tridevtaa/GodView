import { useCallback, useState } from "react";
import { useDismiss } from "./useDismiss.js";
import Icon from "./Icon.jsx";

// "2026-27" -> "26-27", for the compact picker in the top bar.
const short = (name = "") => name.replace(/^20(\d\d)\s*[-–/]\s*(?:20)?(\d\d)$/, "$1-$2");

// Pill dropdown for the academic session; past sessions are view-only.
export default function SessionSelect({ sessions, value, current, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, useCallback(() => setOpen(false), []));
  const selected = sessions.find((s) => s.id === value);

  return (
    <div className="popover-anchor" ref={ref}>
      <button
        className="session-btn"
        title={selected ? `Session ${selected.name}` : "Session"}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        disabled={!sessions.length}
      >
        {selected ? short(selected.name) : "…"}
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
