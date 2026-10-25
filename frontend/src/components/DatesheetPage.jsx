import { useEffect, useMemo, useRef, useState } from "react";
import { addDatesheetEntry, deleteDatesheetEntry, listDatesheet } from "../data/api.js";
import { peek, remember, swr } from "../data/cache.js";
import { gradeRank } from "./GradeFilter.jsx";
import { gradeLabel } from "./PersonCard.jsx";
import Icon from "./Icon.jsx";
import ClassSwitcher from "./ClassSwitcher.jsx";
import { haptic } from "../pwa/haptics.js";

const SUBJECTS = ["English", "Hindi", "Maths", "EVS", "Science", "Social Studies", "Punjabi", "Sanskrit", "Computer", "GK", "Drawing"];
const EXAMS = ["Unit Test 1", "Unit Test 2", "Periodic Test 1", "Periodic Test 2", "Half Yearly", "Term 1", "Term 2", "Final Exam"];
const classText = (c, s) => `${gradeLabel(c)}${s ? ` · ${s}` : ""}`;
const dayText = (d) => new Date(d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const iso = (d) => d.toISOString().slice(0, 10);

// The exam schedule for a class (or a section of it), set the same way as
// homework — teachers set it, parents see their child's. createAt: when set
// (a time), open the add-exam form (the + button).
export default function DatesheetPage({ school, session, students, me, isAdmin, readOnly = false, heading, createAt = 0 }) {
  const [dates, setDates] = useState(() => (session ? peek(`datesheet:${session.id}`) ?? null : null));
  useEffect(() => {
    if (session && dates) remember(`datesheet:${session.id}`, dates);
  }, [dates, session]);
  const [error, setError] = useState("");
  const [writing, setWriting] = useState(false);
  useEffect(() => {
    if (createAt && !readOnly) setWriting(true);
  }, [createAt, readOnly]);
  const [filter, setFilter] = useState(""); // "class|section" or ""

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
      .map(([key, kids]) => ({ key, klass: key.split("|")[0], section: key.split("|")[1], kids }));
  }, [students]);

  useEffect(() => {
    if (!session) return;
    swr(`datesheet:${session.id}`, () => listDatesheet(school.id, session.id), setDates).catch(() =>
      setError("Couldn’t load the datesheet. Check your connection and try again.")
    );
  }, [school.id, session]);

  const inFilter = (c, s) => {
    if (!filter) return true;
    const [fc, fs] = filter.split("|");
    return c === fc && (!s || !fs || s === fs);
  };

  const shownDates = (dates ?? []).filter((d) => inFilter(d.class, d.section));

  const byExamDate = useMemo(() => {
    const m = new Map();
    for (const d of shownDates) m.set(d.exam_date, [...(m.get(d.exam_date) ?? []), d]);
    return [...m].sort(([a], [b]) => a.localeCompare(b));
  }, [shownDates]);

  async function removeDate(id) {
    try {
      await deleteDatesheetEntry(id);
      setDates((xs) => xs.filter((x) => x.id !== id));
    } catch {
      setError("Couldn’t remove that exam.");
    }
  }

  if (!session) return <p className="notice">Import your students first; the datesheet is kept per session.</p>;

  const today = iso(new Date());
  const nextExam = (dates ?? []).filter((d) => d.exam_date >= today).sort((a, b) => a.exam_date.localeCompare(b.exam_date))[0];

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="sr-only">Datesheet</h1>
          <div className="page-meta">{heading}</div>
        </div>
        {groups.length > 0 && !writing && !readOnly && (
          <div className="page-actions">
            <button className="btn btn-primary" onClick={() => setWriting(true)}>
              <Icon name="plus" />
              Add exam
            </button>
          </div>
        )}
      </div>

      {!writing && nextExam && (
        <p className="row-sub ds-next">
          <Icon name="exam" size={14} /> Next: {nextExam.subject} ({nextExam.exam_name}) · {dayText(nextExam.exam_date)}
        </p>
      )}

      {error && <p className="notice notice-error">{error}</p>}
      {!groups.length && <p className="notice">You don’t have any classes this session yet. Ask the school’s owner to assign your classes.</p>}

      {writing && (
        <DatesheetForm schoolId={school.id} sessionId={session.id} groups={groups} isAdmin={isAdmin} initial={filter} onCancel={() => setWriting(false)}
          onSaved={(d) => setDates((xs) => [...(xs ?? []), d])} />
      )}

      {/* No "All classes" — a mixed-class datesheet read as cluttered, so
          it's always one class at a time, same as the syllabus. */}
      {!writing && groups.length > 1 && (
        <ClassSwitcher groups={groups} value={filter} onChange={setFilter} />
      )}

      {writing ? null : dates === null ? (
        <div className="card card-skeleton hw-skeleton" />
      ) : !filter && groups.length > 1 ? (
        <section className="hw-empty">
          <span className="hw-empty-icon">
            <Icon name="exam" size={22} />
          </span>
          <strong>Choose a class</strong>
          <p className="row-sub">Pick a class above to see its datesheet.</p>
        </section>
      ) : !byExamDate.length ? (
        <section className="hw-empty">
          <span className="hw-empty-icon">
            <Icon name="exam" size={22} />
          </span>
          <strong>No exams on the datesheet yet</strong>
          <p className="row-sub">{readOnly ? "The exam schedule teachers set appears here." : "Exams you add appear here and in parents’ Godview app right away."}</p>
        </section>
      ) : (
        byExamDate.map(([d, list]) => (
          <section key={d} className="hw-day">
            <h2 className="hw-day-title">{dayText(d)}</h2>
            <ul className="hw-list">
              {list.map((x) => (
                <li key={x.id} className="hw-card">
                  <div className="hw-card-head">
                    <span className="tag">{x.section ? classText(x.class, x.section) : `${gradeLabel(x.class)} · all sections`}</span>
                    <strong>{x.subject}</strong>
                    <span className="badge badge-brand">{x.exam_name}</span>
                  </div>
                  {(x.start_time || x.notes) && (
                    <p className="hw-body">
                      {x.start_time && <>At {x.start_time}. </>}
                      {x.notes}
                    </p>
                  )}
                  <div className="hw-foot">
                    <span className="row-sub">{x.author_name || x.created_by}</span>
                    {!readOnly && (x.created_by === me || isAdmin) && (
                      <button className="icon-btn-sm" onClick={() => removeDate(x.id)} aria-label="Remove exam" title="Remove">
                        <Icon name="trash" size={15} />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

function DatesheetForm({ schoolId, sessionId, groups, isAdmin, initial, onCancel, onSaved }) {
  const [target, setTarget] = useState(initial || groups[0]?.key || "");
  const [whole, setWhole] = useState(false);
  const [form, setForm] = useState({ exam_name: "", subject: "", exam_date: "", start_time: "", notes: "" });
  // Exams posted this time round, so the form can stay open for the next one
  // instead of closing and having to be reopened for every subject.
  const [added, setAdded] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const subjectRef = useRef(null);
  const group = groups.find((g) => g.key === target);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const ok = group && form.exam_name.trim() && form.subject.trim() && form.exam_date;

  async function submit(e) {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      const saved = await addDatesheetEntry(schoolId, sessionId, { klass: group.klass, section: whole ? null : group.section, ...form });
      onSaved(saved);
      haptic("success");
      // Same exam name stays filled in — ready for the next subject.
      setAdded((a) => [...a, saved.subject]);
      setForm((f) => ({ ...f, subject: "", exam_date: "", start_time: "", notes: "" }));
      subjectRef.current?.focus();
    } catch {
      setError("Couldn’t save that exam. Check you teach this class and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="hw-form" onSubmit={submit}>
      <ClassSwitcher groups={groups} value={target} onChange={setTarget} ariaLabel="Exam for" />
      {isAdmin && group?.section && (
        <label className="checkbox checkbox-inline">
          <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />
          <span>All sections of {gradeLabel(group.klass)}</span>
        </label>
      )}
      {added.length > 0 && (
        <p className="row-sub syll-added">
          <Icon name="check" size={13} /> Added {added.join(", ")}. Keep going, or Done when finished.
        </p>
      )}
      <div className="form-grid">
        <label>
          <span>Exam</span>
          <input className="input" list="ds-exams" value={form.exam_name} onChange={set("exam_name")} placeholder="e.g. Term 1" maxLength={80} required />
          <datalist id="ds-exams">
            {EXAMS.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </label>
        <label>
          <span>Subject</span>
          <input ref={subjectRef} className="input" list="ds-subjects" value={form.subject} onChange={set("subject")} placeholder="e.g. Maths" maxLength={80} required />
          <datalist id="ds-subjects">
            {SUBJECTS.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </label>
        <label>
          <span>Date</span>
          <input className="input" type="date" value={form.exam_date} onChange={set("exam_date")} required />
        </label>
        <label>
          <span>Time (optional)</span>
          <input className="input" value={form.start_time} onChange={set("start_time")} placeholder="e.g. 9:00 AM" maxLength={20} />
        </label>
      </div>
      <input className="input" value={form.notes} onChange={set("notes")} placeholder="Notes, e.g. Bring a calculator (optional)" maxLength={500} aria-label="Notes" />

      {error && <p className="field-error">{error}</p>}
      <div className="hw-form-foot">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          {added.length ? "Done" : "Cancel"}
        </button>
        <button className="btn btn-primary" disabled={busy || !ok}>
          {busy ? "Saving…" : added.length ? "Add next exam" : "Add to datesheet"}
        </button>
      </div>
    </form>
  );
}
