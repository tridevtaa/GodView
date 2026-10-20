import { CountUp, Ring } from "./StatCards.jsx";
import Icon from "./Icon.jsx";

// Home widgets, for the staff and parent Homes (styles: .hw in App.css).
// Each has its own colour (tone: indigo, violet, teal, pink, orange,
// amber, green, red).

// A tile: coloured icon, one big number, one word. badge: what's waiting
// there (a red count); hot: something new, the tile glows a little;
// urgent: it needs this person now, so it turns red. sub: the latest
// update there, in a line under the word. big: twice as wide (Home makes
// the tiles that need attention big).
export function Tile({ icon, tone, label, value, format, badge = 0, badgeLabel, hot = false, urgent = false, sub, big = false, onClick, index = 0 }) {
  return (
    <button className={`hw-tile t-${urgent ? "red" : tone}${urgent ? " is-urgent" : hot || badge > 0 ? " is-hot" : ""}${big ? " is-big" : ""}`} style={{ "--d": `${index * 60 + 60}ms` }} onClick={onClick}>
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
      {sub && <span className="hw-sub">{sub}</span>}
    </button>
  );
}

// The card at the top of Home: the one thing this person should do next
// (attendance for class teachers, pending fees for the office, homework or
// fees for parents), in full colour; red and softly pulsing when urgent.
// pct: a thin bar under the text. cta: the button's words.
export function PriorityCard({ tone, urgent = false, icon, title, sub, pct = null, cta, onClick }) {
  return (
    <div className={`home-att t-${tone}${urgent ? " is-urgent" : ""}`}>
      <span className="home-att-icon">
        <Icon name={icon} size={20} weight="fill" />
      </span>
      <span className="home-att-text">
        <strong className="home-att-title">{title}</strong>
        {sub && <span className="home-att-sub">{sub}</span>}
        {pct !== null && (
          <span className="home-att-bar">
            <span className="home-att-bar-fill" style={{ width: `${pct}%` }} />
          </span>
        )}
      </span>
      {cta && (
        <button type="button" className="home-att-cta" onClick={onClick}>
          {cta}
          <Icon name="arrowRight" size={14} />
        </button>
      )}
    </div>
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
