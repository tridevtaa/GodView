import { useEffect, useMemo, useState } from "react";
import { deleteTimetableSlot, listAssignments, listTimetable, saveTimetableSlot } from "../data/api.js";
import { usePeople } from "../data/usePeople.js";
import { peek, remember, swr } from "../data/cache.js";
import { gradeRank } from "./GradeFilter.jsx";
import { gradeLabel } from "./PersonCard.jsx";
import Icon from "./Icon.jsx";
import ClassSwitcher from "./ClassSwitcher.jsx";

const DAYS = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
];
const MIN_PERIODS = 8;
const classText = (c, s) => `${gradeLabel(c)}${s ? ` · ${s}` : ""}`;
const slotKey = (day, period) => `${day}|${period}`;

// The weekly timetable for a class: owners/admins set any class, a class's
// own class teacher sets just that class (same split as attendance);
// everyone who teaches the class sees it read-only. Period numbers only —
// no fixed clock times yet.
export default function TimetablePage({ school, session, students, me, isAdmin, readOnly = false, heading }) {
  const [slots, setSlots] = useState(() => (session ? peek(`timetable:${session.id}`) ?? null : null));
  useEffect(() => {
    if (session && slots) remember(`timetable:${session.id}`, slots);
  }, [slots, session]);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [mine, setMine] = useState(null);
  const { people: employees } = usePeople("employees", school.id, null);
  const teachers = useMemo(() => employees.filter((e) => e.status !== "left"), [employees]);
  const teacherName = useMemo(() => {
    const m = new Map(employees.map((e) => [(e.email || "").toLowerCase(), e.name]));
    return (email) => m.get(email) ?? email;
  }, [employees]);

  useEffect(() => {
    if (isAdmin || !session) return setMine([]);
    listAssignments(school.id).then(
      (rows) => setMine(rows.filter((a) => a.session_id === session.id && a.email === me && a.is_class_teacher)),
      () => setMine([])
    );
  }, [school.id, session, me, isAdmin]);

  useEffect(() => {
    if (!session) return;
    swr(`timetable:${session.id}`, () => listTimetable(school.id, session.id), setSlots).catch(() =>
      setError("Couldn’t load the timetable. Check your connection and try again.")
    );
  }, [school.id, session]);

  const groups = useMemo(() => {
    const m = new Map();
    for (const s of students) {
      if (!s.class) continue;
      const key = `${s.class}|${s.section ?? ""}`;
      m.set(key, [...(m.get(key) ?? []), s]);
    }
    return [...m.keys()]
      .sort((a, b) => {
        const [ca, sa] = a.split("|");
        const [cb, sb] = b.split("|");
        return gradeRank(ca) - gradeRank(cb) || sa.localeCompare(sb);
      })
      .map((key) => ({ key, klass: key.split("|")[0], section: key.split("|")[1] }));
  }, [students]);

  const canEdit = (g) => !readOnly && (isAdmin || (mine ?? []).some((a) => a.class === g.klass && (!a.section || a.section === g.section)));
  const group = groups.find((g) => g.key === filter) ?? groups[0];

  const [extraPeriods, setExtraPeriods] = useState(0);
  useEffect(() => setExtraPeriods(0), [group?.key]);
  const bySlot = useMemo(() => {
    const m = new Map();
    if (!group) return m;
    for (const s of slots ?? []) {
      if (s.class === group.klass && (s.section ?? "") === (group.section ?? "")) m.set(slotKey(s.day_of_week, s.period_no), s);
    }
    return m;
  }, [slots, group]);
  const periodCount = Math.max(MIN_PERIODS + extraPeriods, ...[...bySlot.values()].map((s) => s.period_no), 0);
  const periods = Array.from({ length: periodCount }, (_, i) => i + 1);

  const [editing, setEditing] = useState(null); // { day, period } | null
  const [draft, setDraft] = useState({ subject: "", teacher_email: "" });
  const [busy, setBusy] = useState(false);

  function startEdit(day, period) {
    const existing = bySlot.get(slotKey(day, period));
    setDraft({ subject: existing?.subject ?? "", teacher_email: existing?.teacher_email ?? "" });
    setEditing({ day, period });
    setError("");
  }

  async function saveCell() {
    if (!group || !editing) return;
    setBusy(true);
    setError("");
    try {
      const saved = await saveTimetableSlot(school.id, session.id, {
        klass: group.klass,
        section: group.section,
        day_of_week: editing.day,
        period_no: editing.period,
        subject: draft.subject,
        teacher_email: draft.teacher_email,
      });
      setSlots((xs) => {
        const rest = (xs ?? []).filter((s) => !(s.class === group.klass && (s.section ?? "") === (group.section ?? "") && s.day_of_week === editing.day && s.period_no === editing.period));
        return saved ? [...rest, saved] : rest;
      });
      setEditing(null);
    } catch {
      setError("Couldn’t save that period. Check you’re this class’s class teacher and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function removeCell(day, period) {
    if (!group) return;
    setBusy(true);
    setError("");
    try {
      await deleteTimetableSlot(school.id, session.id, { klass: group.klass, section: group.section, day_of_week: day, period_no: period });
      setSlots((xs) => (xs ?? []).filter((s) => !(s.class === group.klass && (s.section ?? "") === (group.section ?? "") && s.day_of_week === day && s.period_no === period)));
      setEditing(null);
    } catch {
      setError("Couldn’t remove that period.");
    } finally {
      setBusy(false);
    }
  }

  if (!session) return <p className="notice">Import your students first; the timetable is kept per session.</p>;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="sr-only">Timetable</h1>
          <div className="page-meta">{heading}</div>
        </div>
      </div>

      {error && <p className="notice notice-error">{error}</p>}
      {!groups.length && <p className="notice">You don’t have any classes this session yet. Ask the school’s owner to assign your classes.</p>}

      {groups.length > 1 && <ClassSwitcher groups={groups} value={group?.key ?? ""} onChange={setFilter} ariaLabel="Timetable for" />}

      {group && (
        <section className="tt-wrap">
          <div className="tt-head">
            <h2 className="tt-title">{classText(group.klass, group.section)}</h2>
            {!canEdit(group) && <span className="row-sub">{readOnly ? "View only." : "Only this class’s class teacher sets its timetable. You can see it here."}</span>}
          </div>
          <div className="tt-scroll">
            <table className="tt-grid">
              <thead>
                <tr>
                  <th className="tt-period-col">Period</th>
                  {DAYS.map(([d, label]) => (
                    <th key={d}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => (
                  <tr key={period}>
                    <th className="tt-period-col">{period}</th>
                    {DAYS.map(([day]) => {
                      const slot = bySlot.get(slotKey(day, period));
                      const isEditing = editing?.day === day && editing?.period === period;
                      return (
                        <td key={day} className={`tt-cell${isEditing ? " is-editing" : ""}${slot ? " has-slot" : ""}`}>
                          {isEditing ? (
                            <div className="tt-edit">
                              <input
                                className="input tt-subject"
                                value={draft.subject}
                                onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
                                placeholder="Subject"
                                maxLength={80}
                                autoFocus
                              />
                              <select className="tt-teacher" value={draft.teacher_email} onChange={(e) => setDraft((d) => ({ ...d, teacher_email: e.target.value }))}>
                                <option value="">No teacher</option>
                                {teachers.map((t) => (
                                  <option key={t.id} value={(t.email || "").toLowerCase()}>
                                    {t.name}
                                  </option>
                                ))}
                              </select>
                              <div className="tt-edit-actions">
                                <button type="button" className="btn-icon" onClick={saveCell} disabled={busy || !draft.subject.trim()} aria-label="Save">
                                  <Icon name="check" size={14} />
                                </button>
                                {slot && (
                                  <button type="button" className="btn-icon" onClick={() => removeCell(day, period)} disabled={busy} aria-label="Remove">
                                    <Icon name="trash" size={14} />
                                  </button>
                                )}
                                <button type="button" className="btn-icon" onClick={() => setEditing(null)} disabled={busy} aria-label="Cancel">
                                  <Icon name="x" size={14} />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button type="button" className="tt-cell-btn" onClick={() => canEdit(group) && startEdit(day, period)} disabled={!canEdit(group)}>
                              {slot ? (
                                <>
                                  <strong>{slot.subject}</strong>
                                  {slot.teacher_email && <span className="row-sub">{teacherName(slot.teacher_email)}</span>}
                                </>
                              ) : (
                                canEdit(group) && (
                                  <span className="tt-empty">
                                    <Icon name="plus" size={12} />
                                  </span>
                                )
                              )}
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canEdit(group) && (
            <button type="button" className="link-btn tt-add-period" onClick={() => setExtraPeriods((n) => n + 1)}>
              <Icon name="plus" size={14} /> Add a period
            </button>
          )}
        </section>
      )}
    </>
  );
}
