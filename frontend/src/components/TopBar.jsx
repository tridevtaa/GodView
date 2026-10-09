import Logo from "./Logo.jsx";
import AccountMenu from "./AccountMenu.jsx";

// sections: [[value, label, badgeCount?], …], already filtered by role.
export default function TopBar({ mode, onMode, sections }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Logo />
        {sections.length > 1 && (
          <nav className="segmented" aria-label="Section">
            {sections.map(([value, label, count]) => (
              <button
                key={value}
                className={mode === value ? "active" : ""}
                aria-current={mode === value ? "page" : undefined}
                onClick={() => onMode(value)}
              >
                {label}
                {count > 0 && <span className="seg-count">{count}</span>}
              </button>
            ))}
          </nav>
        )}
        <AccountMenu />
      </div>
    </header>
  );
}
