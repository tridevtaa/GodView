import { useMemo, useState } from "react";
import { gradeRank } from "./GradeFilter.jsx";
import { gradeLabel } from "./PersonCard.jsx";

export const classOf = (p) => `${gradeLabel(p.class)}${p.section ? ` · ${p.section}` : ""}`;

// Everyone by class, in school order: [{ key, label, ids }]
function classGroups(people) {
  const groups = new Map();
  for (const p of people) {
    const key = `${p.class}|${p.section ?? ""}`;
    if (!groups.has(key)) groups.set(key, { key, klass: p.class ?? "", label: classOf(p), ids: [] });
    groups.get(key).ids.push(p.id);
  }
  return [...groups.values()].sort((a, b) => gradeRank(a.klass) - gradeRank(b.klass) || a.label.localeCompare(b.label));
}

// The selection in words: whole classes by name, the rest by name or count.
export function describePicked(people, picked) {
  if (picked.size === people.length) return "All students";
  const whole = classGroups(people).filter((g) => g.ids.every((id) => picked.has(id)));
  const inWhole = new Set(whole.flatMap((g) => g.ids));
  const loose = people.filter((p) => picked.has(p.id) && !inWhole.has(p.id));
  const parts = [];
  if (whole.length) parts.push(whole.length <= 2 ? whole.map((g) => g.label).join(", ") : `${whole.length} classes`);
  if (loose.length) parts.push(loose.length <= 2 ? loose.map((p) => p.name).join(", ") : `${loose.length} students`);
  return parts.join(" + ").slice(0, 200);
}

// Who: whole classes, any students in or out. picked: a Set of ids; onChange
// gets the next Set. presets: extra chips, [{ label, ids }], like "Fees overdue".
const LIST_MAX = 60;
export default function StudentPicker({ people, picked, onChange, presets = [] }) {
  const [find, setFind] = useState("");
  const groups = useMemo(() => classGroups(people), [people]);
  const setMany = (ids, on) => {
    const next = new Set(picked);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    onChange(next);
  };
  const chip = (key, label, ids) => {
    const n = ids.filter((id) => picked.has(id)).length;
    return (
      <button key={key} type="button" className={`chip-btn${n === ids.length ? " is-on" : n ? " is-part" : ""}`} onClick={() => setMany(ids, n !== ids.length)} aria-pressed={n === ids.length}>
        {label}
      </button>
    );
  };
  const q = find.trim().toLowerCase();
  const matches = q ? people.filter((p) => `${p.name} ${p.admission_no ?? ""}`.toLowerCase().includes(q)) : people.filter((p) => picked.has(p.id));

  return (
    <>
      <h3>Classes</h3>
      <div className="filter-chips">
        {chip("all", "All", people.map((p) => p.id))}
        {presets.filter((x) => x.ids.length).map((x) => chip(x.label, x.label, x.ids))}
        {groups.map((g) => chip(g.key, g.label, g.ids))}
      </div>
      <h3>Students</h3>
      <input className="input export-find" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a student to add" aria-label="Find a student" />
      {matches.length > 0 ? (
        <ul className="export-list">
          {matches.slice(0, LIST_MAX).map((p) => (
            <li key={p.id}>
              <label>
                <input type="checkbox" checked={picked.has(p.id)} onChange={(e) => setMany([p.id], e.target.checked)} />
                <span>{p.name}</span>
                <em>{classOf(p)}</em>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="row-sub export-none">{q ? "No student matches that." : "Pick a class, or find a student."}</p>
      )}
      {matches.length > LIST_MAX && (
        <p className="row-sub export-none">
          Showing {LIST_MAX} of {matches.length.toLocaleString("en-IN")}. Search to find the rest.
        </p>
      )}
    </>
  );
}
