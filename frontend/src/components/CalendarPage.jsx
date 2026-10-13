import { useEffect, useMemo, useState } from "react";
import { addCalendarEvent, deleteCalendarEvent, listCalendar, updateCalendarEvent } from "../data/api.js";
import { peek, remember, swr } from "../data/cache.js";
import { DateLeaf, useNotices } from "./NoticeBoard.jsx";
import Icon from "./Icon.jsx";

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

// The calendar page: a month at a glance and what's on. Owners and admins
// add, change and remove entries; everyone else reads. adding: open the
// "add" form (from the +).
export default function CalendarPage({ schoolId, canEdit = false, staff = false, adding = false, onAdding = () => {}, onOpenNotices }) {
  const { items, loading, setEvents } = useItems(schoolId, staff);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [picked, setPicked] = useState(null); // a day, "YYYY-MM-DD"
  const [editing, setEditing] = useState(null); // an entry's row, or {} for new

  useEffect(() => {
    if (adding) setEditing({ starts_on: picked ?? todayIso() });
  }, [adding]); // eslint-disable-line react-hooks/exhaustive-deps

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

// Home: the next few things coming up, with a link to the calendar.
export function CalendarPeek({ schoolId, staff = false, onOpen }) {
  const { items, loading } = useItems(schoolId, staff);
  const today = todayIso();
  const soon = iso(new Date(Date.now() + 60 * 864e5));
  const next = items.filter((it) => (it.end ?? it.start) >= today && it.start <= soon).slice(0, 3);
  if (loading) return null;
  return (
    <section className="nb-peek cal-peek">
      <button className="nb-peek-head" onClick={onOpen}>
        <span className="home-need-icon">
          <Icon name="calendar" size={18} />
        </span>
        <strong>Coming up</strong>
        <span className="nb-peek-all">
          Calendar <Icon name="arrowRight" size={14} />
        </span>
      </button>
      {next.length === 0 ? (
        <p className="row-sub cal-peek-empty">Nothing in the next two months.</p>
      ) : (
        next.map((it) => (
          <button key={it.id} className="cal-peek-item" onClick={onOpen}>
            <DateLeaf date={it.start < today ? today : it.start} small />
            <span className="cal-peek-main">
              <strong>{it.title}</strong>
              <span className="row-sub">{it.start <= today ? (it.end && it.end > today ? `Today, until ${short(it.end)}` : "Today") : range(it)}</span>
            </span>
            <span className={`cal-dot-lg k-${it.kind}`} title={KIND_LABEL[it.kind]}>
              <Icon name={KIND_ICON[it.kind]} size={14} />
            </span>
          </button>
        ))
      )}
    </section>
  );
}
