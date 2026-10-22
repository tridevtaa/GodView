import { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";

// Home's thin banner: the latest notices, reminders and what's coming up,
// scrolling by like a news ticker. Pauses under a finger or the mouse;
// each item opens where it's about. With reduced motion it doesn't move
// and can be swiped instead.
// items: [{ key, icon, tone, text, onClick }]
export default function Ticker({ items }) {
  const track = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.scrollWidth / 2));
    ro.observe(el);
    return () => ro.disconnect();
  }, [items.length]);
  if (!items.length) return null;

  // About 40px a second, whatever the length
  const seconds = Math.max(12, Math.round(width / 40));
  const row = (copy) =>
    items.map((it) => (
      <button type="button" key={`${copy}-${it.key}`} className={`ticker-item t-${it.tone ?? "indigo"}`} onClick={it.onClick} tabIndex={copy ? -1 : 0} aria-hidden={copy ? "true" : undefined}>
        <Icon name={it.icon} size={14} weight="fill" />
        <span>{it.text}</span>
      </button>
    ));

  return (
    <section className="ticker" aria-label="Latest updates">
      <span className="ticker-tag">
        <Icon name="bell" size={13} weight="fill" />
        <span>Latest</span>
      </span>
      <div className="ticker-window">
        {/* Two copies back to back, so the loop has no gap */}
        <div className="ticker-track" ref={track} style={{ "--ticker-time": `${seconds}s` }}>
          {row(0)}
          {row(1)}
        </div>
      </div>
    </section>
  );
}
