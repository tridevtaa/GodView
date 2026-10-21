import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { addCalendarEvent, deleteCalendarEvent, listCalendar, listDatesheet, updateCalendarEvent } from "../data/api.js";
import { peek, remember, swr } from "../data/cache.js";
import { DateLeaf, useNotices } from "./NoticeBoard.jsx";
import Icon from "./Icon.jsx";
import { gradeLabel } from "./PersonCard.jsx";
import { haptic } from "../pwa/haptics.js";

const DatesheetPage = lazy(() => import("./DatesheetPage.jsx"));
const AttendancePage = lazy(() => import("./AttendancePage.jsx"));

// What goes on the calendar, each with its icon (and colour, in CSS).
export const KINDS = [
  ["holiday", "Holiday"],
  ["exam", "Exam"],
  ["event", "Event"],
  ["meeting", "Meeting"],
  ["other", "Other"],
];
const KIND_LABEL = Object.fromEntries([...KINDS, ["notice", "Notice"]]);
const KIND_ICON = { holiday: "holiday", exam: "exam", event: "event", meeting: "meeting", other: "flag", notice: "notice" };

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayIso = () => iso(new Date());
const parse = (s) => new Date(`${s}T00:00:00`);
const short = (s) => parse(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const range = (it) => (it.end && it.end !== it.start ? `${short(it.start)} to ${short(it.end)}` : parse(it.start).toLocaleDateString("en-IN", { weekday: "long" }));
const covers = (it, day) => it.start <= day && (it.end ?? it.start) >= day;

// The school's calendar entries, remembered for the session.
function useCalendar(schoolId) {
  const key = `calendar:${schoolId}`;
  const [events, setEvents] = useState(() => peek(key) ?? null);
  useEffect(() => {
    if (schoolId) swr(key, () => listCalendar(schoolId), setEvents).catch(() => setEvents((e) => e ?? []));
  }, [schoolId, key]);
  const update = (fn) =>
    setEvents((e) => {
      const next = fn(e ?? []);
      remember(key, next);
      return next;
    });
  return [events, update];
}

// Calendar entries plus notices that carry a date, as one sorted list.
function useItems(schoolId, staff) {
  const [events, setEvents] = useCalendar(schoolId);
  const [notices] = useNotices(schoolId, staff);
  const items = useMemo(
    () =>
      [
        ...(events ?? []).map((e) => ({ id: e.id, source: "event", row: e, title: e.title, kind: e.kind, start: e.starts_on, end: e.ends_on, note: e.note, forParents: e.for_parents })),
        ...(notices ?? []).filter((n) => n.event_on).map((n) => ({ id: `n-${n.id}`, source: "notice", title: n.title, kind: "notice", start: n.event_on, end: null, note: "", forParents: n.for_parents })),
      ].sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title)),
    [events, notices]
  );
  return { items, loading: events === null, setEvents };
}

