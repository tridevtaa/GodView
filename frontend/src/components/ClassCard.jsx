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

// The class teacher, for the top-right corner of the student card: their
// round photo inside a thick navy ring, with "Class teacher" curved along
// the top of the ring and their name along the bottom, like a seal.
let badgeIds = 0;
export function ClassTeacherBadge({ teachers }) {
  const [id] = useState(() => `ct${++badgeIds}`);
  const lead = (teachers ?? []).find((t) => t.is_class_teacher);
  if (!lead) return null;
  const name = shortName(lead.name).toUpperCase();
  // Text sits in the middle of the ring (radius 40 of a 100 box): the top
  // line's baseline just inside, the bottom line's just outside.
  const fs = name.length > 12 ? 8 : 9;
  const top = 40 - fs * 0.36;
  const bottom = 40 + fs * 0.36;
  return (
    <div className="ig-incharge" title={`Class teacher: ${lead.name}`} aria-label={`Class teacher: ${lead.name}`}>
      <svg className="ig-incharge-ring" viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3a45a8" />
            <stop offset="1" stopColor="#1d2366" />
          </linearGradient>
          <path id={`${id}t`} d={`M ${50 - top} 50 A ${top} ${top} 0 0 1 ${50 + top} 50`} />
          <path id={`${id}b`} d={`M ${50 - bottom} 50 A ${bottom} ${bottom} 0 0 0 ${50 + bottom} 50`} />
        </defs>
        <circle cx="50" cy="50" r="40.5" fill="none" stroke={`url(#${id}g)`} strokeWidth="19" />
        <text className="ig-incharge-arc" fontSize="8.4">
          <textPath href={`#${id}t`} startOffset="50%" textAnchor="middle">
            CLASS TEACHER
          </textPath>
        </text>
        <text className="ig-incharge-arc is-name" fontSize={fs}>
          <textPath href={`#${id}b`} startOffset="50%" textAnchor="middle">
            {name}
          </textPath>
        </text>
        <circle cx="10" cy="50" r="1.6" className="ig-incharge-dot" />
        <circle cx="90" cy="50" r="1.6" className="ig-incharge-dot" />
      </svg>
      <span className="ig-incharge-photo">
        <Photo person={lead} className="ig-photo-img" />
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
