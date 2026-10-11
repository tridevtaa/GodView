import { useEffect, useMemo, useState } from "react";
import { Photo, gradeLabel } from "./PersonCard.jsx";
import Icon from "./Icon.jsx";

// A quick "which student?" search, e.g. for Add result from the + button.
export default function StudentPicker({ title, students, onPick, onClose }) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = students.filter((s) => s.status !== "left");
    return (q ? list.filter((s) => `${s.name} ${s.admission_no ?? ""} ${s.roll_no ?? ""}`.toLowerCase().includes(q)) : list).slice(0, 30);
  }, [query, students]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal picker" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="picker-head">
          <h2>{title}</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </header>
        <label className="search">
          <Icon name="search" />
          <input autoFocus placeholder="Student’s name or roll no." value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <ul className="picker-list">
          {matches.map((s) => (
            <li key={s.id}>
              <button onClick={() => onPick(s.id)}>
                <Photo person={s} className="inbox-photo" />
                <span className="inbox-main">
                  <strong>{s.name}</strong>
                  <span className="row-sub">
                    {gradeLabel(s.class)}
                    {s.section ? ` · ${s.section}` : ""}
                    {s.roll_no ? ` · Roll ${s.roll_no}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="row-sub picker-empty">No student matches “{query}”.</li>}
        </ul>
      </section>
    </div>
  );
}
