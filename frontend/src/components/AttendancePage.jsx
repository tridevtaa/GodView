import { useCallback, useEffect, useMemo, useState } from "react";
import { attendanceOverview, leaveOn, listAssignments, loadAttendance, saveAttendance } from "../data/api.js";
import { gradeRank } from "./GradeFilter.jsx";
import { Photo, gradeLabel } from "./PersonCard.jsx";
import Icon from "./Icon.jsx";

export const MARKS = [
  ["present", "P", "Present"],
  ["absent", "A", "Absent"],
  ["late", "L", "Late"],
  ["leave", "Lv", "Leave"],
];
const iso = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const todayIso = () => iso(new Date());
const shift = (day, n) => iso(new Date(new Date(`${day}T12:00:00`).getTime() + n * 864e5));
const dayText = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });
const timeText = (t) => new Date(t).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const classText = (c, s) => `${gradeLabel(c)}${s ? ` · ${s}` : ""}`;

// The morning register. Teachers open their class, everyone starts Present
// (or Leave, if a leave request was approved), they tap the exceptions and
// save. Owners and admins also get an overview of every class for the day.
export default function AttendancePage({ school, session, students, isAdmin, me }) {
  const [day, setDay] = useState(todayIso());
  // Classes this person is class teacher of (only they mark attendance;
  // owners and admins can mark any class).
  const [mine, setMine] = useState(null);
  useEffect(() => {
    if (isAdmin || !session) return setMine([]);
    listAssignments(school.id).then(
      (rows) => setMine(rows.filter((a) => a.session_id === session.id && a.email === me && a.is_class_teacher)),
      () => setMine([])
    );
  }, [school.id, session, me, isAdmin]);
  const canMark = (g) => isAdmin || (mine ?? []).some((a) => a.class === g.klass && (!a.section || a.section === g.section));
  const groups = useMemo(() => {
    const m = new Map();
    for (const s of students) {
      if (!s.class || s.status === "left") continue;
      const key = `${s.class}|${s.section ?? ""}`;
      m.set(key, [...(m.get(key) ?? []), s]);
    }
    return [...m]
      .sort(([a], [b]) => {
        const [ca, sa] = a.split("|");
        const [cb, sb] = b.split("|");
        return gradeRank(ca) - gradeRank(cb) || sa.localeCompare(sb);
      })
      .map(([key, kids]) => ({
        key,
        klass: key.split("|")[0],
        section: key.split("|")[1],
        kids: kids.sort((x, y) => (Number(x.roll_no) || 999) - (Number(y.roll_no) || 999) || x.name.localeCompare(y.name)),
      }));
  }, [students]);
  // Teachers land on the class they're class teacher of (else their first
  // class); admins on the overview.
  const [open, setOpen] = useState(isAdmin ? "" : null);
  useEffect(() => {
    if (isAdmin || open !== null || mine === null || !groups.length) return;
    setOpen((groups.find((g) => canMark(g)) ?? groups[0]).key);
  }, [groups, isAdmin, open, mine]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session) return <p className="notice">Import your students first; attendance is kept per session.</p>;
  const group = groups.find((g) => g.key === open);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="sr-only">Attendance</h1>
          <div className="page-meta">
            <span className="page-count">Attendance</span>
          </div>
        </div>
        <div className="att-day">
          <button className="btn-icon" onClick={() => setDay((d) => shift(d, -1))} aria-label="Previous day">
            <Icon name="arrowLeft" size={18} />
          </button>
          <label className="att-day-pick">
            <strong>{day === todayIso() ? "Today" : dayText(day)}</strong>
            {day === todayIso() && <span className="row-sub">{dayText(day)}</span>}
            <input type="date" value={day} max={todayIso()} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Pick a day" />
          </label>
          <button className="btn-icon" onClick={() => setDay((d) => shift(d, 1))} disabled={day >= todayIso()} aria-label="Next day">
            <Icon name="arrowRight" size={18} />
          </button>
        </div>
      </div>

      {!groups.length ? (
        <p className="notice">You don’t have any classes this session yet. Ask the school’s owner to assign your classes.</p>
      ) : (
        <nav className="hw-filter" aria-label="Class">
          {isAdmin && (
            <button className={!open ? "is-on" : ""} onClick={() => setOpen("")}>
              All classes
            </button>
          )}
          {groups.map((g) => (
            <button key={g.key} className={open === g.key ? "is-on" : ""} onClick={() => setOpen(g.key)}>
              {!isAdmin && canMark(g) && "★ "}
              {classText(g.klass, g.section)}
            </button>
          ))}
        </nav>
      )}

      {group ? (
        <Register key={`${group.key}|${day}`} school={school} session={session} day={day} group={group} canMark={canMark(group)} />
      ) : isAdmin && groups.length > 0 ? (
        <Overview session={session} day={day} onOpen={setOpen} />
      ) : null}
    </>
  );
}

