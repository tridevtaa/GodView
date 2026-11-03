import { CountUp } from "./StatCards.jsx";
import Icon from "./Icon.jsx";
import { TrendPanel, TrendStat } from "./HomeTrend.jsx";

// Home widgets, for the staff and parent Homes (styles: .hw in App.css).
// Each has its own colour (tone: indigo, violet, teal, pink, orange,
// amber, green, red).

// A tile: one big number and its label, then what else there is to know,
// side by side once the tile is wide enough, like the pages' tiles. badge:
// what's waiting there (written out in facts too; it glows a little and
// arrangeTiles puts it first); hot: something new, the same glow; urgent: it
// needs this person now, so it turns red. facts: short lines that always
// show; sub: the latest update there, for wide tiles. big: twice as wide
// (Home makes the tiles that need attention big).
export function Tile({ tone, label, value, format, badge = 0, hot = false, urgent = false, sub, facts = [], big = false, onClick, index = 0 }) {
  const lines = facts.filter(Boolean);
  const long = typeof value === "string" && value.length > 6;
  const wordy = long && value.split(" ").some((w) => w.length > 9);
  return (
    <button className={`hw-tile t-${urgent ? "red" : tone}${urgent ? " is-urgent" : hot || badge > 0 ? " is-hot" : ""}${big ? " is-big" : ""}`} onClick={onClick} style={{ "--d": `${index * 60}ms` }}>
      <span className="hw-split">
        <span className="hw-main">
          <strong className={`hw-value${long ? " is-long" : ""}${wordy ? " is-wordy" : ""}`}>{value === undefined ? "…" : typeof value === "number" ? <CountUp to={value} format={format} /> : value}</strong>
          <span className="hw-label">{label}</span>
        </span>
        {(lines.length > 0 || sub) && (
          <span className="hw-facts">
            {sub && <span className="hw-sub">{sub}</span>}
            {lines.map((f) => (
              <span key={f}>{f}</span>
            ))}
          </span>
        )}
      </span>
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
// fees for parents). Navy for everyone, like the landing page; tone only
// colours the status chip, and the card softly pulses when urgent.
// label: small words above the big title. status: a short chip in the
// tone's colour. pct: a thin bar under the text. cta: the button's words.
export function PriorityCard({ tone, urgent = false, label = "", title, status = "", sub, pct = null, cta, onClick, trend = null }) {
  const long = typeof title === "string" && title.length > 8;
  const head = (
    <>
      <span className="home-att-top">
        <span className="home-att-main">
          <strong className={`home-att-title${long ? " is-long" : ""}`}>{title}</strong>
          {label && <span className="home-att-label">{label}</span>}
        </span>
        {(status || sub || pct !== null) && (
          <span className="home-att-more">
            {(status || sub) && (
              <span className="home-att-line">
                {status && <span className={`home-att-status t-${tone}`}>{status}</span>}
                {sub && <span className="home-att-sub">{sub}</span>}
              </span>
            )}
            {pct !== null && (
              <span className="home-att-bar">
                <span className="home-att-bar-fill" style={{ width: `${pct}%` }} />
              </span>
            )}
          </span>
        )}
        <TrendStat trend={trend} />
      </span>
      {cta && (
        <button type="button" className="home-att-cta" onClick={onClick}>
          {cta}
          <Icon name="arrowRight" size={14} />
        </button>
      )}
    </>
  );
  // The number on the left, what it means on the right, the button wide under
  // both. With a trend (computers only): the chart in one half; the number and how
  // it's going side by side in the other, with the button under them.
  return (
    <div className={`home-att${label ? " has-label" : ""}${urgent ? " is-urgent" : ""}${trend ? " has-trend" : ""}`}>
      <div className="home-att-split">
        <div className="home-att-head">{head}</div>
        {trend && <TrendPanel trend={trend} />}
      </div>
    </div>
  );
}

