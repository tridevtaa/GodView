import Logo from "./Logo.jsx";
import AccountMenu from "./AccountMenu.jsx";
import Icon from "./Icon.jsx";

const ICONS = { students: "users", attendance: "register", homework: "book", fees: "rupee", requests: "inbox", employees: "briefcase" };

// sections: [[value, label, badgeCount?], …], already filtered by role.
// Wide screens: tabs in the top bar. Phones: an app-style bar at the bottom.
// onSettings: the owner's School settings, from the account menu.
export default function TopBar({ mode, onMode, sections, onSettings }) {
  const tabs = (className) => (
    <nav className={className} aria-label="Section">
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
          <Logo />
          {sections.length > 1 && tabs("segmented topbar-tabs")}
          <AccountMenu onSettings={onSettings} />
        </div>
      </header>
      {sections.length > 1 && tabs("tabbar")}
    </>
  );
}
