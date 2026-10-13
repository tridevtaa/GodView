import { useCallback, useEffect, useId, useState } from "react";
import { useDismiss } from "./useDismiss.js";
import Icon from "./Icon.jsx";

// The + in the bottom-right corner (phones), above the search bar. Tapping
// it fans the quick actions out as icons on a half circle up and to the
// left of it; tap one to go and do it. Closes on a tap outside, Escape, or
// when the page changes (resetKey).
// actions: [[key, label, icon, short?], …]; short is the word on the arc.
export default function QuickActions({ actions, onAction, resetKey }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, useCallback(() => setOpen(false), []));
  const arcId = `fab-arc-${useId().replace(/:/g, "")}`;

  useEffect(() => setOpen(false), [resetKey]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!actions.length) return null;
  // From straight left (180°) round to straight up (90°), evenly. Labels
  // curve along an arc 40 px outside the icons, each centred on its icon,
  // so they never cover an icon or each other. The arc is made wide enough
  // that neighbouring words keep a clear gap (about 6.4 px a letter at
  // 11 px bold); the icons move out with it.
  const n = actions.length;
  const words = actions.map(([, label, , short]) => short ?? label);
  const step = n > 1 ? (90 / (n - 1)) * (Math.PI / 180) : 1;
  const need = Math.max(0, ...words.slice(1).map((w, i) => ((words[i].length + w.length) * 6.4) / 2 + 18));
  const ring = Math.max((n > 4 ? 150 : n > 2 ? 138 : 104) + 40, Math.ceil(need / step));
  const radius = ring - 40;
  const degs = actions.map((_, i) => (n === 1 ? 135 : 180 - (90 * i) / (n - 1)));
  const spots = degs.map((d) => {
    const a = (d * Math.PI) / 180;
    return { x: Math.cos(a) * radius, y: -Math.sin(a) * radius };
  });

  // The arc runs from a little below straight-left round to a little past
  // straight-up.
  const size = 2 * (ring + 40);
  const c = size / 2;
  const [from, to] = [200, 70];
  const at = (d) => [c + ring * Math.cos((d * Math.PI) / 180), c - ring * Math.sin((d * Math.PI) / 180)];
  const arc = `M ${at(from).join(" ")} A ${ring} ${ring} 0 0 1 ${at(to).join(" ")}`;
  const along = (d) => ((from - d) * Math.PI * ring) / 180;

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
          </button>
        ))}
        <svg className="fab-arc" width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ "--s": `${size}px` }} aria-hidden="true">
          <path id={arcId} d={arc} fill="none" />
          {actions.map(([key], i) => (
            <text key={key} className="fab-arc-label" style={{ "--d": `${i * 35 + 80}ms` }}>
              <textPath href={`#${arcId}`} startOffset={along(degs[i])} textAnchor="middle">
                {words[i]}
              </textPath>
            </text>
          ))}
        </svg>
      </div>
      <button className="fab-main" onClick={() => setOpen((o) => !o)} aria-label={open ? "Close quick actions" : "Quick actions"} aria-expanded={open}>
        <Icon name="plus" size={26} />
      </button>
    </div>
  );
}
