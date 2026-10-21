import { useEffect, useState } from "react";
import { Photo } from "./PersonCard.jsx";
import Icon from "./Icon.jsx";
import { classTeachersFor } from "../data/api.js";

// A student's teachers this session, loaded once and shared by the
// student card (class teacher in the corner) and the class section.
// null while loading.
const teacherCache = new Map();
export function useClassTeachers(studentId, sessionId) {
  const key = `${studentId}:${sessionId}`;
  const [rows, setRows] = useState(() => (sessionId ? teacherCache.get(key)?.rows ?? null : []));
  useEffect(() => {
    if (!sessionId) return setRows([]);
    let live = true;
    let entry = teacherCache.get(key);
    if (!entry || Date.now() - entry.at > 120000) {
      entry = { at: Date.now(), rows: entry?.rows ?? null, load: classTeachersFor(studentId, sessionId).catch(() => []) };
      teacherCache.set(key, entry);
      entry.load.then((r) => (entry.rows = r));
    }
    entry.load.then((r) => live && setRows(r));
    return () => {
      live = false;
    };
  }, [key, studentId, sessionId]);
  return rows;
}

// The class teacher, for the top-right corner of the student card: a
// small round photo like the student's, and their name under it.
export function ClassTeacherBadge({ teachers }) {
  const lead = (teachers ?? []).find((t) => t.is_class_teacher);
  if (!lead) return null;
  return (
    <div className="ig-incharge" title={`Class teacher: ${lead.name}`}>
      <span className="ig-incharge-photo">
        <Photo person={lead} className="ig-photo-img" />
      </span>
      <span className="ig-incharge-text">
        <span>Class teacher</span>
        <strong>{shortName(lead.name)}</strong>
      </span>
    </div>
  );
}

// A student's class, for staff (student page) and parents (Home): the
// teachers (class teacher first, with a star) and the classmates as rows
// of faces to swipe through; See all lays a row out in full.
// teachers: null while loading. mates: [{ id, name, photo_src? }].
// onOpenMate: staff open a classmate's page.
export default function ClassCard({ title, teachers, mates, onOpenMate }) {
  // The class teacher is on the student card; here they lead the row
  const all = [...(teachers ?? [])].sort((a, b) => Number(b.is_class_teacher) - Number(a.is_class_teacher));
  if (teachers !== null && !teachers.length && !mates.length) return null;

  return (
    <section className="profile-group profile-facts class-card">
      <h3 className="facts-title">{title}</h3>
      {teachers === null && <div className="class-skeleton" aria-busy="true" />}
      {all.length > 0 && (
        <FaceRow
          label="Teachers"
          items={all.map((t) => ({ key: t.id ?? t.name, person: t, text: shortName(t.name), sub: t.is_class_teacher ? "Class teacher" : t.designation, star: t.is_class_teacher }))}
        />
      )}
      {mates.length > 0 && (
        <FaceRow
          label="Classmates"
          items={mates.map((p, i) => ({ key: p.id ?? `${p.name}-${i}`, person: p, text: shortName(p.name), onClick: onOpenMate && p.id ? () => onOpenMate(p.id) : null }))}
        />
      )}
    </section>
  );
}

// "Dr. Vishal Kumar" -> "Dr. Vishal"; "Aaryan Barman" -> "Aaryan"
function shortName(name = "") {
  const parts = name.trim().split(/\s+/);
  return parts[0]?.endsWith(".") && parts[1] ? `${parts[0]} ${parts[1]}` : parts[0] ?? "";
}

const ROW = 7; // more than this and the row swipes, with See all

function FaceRow({ label, items }) {
  const [all, setAll] = useState(false);
  const more = items.length > ROW;
  return (
    <div className="cc-row">
      <div className="cc-row-head">
        <span>
          {label} · {items.length}
        </span>
        {more && (
          <button type="button" className="link-btn" onClick={() => setAll((v) => !v)}>
            {all ? "Show less" : "See all"}
          </button>
        )}
      </div>
      <ul className={`class-faces${all ? " is-all" : ""}`}>
        {items.map((it) => {
          const inner = (
            <>
              <span className="class-face-photo">
                <Photo person={it.person} className="class-photo" />
                {it.star && (
                  <span className="class-face-star" aria-label="Class teacher">
                    <Icon name="star" size={11} weight="fill" />
                  </span>
                )}
              </span>
              <span className="class-face-name">{it.text}</span>
            </>
          );
          return (
            <li key={it.key} title={[it.person.name, it.sub].filter(Boolean).join(" · ")}>
              {it.onClick ? (
                <button type="button" className="class-face" onClick={it.onClick}>
                  {inner}
                </button>
              ) : (
                <span className="class-face">{inner}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
