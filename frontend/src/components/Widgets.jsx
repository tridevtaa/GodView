import { CountUp, Ring } from "./StatCards.jsx";
import Icon from "./Icon.jsx";

// Home widgets, for the staff and parent Homes (styles: .hw in App.css).
// Each has its own colour (tone: indigo, violet, teal, pink, orange,
// amber, green, red).

// A tile: coloured icon, one big number, one word. badge: what's waiting
// there (a red count); hot: something new, the tile glows a little;
// urgent: it needs this person now, so it turns red and pulses.
export function Tile({ icon, tone, label, value, format, badge = 0, badgeLabel, hot = false, urgent = false, onClick, index = 0 }) {
  return (
    <button className={`hw-tile t-${urgent ? "red" : tone}${urgent ? " is-urgent" : hot || badge > 0 ? " is-hot" : ""}`} style={{ "--d": `${index * 60 + 60}ms` }} onClick={onClick}>
      <span className="hw-icon">
        <Icon name={icon} size={20} weight="fill" />
      </span>
      {badge > 0 && (
        <span className="hw-badge" aria-label={badgeLabel} title={badgeLabel}>
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      <strong className="hw-value">{value === undefined ? "…" : typeof value === "number" ? <CountUp to={value} format={format} /> : value}</strong>
      <span className="hw-label">{label}</span>
    </button>
  );
}

// The wide tile at the top, in full colour: a small heading, a big line,
// a short note, and a white ring (pct) or an icon.
export function WideTile({ tone, hot = false, kicker, title, sub, pct = null, icon, onClick }) {
  return (
    <button className={`hw-wide t-${tone}${hot ? " is-hot" : ""}`} onClick={onClick}>
      <span className="hw-wide-text">
        <span className="hw-kicker">{kicker}</span>
        <strong>{title}</strong>
        {sub && <span className="hw-wide-sub">{sub}</span>}
      </span>
      {pct !== null ? (
        <Ring pct={pct} />
      ) : (
        <span className="hw-wide-icon">
          <Icon name={icon} size={26} />
        </span>
      )}
    </button>
  );
}