function Register({ school, session, day, group, canMark }) {
  const [marks, setMarks] = useState(null); // student id -> status
  const [saved, setSaved] = useState(null); // { by, at } when already marked
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadAttendance(session.id, day), leaveOn(session.id, day).catch(() => [])]).then(
      ([rows, onLeave]) => {
        if (cancelled) return;
        const got = new Map(rows.map((r) => [r.student_id, r]));
        const leave = new Set(onLeave);
        const m = {};
        let last = null;
        for (const k of group.kids) {
          const r = got.get(k.id);
          m[k.id] = r?.status ?? (leave.has(k.id) ? "leave" : canMark ? "present" : "");
          if (r && (!last || r.marked_at > last.marked_at)) last = r;
        }
        setMarks(m);
        setSaved(last ? { by: last.marked_by, at: last.marked_at } : null);
      },
      () => !cancelled && setError("Couldn’t load the register. Check your connection and try again.")
    );
    return () => {
      cancelled = true;
    };
  }, [session.id, day, group, canMark]);

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, leave: 0 };
    for (const v of Object.values(marks ?? {})) if (v) c[v] += 1;
    return c;
  }, [marks]);

  const set = useCallback((id, status) => {
    setMarks((m) => ({ ...m, [id]: status }));
    setDirty(true);
    setDone(false);
  }, []);

  async function save() {
    setBusy(true);
    setError("");
    try {
      await saveAttendance(school.id, session.id, day, Object.entries(marks).map(([student_id, status]) => ({ student_id, status })));
      setSaved({ by: "you", at: new Date().toISOString() });
      setDirty(false);
      setDone(true);
    } catch {
      setError("Couldn’t save attendance. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !marks) return <p className="notice notice-error">{error}</p>;
  if (!marks) return <div className="card card-skeleton att-skeleton" />;

  return (
    <section className="att-register">
      <div className="att-register-head">
        <div>
          <h2>{classText(group.klass, group.section)}</h2>
          <p className="row-sub">
            {saved
              ? `Marked by ${saved.by} at ${timeText(saved.at)}`
              : canMark
                ? "Not marked yet: everyone starts as present. Tap anyone who isn’t."
                : "Not marked yet."}
          </p>
          {!canMark && <p className="att-readonly">Only this class’s class teacher marks attendance. You can see it here.</p>}
        </div>
        {canMark && (
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => {
            setMarks(Object.fromEntries(Object.keys(marks).map((id) => [id, "present"])));
            setDirty(true);
          }}
        >
          All present
        </button>
        )}
      </div>

      <ul className="att-list">
        {group.kids.map((k) => (
          <li key={k.id} className={`att-row is-${marks[k.id]}`}>
            <Photo person={k} className="att-photo" />
            <span className="att-name">
              <strong>{k.name}</strong>
              {k.roll_no && <span className="row-sub">Roll {k.roll_no}</span>}
            </span>
            <span className="att-marks" role="radiogroup" aria-label={`${k.name} attendance`}>
              {MARKS.map(([v, short, label]) => (
                <button key={v} role="radio" aria-checked={marks[k.id] === v} aria-label={label} title={label} disabled={!canMark} className={`att-mark att-${v}${marks[k.id] === v ? " is-on" : ""}`} onClick={() => set(k.id, v)}>
                  {short}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>

      {canMark && (
      <div className="att-save">
        <span className="att-tally">
          <b className="t-present">{counts.present}</b> present · <b className="t-absent">{counts.absent}</b> absent
          {counts.late > 0 && (
            <>
              {" "}
              · <b className="t-late">{counts.late}</b> late
            </>
          )}
          {counts.leave > 0 && (
            <>
              {" "}
              · <b className="t-leave">{counts.leave}</b> leave
            </>
          )}
        </span>
        {error && <span className="field-error">{error}</span>}
        <button className="btn btn-primary" onClick={save} disabled={busy || (!dirty && Boolean(saved))}>
          <Icon name="check" />
          {busy ? "Saving…" : done ? "Saved" : saved && !dirty ? "Saved" : "Save attendance"}
        </button>
      </div>
      )}
    </section>
  );
}

function Overview({ session, day, onOpen }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setRows(null);
    attendanceOverview(session.id, day).then(
      (r) => setRows(r.sort((a, b) => gradeRank(a.class) - gradeRank(b.class) || a.section.localeCompare(b.section))),
      () => setError("Couldn’t load the overview.")
    );
  }, [session.id, day]);

  if (error) return <p className="notice notice-error">{error}</p>;
  if (!rows) return <div className="card card-skeleton att-skeleton" />;

  const total = rows.reduce((t, r) => t + Number(r.students), 0);
  const present = rows.reduce((t, r) => t + Number(r.present) + Number(r.late), 0);
  const marked = rows.reduce((t, r) => t + Number(r.students) - Number(r.unmarked), 0);
  const notMarked = rows.filter((r) => Number(r.unmarked) === Number(r.students));

  return (
    <>
      <section className="fee-cards att-stats">
        <div className="fee-card">
          <span>Present</span>
          <strong className="is-paid">{marked ? `${Math.round((present / marked) * 100)}%` : "–"}</strong>
          <span className="row-sub">
            {present} of {marked} marked
          </span>
        </div>
        <div className="fee-card">
          <span>Absent</span>
          <strong className="is-due">{rows.reduce((t, r) => t + Number(r.absent), 0)}</strong>
          <span className="row-sub">{rows.reduce((t, r) => t + Number(r.on_leave), 0)} on leave</span>
        </div>
        <div className="fee-card">
          <span>Classes not marked</span>
          <strong className={notMarked.length ? "is-overdue" : "is-paid"}>{notMarked.length}</strong>
          <span className="row-sub">of {rows.length} classes</span>
        </div>
        <div className="fee-card">
          <span>Students</span>
          <strong>{total}</strong>
          <span className="row-sub">{total - marked} not marked</span>
        </div>
      </section>
      <section className="panel">
        <h2 className="panel-title">Classes</h2>
        <ul className="att-overview">
          {rows.map((r) => {
            const m = Number(r.students) - Number(r.unmarked);
            const pct = m ? Math.round(((Number(r.present) + Number(r.late)) / m) * 100) : 0;
            return (
              <li key={`${r.class}|${r.section}`}>
                <button onClick={() => onOpen(`${r.class}|${r.section}`)}>
                  <span className="att-ov-name">
                    {classText(r.class, r.section)}
                    <span className="row-sub">{r.class_teacher || "No class teacher"}</span>
                  </span>
                  {m === 0 ? (
                    <span className="badge badge-danger">Not marked</span>
                  ) : (
                    <span className="att-ov-bar" title={`${pct}% present`}>
                      <span style={{ width: `${pct}%` }} />
                    </span>
                  )}
                  <span className="att-ov-nums">
                    {m === 0 ? `${r.students} students` : `${Number(r.present) + Number(r.late)}/${m}${Number(r.absent) ? ` · ${r.absent} absent` : ""}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
