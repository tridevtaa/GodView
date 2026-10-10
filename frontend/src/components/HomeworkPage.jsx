import { useEffect, useMemo, useState } from "react";
import { addHomework, deleteHomework, listHomework } from "../data/api.js";
import { gradeRank } from "./GradeFilter.jsx";
import { Photo, gradeLabel } from "./PersonCard.jsx";
import Icon from "./Icon.jsx";
import ClassSwitcher from "./ClassSwitcher.jsx";

const SUBJECTS = ["English", "Hindi", "Maths", "EVS", "Science", "Social Studies", "Punjabi", "Sanskrit", "Computer", "GK", "Drawing"];
const iso = (d) => d.toISOString().slice(0, 10);
const tomorrow = () => iso(new Date(Date.now() + 864e5));
const dayText = (d) => new Date(d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
const classText = (c, s) => `${gradeLabel(c)}${s ? ` · ${s}` : ""}`;

// Teachers set homework for a class (or only some students in it); parents
// see it in their app. Teachers see their own classes; owners and admins
// see every class and can set work for a whole class across sections.
export default function HomeworkPage({ school, session, students, me, isAdmin }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [writing, setWriting] = useState(false);
  const [filter, setFilter] = useState(""); // "class|section" or ""

  // The classes this person can set work for, from the students they see.
  const groups = useMemo(() => {
    const m = new Map();
    for (const s of students) {
      if (!s.class) continue;
      const key = `${s.class}|${s.section ?? ""}`;
      m.set(key, [...(m.get(key) ?? []), s]);
    }
    return [...m]
      .sort(([a], [b]) => {
        const [ca, sa] = a.split("|");
        const [cb, sb] = b.split("|");
        return gradeRank(ca) - gradeRank(cb) || sa.localeCompare(sb);
      })
      .map(([key, kids]) => ({ key, klass: key.split("|")[0], section: key.split("|")[1], kids: kids.sort((x, y) => x.name.localeCompare(y.name)) }));
  }, [students]);

  useEffect(() => {
    if (!session) return;
    listHomework(school.id, session.id).then(setItems, () => setError("Couldn’t load homework. Check your connection and try again."));
  }, [school.id, session]);

  const shown = (items ?? []).filter((h) => {
    if (!filter) return true;
    const [c, s] = filter.split("|");
    return h.class === c && (!h.section || !s || h.section === s);
  });

  // Group by the day it was set.
  const byDay = useMemo(() => {
    const m = new Map();
    for (const h of shown) {
      const d = h.created_at.slice(0, 10);
      m.set(d, [...(m.get(d) ?? []), h]);
    }
    return [...m];
  }, [shown]);

  async function remove(id) {
    try {
      await deleteHomework(id);
      setItems((xs) => xs.filter((x) => x.id !== id));
    } catch {
      setError("Couldn’t remove that homework.");
    }
  }

  if (!session) return <p className="notice">Import your students first; homework is kept per session.</p>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="sr-only">Homework</h1>
          <div className="page-meta">
            <span className="page-count">Homework</span>
            <span className="badge badge-neutral">Session {session.name}</span>
          </div>
        </div>
        {groups.length > 0 && !writing && (
          <div className="page-actions">
            <button className="btn btn-primary" onClick={() => setWriting(true)}>
              <Icon name="plus" />
              Give homework
            </button>
          </div>
        )}
      </div>

      {error && <p className="notice notice-error">{error}</p>}
      {!groups.length && <p className="notice">You don’t have any classes this session yet. Ask the school’s owner to assign your classes.</p>}

      {writing && (
        <HomeworkForm
          schoolId={school.id}
          sessionId={session.id}
          groups={groups}
          isAdmin={isAdmin}
          initial={filter}
          onCancel={() => setWriting(false)}
          onSaved={(h) => {
            setItems((xs) => [h, ...(xs ?? [])]);
            setWriting(false);
          }}
        />
      )}

      {groups.length > 1 && (
        <ClassSwitcher groups={groups} value={filter} onChange={setFilter} allLabel="All classes" />
      )}

      {items === null ? (
        <div className="card card-skeleton hw-skeleton" />
      ) : !byDay.length ? (
        <section className="hw-empty">
          <span className="hw-empty-icon">
            <Icon name="book" size={22} />
          </span>
          <strong>No homework yet</strong>
          <p className="row-sub">Homework you give appears here and in parents’ Godview app the moment you send it.</p>
        </section>
      ) : (
        byDay.map(([d, list]) => (
          <section key={d} className="hw-day">
            <h2 className="hw-day-title">{d === iso(new Date()) ? "Today" : dayText(d)}</h2>
            <ul className="hw-list">
              {list.map((h) => {
                const some = h.students?.length ?? 0;
                return (
                  <li key={h.id} className="hw-card">
                    <div className="hw-card-head">
                      <span className="tag">{h.section ? classText(h.class, h.section) : `${gradeLabel(h.class)} · all sections`}</span>
                      {h.subject && <strong>{h.subject}</strong>}
                      {some > 0 && <span className="badge badge-brand">For {some} student{some === 1 ? "" : "s"}</span>}
                    </div>
                    <p className="hw-body">{h.body}</p>
                    <div className="hw-foot">
                      <span className="row-sub">
                        {h.due_date ? `Due ${dayText(h.due_date)}` : "No due date"} · {h.author_name || h.created_by}
                      </span>
                      {(h.created_by === me || isAdmin) && (
                        <button className="link-btn" onClick={() => remove(h.id)}>
                          Remove
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

function HomeworkForm({ schoolId, sessionId, groups, isAdmin, initial, onCancel, onSaved }) {
  const [target, setTarget] = useState(initial || groups[0]?.key || "");
  const [whole, setWhole] = useState(false); // admins: every section of the class
  const [form, setForm] = useState({ subject: "", body: "", due_date: tomorrow() });
  const [some, setSome] = useState(false);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const group = groups.find((g) => g.key === target);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (!group || !form.body.trim()) return;
    if (some && !picked.length) return setError("Pick at least one student, or send it to the whole class.");
    setBusy(true);
    setError("");
    try {
      onSaved(
        await addHomework(
          schoolId,
          sessionId,
          { klass: group.klass, section: whole ? null : group.section, subject: form.subject, body: form.body, due_date: form.due_date },
          some ? picked : []
        )
      );
    } catch {
      setError("Couldn’t send the homework. Check you teach this class and try again.");
      setBusy(false);
    }
  }

  return (
    <form className="hw-form" onSubmit={submit}>
      <h2 className="panel-title">Give homework</h2>
      <ClassSwitcher groups={groups} value={target} onChange={(k) => (setTarget(k), setPicked([]))} ariaLabel="Homework for" />
      {isAdmin && group?.section && (
        <label className="checkbox checkbox-inline">
          <input type="checkbox" checked={whole} onChange={(e) => (setWhole(e.target.checked), setSome(false))} />
          <span>All sections of {gradeLabel(group.klass)}</span>
        </label>
      )}
      <div className="hw-row">
        <label>
          <span>Subject</span>
          <input className="input" list="hw-subjects" value={form.subject} onChange={set("subject")} placeholder="e.g. Maths" maxLength={80} />
          <datalist id="hw-subjects">
            {SUBJECTS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label>
          <span>Due</span>
          <input className="input" type="date" value={form.due_date} min={iso(new Date())} onChange={set("due_date")} />
        </label>
      </div>
      <label>
        <span>Homework</span>
        <textarea className="textarea" rows={3} maxLength={4000} value={form.body} onChange={set("body")} placeholder="e.g. Page 24, questions 1 to 10. Learn the spellings." required />
      </label>

      {!whole && group && (
        <div className="hw-who">
          <div className="segmented segmented-sm" role="radiogroup" aria-label="Who">
            <button type="button" className={!some ? "active" : ""} onClick={() => setSome(false)}>
              Whole class ({group.kids.length})
            </button>
            <button type="button" className={some ? "active" : ""} onClick={() => setSome(true)}>
              Some students
            </button>
          </div>
          {some && (
            <ul className="hw-pick">
              {group.kids.map((k) => {
                const on = picked.includes(k.id);
                return (
                  <li key={k.id}>
                    <button type="button" className={on ? "is-on" : ""} onClick={() => setPicked((p) => (on ? p.filter((x) => x !== k.id) : [...p, k.id]))}>
                      <Photo person={k} className="hw-pick-photo" />
                      <span>{k.name}</span>
                      <span className="hw-pick-box">{on && <Icon name="check" size={12} />}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {error && <p className="field-error">{error}</p>}
      <div className="hw-form-foot">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy || !form.body.trim()}>
          {busy ? "Sending…" : some ? `Send to ${picked.length || "selected"} student${picked.length === 1 ? "" : "s"}` : "Send to class"}
        </button>
      </div>
    </form>
  );
}
