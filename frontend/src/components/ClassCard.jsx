import { useState } from "react";
import { Photo } from "./PersonCard.jsx";
import Icon from "./Icon.jsx";

// A student's class, for staff (student page) and parents (Home): the
// class teacher on top, then the other teachers and the classmates as
// rows of faces to swipe through; See all lays a row out in full.
// teachers: null while loading. mates: [{ id, name, photo_src? }].
// onOpenMate: staff open a classmate's page. onMessage: parents write to
// the school from the class teacher's row.
export default function ClassCard({ title, teachers, mates, onOpenMate, onMessage }) {
  const lead = (teachers ?? []).find((t) => t.is_class_teacher);
  const others = (teachers ?? []).filter((t) => t !== lead);
  if (teachers !== null && !teachers.length && !mates.length) return null;

  return (
    <section className="profile-group profile-facts class-card">
      <h3 className="facts-title">{title}</h3>
      {teachers === null && <div className="class-skeleton" aria-busy="true" />}
      {lead && (
        <div className="class-lead">
          <Photo person={lead} className="class-photo is-lead" />
          <span className="class-lead-text">
            <strong>{lead.name}</strong>
            <span className="class-lead-tag">
              <Icon name="star" size={12} weight="fill" /> Class teacher
            </span>
          </span>
          {onMessage && (
            <button type="button" className="ig-act ig-act-msg" onClick={onMessage} aria-label="Message the school" title="Message the school">
              <Icon name="message" size={18} />
            </button>
          )}
        </div>
      )}
      {others.length > 0 && (
        <FaceRow
          label="Teachers"
          items={others.map((t) => ({ key: t.id ?? t.name, person: t, text: shortName(t.name), sub: t.designation }))}
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
              <Photo person={it.person} className="class-photo" />
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
