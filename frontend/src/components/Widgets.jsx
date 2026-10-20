import { CountUp } from "./StatCards.jsx";
import Icon from "./Icon.jsx";

// Home widgets, for the staff and parent Homes (styles: .hw in App.css).
// Each has its own colour (tone: indigo, violet, teal, pink, orange,
// amber, green, red).

// A tile: coloured icon, one big number, one word. badge: what's waiting
// there (a red count); hot: something new, the tile glows a little;
// urgent: it needs this person now, so it turns red. sub: the latest
// update there, in a line under the word. big: twice as wide (Home makes
// the tiles that need attention big). visual: a small picture of the data
// on the right (TileVisuals.jsx), hidden when the tile is too narrow.
export function Tile({ icon, tone, label, value, format, badge = 0, badgeLabel, hot = false, urgent = false, sub, big = false, visual, onClick, index = 0 }) {
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
      {visual && <span className="hw-visual">{visual}</span>}
    </button>
  );
}

// Home's tiles by what matters now: anything urgent first, then anything
// waiting or new in the last day (fresh: when its latest update was), then
// the rest as they were. Those are big, with their latest update (sub)
// underneath; the rest stay small and quiet. Laid out in two even rows
// (--half columns): with an odd count the last tile widens to fill.
export function arrangeTiles(raw) {
  const dayAgo = Date.now() - 864e5;
  const weight = (t) => (t.urgent ? 3 : t.badge > 0 || t.hot ? 2 : t.fresh && new Date(t.fresh) > dayAgo ? 1 : 0);
  const tiles = raw
    .map((t, i) => ({ ...t, i, w: weight(t) }))
    .sort((a, b) => b.w - a.w || a.i - b.i)
    .map(({ fresh, i, w, ...t }) => ({ ...t, big: w >= 1, sub: w >= 1 ? t.sub : null }));
  let spans = tiles.reduce((n, t) => n + (t.big ? 2 : 1), 0);
  if (spans % 2) {
    // Big tiles sort first, so the last one is small
    tiles[tiles.length - 1].big = true;
    spans += 1;
  }
  return { tiles, spans };
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

