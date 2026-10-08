import Logo from "./Logo.jsx";
import GradeFilter from "./GradeFilter.jsx";

export default function TopBar({ mode, query, onQuery, grades, grade, onGrade, onAdd, onSwitch }) {
  const other = mode === "students" ? "Employees" : "Students";
  return (
    <header className="topbar">
      <Logo />
      <input
        className="search"
        type="search"
        placeholder={`Search ${mode === "students" ? "Students" : "Employees"}`}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      {mode === "students" && <GradeFilter options={grades} value={grade} onChange={onGrade} />}
      <button className="btn-add" onClick={onAdd}>
        Add
      </button>
      <button className="switch" onClick={onSwitch}>
        Switch to {other}
      </button>
      <button className="profile" aria-label="Profile">
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
          <circle cx="12" cy="7" r="5" />
          <path d="M2 23c0-6 4.5-9 10-9s10 3 10 9z" />
        </svg>
      </button>
    </header>
  );
}
