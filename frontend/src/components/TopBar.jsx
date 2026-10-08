import Logo from "./Logo.jsx";
import AccountMenu from "./AccountMenu.jsx";

const SECTIONS = [
  ["students", "Students"],
  ["employees", "Employees"],
];

export default function TopBar({ mode, onMode }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Logo />
        <nav className="segmented" aria-label="Section">
          {SECTIONS.map(([value, label]) => (
            <button
              key={value}
              className={mode === value ? "active" : ""}
              aria-current={mode === value ? "page" : undefined}
              onClick={() => onMode(value)}
            >
              {label}
            </button>
          ))}
        </nav>
        <AccountMenu />
      </div>
    </header>
  );
}
