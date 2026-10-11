import { useCallback, useState } from "react";
import { useDismiss } from "./useDismiss.js";
import Logo from "./Logo.jsx";
import AccountMenu from "./AccountMenu.jsx";
import Icon from "./Icon.jsx";

const ICONS = { students: "users", academics: "academics", attendance: "register", homework: "book", fees: "rupee", requests: "inbox", employees: "briefcase", transport: "bus" };

// sections: [[value, label, badgeCount?], …], already filtered by role.
// Wide screens: tabs in the top bar. Phones: an app-style bar at the bottom.
// onSettings: the owner's School settings, from the account menu.
// session: the session picker, shown beside the logo.
// actions: [[key, label, icon], …] for the + in the middle of the phone tab
// bar (everything you can create); onAction(key) runs one.
export default function TopBar({ mode, onMode, sections, onSettings, session, actions = [], onAction }) {
  const [sheet, setSheet] = useState(false);
  const sheetRef = useDismiss(sheet, useCallback(() => setSheet(false), []));
  const half = Math.ceil(sections.length / 2);
  const plus = actions.length > 0 && (
    <div className="tab-plus-wrap" ref={sheetRef} key="plus">
      <button className={`tab-plus${sheet ? " is-open" : ""}`} onClick={() => setSheet((o) => !o)} aria-label="Create" aria-expanded={sheet}>
        <Icon name="create" size={26} weight={sheet ? "fill" : "regular"} className="tab-icon" />
      </button>
      {sheet && (
        <div className="plus-sheet" role="menu">
          {actions.map(([key, label, icon]) => (
            <button
              key={key}
              role="menuitem"
              onClick={() => {
                setSheet(false);
                onAction(key);
              }}
            >
              <span className="plus-sheet-icon">
                <Icon name={icon} size={20} />
              </span>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
  const tabs = (className) => (
    <nav className={className} aria-label="Section">
      {sections.map(([value, label, count], i) => [
        className === "tabbar" && i === half && plus,
        (
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
        ),
      ])}
      {className === "tabbar" && sections.length === half && plus}
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
          {sections.length > 1 && tabs("segmented topbar-tabs")}
          <AccountMenu onSettings={onSettings} />
        </div>
      </header>
      {sections.length > 1 && tabs("tabbar")}
    </>
  );
}
