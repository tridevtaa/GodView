import Logo from "./Logo.jsx";
import GradeFilter from "./GradeFilter.jsx";
import AccountMenu from "./AccountMenu.jsx";

export default function TopBar({ mode, query, onQuery, grades, grade, onGrade, onAdd, onImport, onSwitch }) {
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
      {onImport && (
        <button className="btn-filter" onClick={onImport}>
          Import
        </button>
      )}
      <button className="switch" onClick={onSwitch}>
        Switch to {other}
      </button>
      <AccountMenu />
    </header>
  );
}