// The calendar page: a month at a glance and what's on, plus attendance and
// the exam datesheet as two more tabs (they're both dated, day-by-day
// information too, just kept per class rather than school-wide). Owners and
// admins add, change and remove calendar entries; everyone else reads.
// Attendance and the datesheet keep their own per-class permissions (see
// AttendancePage and DatesheetPage), unrelated to canEdit here.
// adding: open the calendar "add" form (from the +). dsCreateAt: open the
// datesheet's add-exam form (from the + on the exam quick action).
// attOpenAt: switch to the attendance tab (from Home or the + on Mark
// attendance). seesAttendance: hide the tab for teachers who aren't a class
// in-charge this session.
export default function CalendarPage({
  schoolId,
  canEdit = false,
  staff = false,
  adding = false,
  onAdding = () => {},
  onOpenNotices,
  session,
  students = [],
  me,
  dsIsAdmin = false,
  dsReadOnly = false,
  dsCreateAt = 0,
  seesAttendance = true,
  attIsAdmin = false,
  attReadOnly = false,
  attOpenAt = 0,
  onOpenStudent,
}) {
  const { items, loading, setEvents } = useItems(schoolId, staff);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [picked, setPicked] = useState(null); // a day, "YYYY-MM-DD"
  const [editing, setEditing] = useState(null); // an entry's row, or {} for new
  const [view, setView] = useState("calendar"); // "calendar" | "attendance" | "datesheet"

  useEffect(() => {
    if (adding) setEditing({ starts_on: picked ?? todayIso() });
  }, [adding]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (dsCreateAt) setView("datesheet");
  }, [dsCreateAt]);
  useEffect(() => {
    if (attOpenAt) setView("attendance");
  }, [attOpenAt]);

  const today = todayIso();
  const first = iso(month);
  const last = iso(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const inMonth = items.filter((it) => it.start <= last && (it.end ?? it.start) >= first);
  const shown = picked ? items.filter((it) => covers(it, picked)) : inMonth;

  // Weeks start on Monday; Sunday sits at the end, tinted.
  const cells = useMemo(() => {
    const start = new Date(month);
    start.setDate(1 - ((month.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    }).filter((d, i) => i < 35 || d.getMonth() === month.getMonth());
  }, [month]);

  const go = (step) => {
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + step, 1));
    setPicked(null);
  };
  const thisMonth = month.getFullYear() === new Date().getFullYear() && month.getMonth() === new Date().getMonth();

  function close() {
    setEditing(null);
    onAdding(false);
  }

  return (
    <div className="cal">
      {session && (
        <nav className="segmented segmented-sm ds-tabs" aria-label="Calendar, attendance or datesheet">
          <button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}>
            <Icon name="calendar" size={15} /> Calendar
          </button>
          {seesAttendance && (
            <button className={view === "attendance" ? "active" : ""} onClick={() => setView("attendance")}>
              <Icon name="register" size={15} /> Attendance
            </button>
          )}
          <button className={view === "datesheet" ? "active" : ""} onClick={() => setView("datesheet")}>
            <Icon name="exam" size={15} /> Datesheet
          </button>
        </nav>
      )}
      {view === "attendance" ? (
        <div className="cal-datesheet">
          <Suspense fallback={<div className="card card-skeleton" aria-busy="true" />}>
            <AttendancePage
              school={{ id: schoolId }}
              session={session}
              students={students}
              me={me}
              isAdmin={attIsAdmin}
              readOnly={attReadOnly}
              onOpenStudent={onOpenStudent}
            />
          </Suspense>
        </div>
      ) : view === "datesheet" ? (
        <div className="cal-datesheet">
          <Suspense fallback={<div className="card card-skeleton" aria-busy="true" />}>
            <DatesheetPage
              school={{ id: schoolId }}
              session={session}
              students={students}
              me={me}
              isAdmin={dsIsAdmin}
              readOnly={dsReadOnly}
              createAt={dsCreateAt}
            />
          </Suspense>
        </div>
      ) : (
        <>
          <section className="cal-card">
            <header className="cal-head">
              <button className="icon-btn-sm" onClick={() => go(-1)} aria-label="Previous month">
                <Icon name="chevronLeft" size={18} />
              </button>
              <h2 key={first}>{month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</h2>
              <button className="icon-btn-sm" onClick={() => go(1)} aria-label="Next month">
                <Icon name="chevronRight" size={18} />
              </button>
              {!thisMonth && (
                <button
                  className="link-btn cal-today"
                  onClick={() => {
                    const d = new Date();
                    setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                    setPicked(null);
                  }}
                >
                  Today
                </button>
              )}
            </header>
            <div className="cal-week" aria-hidden="true">
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
            <div className="cal-grid" key={first} role="grid" aria-label="Days">
              {cells.map((d) => {
                const day = iso(d);
                const on = items.filter((it) => covers(it, day));
                const kinds = [...new Set(on.map((it) => it.kind))].slice(0, 3);
                const out = d.getMonth() !== month.getMonth();
                const holiday = on.some((it) => it.kind === "holiday");
                return (
                  <button
                    key={day}
                    role="gridcell"
                    className={["cal-day", out && "is-out", day === today && "is-today", day === picked && "is-picked", holiday && "is-holiday", d.getDay() === 0 && "is-sunday"].filter(Boolean).join(" ")}
                    onClick={() => {
                      if (out) setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                      setPicked(day === picked ? null : day);
                    }}
                    aria-label={`${d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}${on.length ? `, ${on.map((it) => it.title).join(", ")}` : ""}`}
                    aria-selected={day === picked}
                  >
                    <span className="cal-num">{d.getDate()}</span>
                    <span className="cal-dots">
                      {kinds.map((k) => (
                        <i key={k} className={`k-${k}`} />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="cal-legend">
              {[...KINDS.slice(0, 4), ["notice", "Notice"]].map(([k, l]) => (
                <span key={k}>
                  <i className={`k-${k}`} /> {l}
                </span>
              ))}
            </div>
          </section>

          <section className="cal-list">
            <div className="cal-list-head">
              <h3>{picked ? parse(picked).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }) : `In ${month.toLocaleDateString("en-IN", { month: "long" })}`}</h3>
              {picked && (
                <button className="link-btn" onClick={() => setPicked(null)}>
                  Whole month
                </button>
              )}
              {canEdit && (
                <button className="btn btn-primary btn-sm cal-add" onClick={() => setEditing({ starts_on: picked ?? (thisMonth ? today : first) })}>
                  <Icon name="plus" /> Add
                </button>
              )}
            </div>
            {loading && <div className="nb-skeleton" aria-busy="true" />}
            {!loading && shown.length === 0 && <p className="row-sub cal-empty">{picked ? "Nothing on this day." : "Nothing on the calendar this month yet."}</p>}
            <ul>
              {shown.map((it, i) => (
                <li key={it.id} style={{ "--d": `${Math.min(i, 8) * 40}ms` }}>
                  <button
                    className={`cal-item k-${it.kind}${it.start < today && (it.end ?? it.start) < today ? " is-past" : ""}`}
                    onClick={() => (it.source === "event" ? canEdit && setEditing(it.row) : onOpenNotices?.())}
                    disabled={it.source === "event" && !canEdit}
                  >
                    <DateLeaf date={it.start} />
                    <span className="cal-item-main">
                      <strong>{it.title}</strong>
                      <span className="row-sub">
                        {range(it)}
                        {it.note ? ` · ${it.note}` : ""}
                      </span>
                    </span>
                    <span className="cal-kind">
                      <Icon name={KIND_ICON[it.kind]} size={14} /> {KIND_LABEL[it.kind]}
                    </span>
                    {staff && !it.forParents && (
                      <span className="nb-staff-only" title="Only staff can see this">
                        <Icon name="teacher" size={13} />
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {editing && (
        <EventEditor
          schoolId={schoolId}
          entry={editing}
          onClose={close}
          onSaved={(row, gone) => {
            setEvents((all) => (gone ? all.filter((e) => e.id !== row.id) : [...all.filter((e) => e.id !== row.id), row]));
            close();
          }}
        />
      )}
    </div>
  );
}

// Add or change an entry: what, which kind, when (one day or a few), a
// short note, and who sees it.
function EventEditor({ schoolId, entry, onClose, onSaved }) {
  const isNew = !entry.id;
  const [form, setForm] = useState({
    title: entry.title ?? "",
    kind: entry.kind ?? "event",
    starts_on: entry.starts_on ?? todayIso(),
    ends_on: entry.ends_on ?? "",
    note: entry.note ?? "",
    for_parents: entry.for_parents ?? true,
  });
  const [days, setDays] = useState(Boolean(entry.ends_on));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const badRange = days && form.ends_on && form.ends_on < form.starts_on;

  async function save(e) {
    e.preventDefault();
    if (!form.title.trim() || badRange) return;
    setBusy(true);
    setError("");
    const entryRow = { ...form, ends_on: days ? form.ends_on : null };
    try {
      onSaved(isNew ? await addCalendarEvent(schoolId, entryRow) : await updateCalendarEvent(entry.id, entryRow));
      haptic("success");
    } catch {
      setError("Couldn’t save. Check your connection and try again.");
      setBusy(false);
    }
  }
  async function remove() {
    if (!armed) return setArmed(true);
    setBusy(true);
    try {
      await deleteCalendarEvent(entry.id);
      onSaved(entry, true);
    } catch {
      setError("Couldn’t remove it. Check your connection.");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal nb-compose cal-editor" onClick={(e) => e.stopPropagation()} onSubmit={save} aria-label={isNew ? "Add to the calendar" : "Change calendar entry"}>
        <header className="modal-header">
          <h2>
            <Icon name="calendar" /> {isNew ? "Add to the calendar" : "Calendar entry"}
          </h2>
          <button type="button" className="icon-btn-sm" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="modal-body nb-form">
          <div className="cal-kinds" role="radiogroup" aria-label="Kind">
            {KINDS.map(([k, l]) => (
              <button type="button" key={k} role="radio" aria-checked={form.kind === k} className={`cal-kind-pick k-${k}${form.kind === k ? " is-on" : ""}`} onClick={() => setForm({ ...form, kind: k })}>
                <Icon name={KIND_ICON[k]} size={18} />
                <span>{l}</span>
              </button>
            ))}
          </div>
          <input className="textarea nb-title-input" value={form.title} onChange={set("title")} placeholder={{ holiday: "e.g. Diwali holidays", exam: "e.g. Half-yearly exams", meeting: "e.g. Parent-teacher meeting" }[form.kind] ?? "e.g. Annual sports day"} maxLength={120} required autoFocus={isNew} />
          <div className="cal-dates">
            <label>
              <span>{days ? "From" : "On"}</span>
              <input className="textarea" type="date" value={form.starts_on} onChange={set("starts_on")} required />
            </label>
            {days && (
              <label>
                <span>To</span>
                <input className="textarea" type="date" value={form.ends_on} min={form.starts_on} onChange={set("ends_on")} required />
              </label>
            )}
            <button type="button" className={`nb-chip${days ? " is-set" : ""}`} onClick={() => setDays((v) => !v)}>
              {days ? "One day" : "More than a day"}
            </button>
          </div>
          {badRange && <p className="field-error">The end can’t be before the start.</p>}
          <input className="textarea" value={form.note} onChange={set("note")} placeholder="Note (optional), e.g. School closed" maxLength={1000} />
          <div className="segmented segmented-sm nb-audience" role="radiogroup" aria-label="Who can see it">
            <button type="button" role="radio" aria-checked={form.for_parents} className={form.for_parents ? "active" : ""} onClick={() => setForm({ ...form, for_parents: true })}>
              <Icon name="users" size={16} /> Parents & staff
            </button>
            <button type="button" role="radio" aria-checked={!form.for_parents} className={!form.for_parents ? "active" : ""} onClick={() => setForm({ ...form, for_parents: false })}>
              <Icon name="teacher" size={16} /> Staff only
            </button>
          </div>
          {error && <p className="field-error">{error}</p>}
        </div>
        <footer className="modal-footer">
          {!isNew && (
            <button type="button" className={`btn${armed ? " btn-danger" : ""} cal-remove`} onClick={remove} disabled={busy}>
              <Icon name="trash" /> {armed ? "Tap again to remove" : "Remove"}
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !form.title.trim() || badRange}>
            <Icon name="check" /> {busy ? "Saving…" : "Save"}
          </button>
        </footer>
      </form>
    </div>
  );
}

// Home: the next few things coming up, with a link to the calendar. What's
// coming up (calendar entries in the next two months) and the latest
// notices, as a row of cards. Hidden when there's nothing. Taps open the
// calendar or the noticeboard.
// withNotices: also list notices from the last week (off where Home already
// shows them in its banner). limit: at most this many. calendar: a small
// month beside the list (staff Home), its dates dotted where something's on,
// and the next holiday and exam under the list (session: for the datesheet).
export function ComingUp({ schoolId, session = null, staff = false, withNotices = true, limit = 9, calendar = false, onOpenCalendar, onOpenNotices }) {
  const { items, loading } = useItems(schoolId, staff);
  const [notices] = useNotices(schoolId, staff);
  const today = todayIso();
  const soon = iso(new Date(Date.now() + 60 * 864e5));
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const next = useNextUp(schoolId, calendar ? session : null, items);
  const featured = new Set(next.map((c) => c.id).filter(Boolean));
  const cards = [
    ...items.filter((it) => (it.end ?? it.start) >= today && it.start <= soon && !featured.has(it.id)).slice(0, 6),
    ...(withNotices ? notices ?? [] : [])
      .filter((n) => !n.event_on && (n.pinned || n.created_at >= weekAgo))
      .slice(0, 3)
      .map((n) => ({ id: `new-${n.id}`, source: "notice", title: n.title, kind: "notice", start: n.created_at.slice(0, 10), fresh: true })),
  ].slice(0, limit);
  if (loading || (!cards.length && !calendar)) return null;
  const nothing = !cards.length && !next.length;
  const list = (
    <div className="home-events-row">
      {nothing && <p className="row-sub home-events-none">Nothing planned yet.</p>}
      {cards.map((it, i) => {
        const d = parse(it.fresh || it.start >= today ? it.start : today);
        return (
          <button key={it.id} className="home-event-card" style={{ "--d": `${i * 50}ms` }} onClick={it.source === "notice" ? onOpenNotices : onOpenCalendar}>
            <span className="home-event-date">
              <span className="home-event-month">{d.toLocaleDateString("en-IN", { month: "short" }).toUpperCase()}</span>
              <span className="home-event-day">{d.getDate()}</span>
            </span>
            <span className="home-event-body">
              <strong>{it.title}</strong>
              {it.note && <span className="row-sub">{it.note}</span>}
            </span>
            <span className={`home-event-kind k-${it.kind}`} title={KIND_LABEL[it.kind]}>
              <Icon name={KIND_ICON[it.kind]} size={15} />
            </span>
          </button>
        );
      })}
    </div>
  );
  return (
    <section className="home-events">
      <header className="home-notice-head">
        <span className="home-events-icon">
          <Icon name="calendar" size={18} weight="fill" />
        </span>
        <span className="home-notice-text">
          <strong>Upcoming Events</strong>
        </span>
        <button type="button" className="home-section-all" onClick={onOpenCalendar}>
          View calendar <Icon name="arrowRight" size={13} />
        </button>
      </header>
      {calendar ? (
        <div className="home-events-cal">
          <MiniCalendar items={items} onOpen={onOpenCalendar} />
          <div className="home-events-side">
            {list}
            <NextUp cards={next} onOpen={onOpenCalendar} />
          </div>
        </div>
      ) : (
        list
      )}
    </section>
  );
}

const daysTo = (day) => Math.round((parse(day) - parse(todayIso())) / 864e5);
const whenText = (day, end) => {
  const n = daysTo(day);
  if (n < 0) return `On now, until ${parse(end).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
  const date = parse(day).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  return n === 0 ? `Today, ${date}` : n === 1 ? `Tomorrow, ${date}` : `${date} · in ${n} days`;
};

// The next holiday and the next exam, however far off (they leave the list
// above so nothing shows twice). Exams come from the calendar or the
// classes' datesheets, whichever is sooner. session: null skips it all.
function useNextUp(schoolId, session, items) {
  const key = session ? `datesheet:${session.id}` : null;
  const [dates, setDates] = useState(() => (key ? peek(key) ?? null : null));
  useEffect(() => {
    if (key) swr(key, () => listDatesheet(schoolId, session.id), setDates).catch(() => setDates([]));
  }, [schoolId, session, key]);
  if (!session) return [];

  const today = todayIso();
  const later = items.filter((it) => (it.end ?? it.start) >= today);
  const holiday = later.find((it) => it.kind === "holiday");
  const calExam = later.find((it) => it.kind === "exam");
  const sheet = (dates ?? []).filter((d) => d.exam_date >= today);
  const first = sheet[0];
  let sheetExam = null;
  if (first) {
    const same = sheet.filter((d) => d.exam_date === first.exam_date && d.exam_name === first.exam_name).length;
    const where = `${first.subject} · ${gradeLabel(first.class)}${first.section ? ` ${first.section}` : ""}`;
    sheetExam = { title: first.exam_name || first.subject, sub: same > 1 ? `${where} and ${same - 1} more` : where, start: first.exam_date };
  }
  const exam = calExam && (!sheetExam || calExam.start <= sheetExam.start) ? { id: calExam.id, title: calExam.title, sub: calExam.note, start: calExam.start, end: calExam.end } : sheetExam;
  return [
    holiday && { id: holiday.id, kind: "holiday", label: "Next holiday", title: holiday.title, sub: holiday.note, start: holiday.start, end: holiday.end },
    exam && { kind: "exam", label: "Next exam", ...exam },
  ].filter(Boolean);
}

function NextUp({ cards, onOpen }) {
  if (!cards.length) return null;
  return (
    <div className="home-next">
      {cards.map((c) => (
        <button key={c.kind} type="button" className={`home-next-card k-${c.kind}`} onClick={onOpen}>
          <span className="home-next-icon">
            <Icon name={KIND_ICON[c.kind]} size={18} />
          </span>
          <span className="home-next-body">
            <span className="home-next-label">{c.label}</span>
            <strong>{c.title}</strong>
            {c.sub && <span className="row-sub">{c.sub}</span>}
            <span className="home-next-when">{whenText(c.start, c.end)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

// Staff Home: a small month beside Upcoming Events, Monday first like the
// full Calendar, a dot under each date with something on. Tapping it opens
// the full page; the arrows change the month.
function MiniCalendar({ items, onOpen }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const today = todayIso();
  const cells = useMemo(() => {
    const lead = (month.getDay() + 6) % 7;
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const start = new Date(month);
    start.setDate(1 - lead);
    return Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [month]);
  const busy = useMemo(() => {
    const on = new Set();
    for (const it of items) {
      const end = it.end && it.end > it.start ? it.end : it.start;
      for (let d = parse(it.start); iso(d) <= end; d.setDate(d.getDate() + 1)) on.add(iso(d));
    }
    return on;
  }, [items]);
  const go = (step, e) => {
    e.stopPropagation();
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + step, 1));
  };

  return (
    <div className="home-cal" onClick={onOpen} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen()} role="button" tabIndex={0} aria-label="Open the calendar">
      <header className="home-cal-head">
        <strong>{month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</strong>
        <span className="home-cal-nav">
          <button type="button" className="icon-btn-sm" onClick={(e) => go(-1, e)} aria-label="Previous month">
            <Icon name="chevronLeft" size={16} />
          </button>
          <button type="button" className="icon-btn-sm" onClick={(e) => go(1, e)} aria-label="Next month">
            <Icon name="chevronRight" size={16} />
          </button>
        </span>
      </header>
      <div className="home-cal-week" aria-hidden="true">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="home-cal-grid">
        {cells.map((d) => {
          const day = iso(d);
          return (
            <span key={day} className={["home-cal-day", d.getMonth() !== month.getMonth() && "is-out", day === today && "is-today", busy.has(day) && "is-busy"].filter(Boolean).join(" ")}>
              <span>{d.getDate()}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

