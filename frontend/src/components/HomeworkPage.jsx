import { useEffect, useMemo, useState } from "react";
import { addHomework, addSyllabusEntry, deleteHomework, deleteSyllabusEntry, listHomework, listSyllabus } from "../data/api.js";
import { peek, remember, swr } from "../data/cache.js";
import { gradeRank } from "./GradeFilter.jsx";
import { Photo, gradeLabel } from "./PersonCard.jsx";
import Icon from "./Icon.jsx";
import StatCards from "./StatCards.jsx";
import ClassSwitcher from "./ClassSwitcher.jsx";
import { haptic } from "../pwa/haptics.js";

const SUBJECTS = ["English", "Hindi", "Maths", "EVS", "Science", "Social Studies", "Punjabi", "Sanskrit", "Computer", "GK", "Drawing"];
const iso = (d) => d.toISOString().slice(0, 10);
const tomorrow = () => iso(new Date(Date.now() + 864e5));
const dayText = (d) => new Date(d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
const classText = (c, s) => `${gradeLabel(c)}${s ? ` · ${s}` : ""}`;

// One screen, two tabs: homework, and the syllabus (topics covered) per
// subject. Teachers set homework for a class (or only some students in it);
// parents see it in their app. Teachers see their own classes; owners and
// admins see every class and can set work for a whole class across sections.
// readOnly: the principal sees every class's homework and syllabus but can't
// give, post or remove any.
// giveAt: when set (a time), open the homework form (the + button).
export default function HomeworkPage({ school, session, students, me, isAdmin, readOnly = false, heading, giveAt = 0 }) {
  const [view, setView] = useState("homework"); // "homework" | "syllabus"
  const [homework, setHomework] = useState(() => (session ? peek(`homework:${session.id}`) ?? null : null));
  const [syllabus, setSyllabus] = useState(() => (session ? peek(`syllabus:${session.id}`) ?? null : null));
  // Keep the remembered lists in step with what's on screen (new, removed).
  useEffect(() => {
    if (session && homework) remember(`homework:${session.id}`, homework);
  }, [homework, session]);
  useEffect(() => {
    if (session && syllabus) remember(`syllabus:${session.id}`, syllabus);
  }, [syllabus, session]);
  const [error, setError] = useState("");
  const [writing, setWriting] = useState(false);
  useEffect(() => {
    if (giveAt && !readOnly) (setView("homework"), setWriting(true));
  }, [giveAt, readOnly]);
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
    swr(`homework:${session.id}`, () => listHomework(school.id, session.id), setHomework).catch(() =>
      setError("Couldn’t load homework. Check your connection and try again.")
    );
    swr(`syllabus:${session.id}`, () => listSyllabus(school.id, session.id), setSyllabus).catch(() =>
      setError("Couldn’t load the syllabus. Check your connection and try again.")
    );
  }, [school.id, session]);

  const inFilter = (c, s) => {
    if (!filter) return true;
    const [fc, fs] = filter.split("|");
    return c === fc && (!s || !fs || s === fs);
  };

  const shown = (homework ?? []).filter((h) => inFilter(h.class, h.section));
  const shownSyllabus = (syllabus ?? []).filter((y) => inFilter(y.class, y.section));

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
      setHomework((xs) => xs.filter((x) => x.id !== id));
    } catch {
      setError("Couldn’t remove that homework.");
    }
  }
  async function removeSyllabus(id) {
    try {
      await deleteSyllabusEntry(id);
      setSyllabus((xs) => xs.filter((x) => x.id !== id));
    } catch {
      setError("Couldn’t remove that syllabus entry.");
    }
  }

  if (!session) return <p className="notice">Import your students first; homework and the syllabus are kept per session.</p>;

  const items = view === "homework" ? homework : syllabus;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="sr-only">Homework &amp; syllabus</h1>
          {/* The page's own switch sits on the same row as the Students one */}
          <div className="page-meta">
            {heading}
            {!writing && (
              <nav className="segmented segmented-sm page-switch" aria-label="Homework or syllabus">
                <button className={view === "homework" ? "active" : ""} onClick={() => setView("homework")}>
                  <Icon name="book" size={15} /> Homework
                </button>
                <button className={view === "syllabus" ? "active" : ""} onClick={() => setView("syllabus")}>
                  <Icon name="academics" size={15} /> Syllabus
                </button>
              </nav>
            )}
          </div>
        </div>
        {groups.length > 0 && !writing && !readOnly && (
          <div className="page-actions">
            <button className="btn btn-primary" onClick={() => setWriting(true)}>
              <Icon name="plus" />
              {view === "homework" ? "Give homework" : "Add syllabus"}
            </button>
          </div>
        )}
      </div>

      {!writing && view === "homework" && homework && (
        <StatCards
          items={(() => {
            const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
            const due = homework.filter((h) => h.due_date === tomorrow());
            const week = homework.filter((h) => h.created_at >= weekAgo);
            const classesWith = new Set(week.map((h) => `${h.class}|${h.section ?? ""}`)).size;
            return [
              { icon: "calendar", label: "Due tomorrow", value: due.length, tone: due.length ? "due" : undefined, color: due.length ? undefined : "indigo" },
              { icon: "book", color: "teal", label: "This week", value: week.length },
              {
                icon: "academics",
                color: "violet",
                label: "Classes",
                value: classesWith,
                bar: groups.length ? { value: classesWith, max: groups.length, label: `${classesWith} of ${groups.length} classes got homework this week` } : undefined,
              },
            ];
          })()}
        />
      )}

      {error && <p className="notice notice-error">{error}</p>}
      {!groups.length && <p className="notice">You don’t have any classes this session yet. Ask the school’s owner to assign your classes.</p>}

      {writing && view === "homework" && (
        <HomeworkForm
          schoolId={school.id}
          sessionId={session.id}
          groups={groups}
          isAdmin={isAdmin}
          initial={filter}
          onCancel={() => setWriting(false)}
          onSaved={(h) => {
            setHomework((xs) => [h, ...(xs ?? [])]);
            setWriting(false);
          }}
        />
      )}
      {writing && view === "syllabus" && (
        <SyllabusForm
          schoolId={school.id}
          sessionId={session.id}
          groups={groups}
          isAdmin={isAdmin}
          initial={filter}
          onCancel={() => setWriting(false)}
          onSaved={(y) => {
            setSyllabus((xs) => [y, ...(xs ?? [])]);
            setWriting(false);
          }}
        />
      )}

      {/* While writing, just the form. The class filter only when there's
          something to filter. */}
      {!writing && groups.length > 1 && items?.length > 0 && (
        <ClassSwitcher groups={groups} value={filter} onChange={setFilter} allLabel="All classes" />
      )}

      {writing ? null : items === null ? (
        <div className="card card-skeleton hw-skeleton" />
      ) : view === "homework" ? (
        !byDay.length ? (
          <section className="hw-empty">
            <span className="hw-empty-icon">
              <Icon name="book" size={22} />
            </span>
            <strong>No homework yet</strong>
            <p className="row-sub">{readOnly ? "Homework teachers give appears here." : "Homework you give appears here and in parents’ Godview app the moment you send it."}</p>
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
                        {!readOnly && (h.created_by === me || isAdmin) && (
                          <button className="icon-btn-sm" onClick={() => remove(h.id)} aria-label="Remove homework" title="Remove">
                            <Icon name="trash" size={15} />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )
      ) : !shownSyllabus.length ? (
        <section className="hw-empty">
          <span className="hw-empty-icon">
            <Icon name="academics" size={22} />
          </span>
          <strong>No syllabus posted yet</strong>
          <p className="row-sub">{readOnly ? "The syllabus teachers post appears here." : "Syllabus you post appears here and in parents’ Godview app right away."}</p>
        </section>
      ) : (
        <ul className="hw-list syll-list">
          {shownSyllabus.map((y) => (
            <li key={y.id} className="syll-card">
              <div className="syll-subject">
                <span className="tag">{y.section ? classText(y.class, y.section) : `${gradeLabel(y.class)} · all sections`}</span>
                <strong>{y.subject}</strong>
                <span className="row-sub">{y.author_name || y.created_by}</span>
              </div>
              <div className="syll-body-col">
                <p className="hw-body">{y.body}</p>
                {!readOnly && (y.created_by === me || isAdmin) && (
                  <button className="icon-btn-sm syll-remove" onClick={() => removeSyllabus(y.id)} aria-label="Remove syllabus entry" title="Remove">
                    <Icon name="trash" size={15} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function HomeworkForm({ schoolId, sessionId, groups, isAdmin, initial, onCancel, onSaved }) {
  const [target, setTarget] = useState(initial || groups[0]?.key || "");
  const [whole, setWhole] = useState(false); // admins: every section of the class
  const [form, setForm] = useState({ subject: "", body: "", due_date: tomorrow() });
  const [pickDate, setPickDate] = useState(false);
  const dayAfter = iso(new Date(Date.now() + 2 * 864e5));
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
      haptic("success");
    } catch {
      setError("Couldn’t send the homework. Check you teach this class and try again.");
      setBusy(false);
    }
  }

  return (
    <form className="hw-form" onSubmit={submit}>
      <ClassSwitcher groups={groups} value={target} onChange={(k) => (setTarget(k), setPicked([]))} ariaLabel="Homework for" />
      {isAdmin && group?.section && (
        <label className="checkbox checkbox-inline">
          <input type="checkbox" checked={whole} onChange={(e) => (setWhole(e.target.checked), setSome(false))} />
          <span>All sections of {gradeLabel(group.klass)}</span>
        </label>
      )}
      <input className="input" list="hw-subjects" value={form.subject} onChange={set("subject")} placeholder="Subject, e.g. Maths" maxLength={80} aria-label="Subject" />
      <datalist id="hw-subjects">
        {SUBJECTS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <textarea className="textarea" rows={3} maxLength={4000} value={form.body} onChange={set("body")} placeholder="Homework, e.g. Page 24, questions 1 to 10" aria-label="Homework" required />

      {/* Due: one tap for the usual days; a date only when needed. */}
      <div className="hw-due" role="radiogroup" aria-label="Due">
        <span className="row-sub">Due</span>
        {[
          [tomorrow(), "Tomorrow"],
          [dayAfter, "Day after"],
        ].map(([d, l]) => (
          <button type="button" key={d} className={`chip-btn${!pickDate && form.due_date === d ? " is-on" : ""}`} onClick={() => (setPickDate(false), setForm({ ...form, due_date: d }))}>
            {l}
          </button>
        ))}
        {pickDate ? (
          <input className="input hw-date" type="date" value={form.due_date} min={iso(new Date())} onChange={set("due_date")} aria-label="Due date" autoFocus />
        ) : (
          <button type="button" className="chip-btn" onClick={() => setPickDate(true)}>
            <Icon name="register" size={14} /> Date
          </button>
        )}
      </div>

      {!whole && group && (
        <div className="hw-who">
          <button type="button" className="link-btn" onClick={() => (setSome((v) => !v), setPicked([]))}>
            {some ? `Send to the whole class (${group.kids.length}) instead` : "Only for some students?"}
          </button>
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

function SyllabusForm({ schoolId, sessionId, groups, isAdmin, initial, onCancel, onSaved }) {
  const [target, setTarget] = useState(initial || groups[0]?.key || "");
  const [whole, setWhole] = useState(false);
  const [form, setForm] = useState({ subject: "", body: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const group = groups.find((g) => g.key === target);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const ok = group && form.subject.trim() && form.body.trim();

  async function submit(e) {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      onSaved(await addSyllabusEntry(schoolId, sessionId, { klass: group.klass, section: whole ? null : group.section, ...form }));
      haptic("success");
    } catch {
      setError("Couldn’t save the syllabus. Check you teach this class and try again.");
      setBusy(false);
    }
  }

  return (
    <form className="hw-form" onSubmit={submit}>
      <ClassSwitcher groups={groups} value={target} onChange={setTarget} ariaLabel="Syllabus for" />
      {isAdmin && group?.section && (
        <label className="checkbox checkbox-inline">
          <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />
          <span>All sections of {gradeLabel(group.klass)}</span>
        </label>
      )}
      <input className="input" list="syl-subjects" value={form.subject} onChange={set("subject")} placeholder="Subject, e.g. Maths" maxLength={80} required />
      <datalist id="syl-subjects">
        {SUBJECTS.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
      <textarea
        className="textarea"
        rows={4}
        maxLength={4000}
        value={form.body}
        onChange={set("body")}
        placeholder="Topics covered, e.g. Chapters 1-3: Numbers, Addition, Subtraction"
        aria-label="Syllabus"
        required
      />

      {error && <p className="field-error">{error}</p>}
      <div className="hw-form-foot">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy || !ok}>
          {busy ? "Saving…" : "Post syllabus"}
        </button>
      </div>
    </form>
  );
}
