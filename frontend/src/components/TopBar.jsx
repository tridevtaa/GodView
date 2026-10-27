import Logo from "./Logo.jsx";
import GlassPill from "./GlassPill.jsx";
import AccountMenu from "./AccountMenu.jsx";
import Icon from "./Icon.jsx";

const ICONS = { home: "home", students: "scholar", academics: "academics", attendance: "register", homework: "book", fees: "rupee", requests: "plane", employees: "teacher", transport: "bus" };

// sections: [[value, label, badgeCount?], …], already filtered by role.
// Wide screens: tabs in the top bar. Phones: an app-style bar at the bottom.
// onSettings: School settings (owners and admins), from the account menu.
// session: the session picker, shown beside the logo.
// search: the common search (header on computers; above the tab bar on phones).
// onAsk: opens the assistant (Premium leads), a sparkle beside the account.
export default function TopBar({ mode, onMode, sections, onSettings, onProfile, session, search, onAsk }) {
  const at = sections.findIndex(([v]) => v === mode);
  const tabs = (className) => (
    <nav className={className} aria-label="Section">
      {className === "tabbar" && <GlassPill index={at} count={sections.length} />}
      {sections.map(([value, label, count]) => (
        <button
          key={value}
          className={mode === value ? "active" : ""}
          aria-current={mode === value ? "page" : undefined}
          onClick={() => onMode(value)}
        >
          <Icon name={ICONS[value] ?? "file"} size={22} className="tab-icon" weight={mode === value ? "fill" : "regular"} />
          <span className="tab-label">{label}</span>
          {count > 0 && <span className="seg-count">{count > 99 ? "99+" : count}</span>}
        </button>
      ))}
    </nav>
  );
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="topbar-left">
            <Logo />
            {session}
          </span>
          {search}
          {sections.length > 1 && tabs("segmented topbar-tabs")}
          <span className="topbar-right">
            {onAsk && (
              <button type="button" className="ask-btn" onClick={onAsk} aria-label="Ask Goddess" title="Ask Goddess">
                <Icon name="sparkle" size={18} weight="fill" />
              </button>
            )}
            <AccountMenu onSettings={onSettings} onProfile={onProfile} />
          </span>
        </div>
      </header>
      {sections.length > 1 && tabs("tabbar")}
    </>
  );
}
