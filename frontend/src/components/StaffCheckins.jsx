import { useEffect, useMemo, useState } from "react";
import { checkinRegister, checkinSettings, setCheckinSettings, setSchoolLocation } from "../data/api.js";
import { hoursText, isLate, timeText } from "./CheckIn.jsx";
import Icon from "./Icon.jsx";

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthKey = (d = new Date()) => dayKey(d).slice(0, 7);
const lastDay = (month) => {
  const [y, m] = month.split("-").map(Number);
  return dayKey(new Date(y, m, 0));
};
const RADII = [50, 100, 200, 300];
const ROLE = { admin: "Admin", principal: "Principal", teacher: "Teacher" };

// Staff attendance from the app's check-in: who's in today, and each
// person's month. Settings (on/off, radius, late time) for Staff Edit;
// the school's location for owners and admins.
export default function StaffCheckins({ school, canEdit, canLocate, canDownload }) {
  const [view, setView] = useState("today");
  const [month, setMonth] = useState(monthKey());
  const [rows, setRows] = useState(null);
  const [settings, setSettings] = useState(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const today = dayKey();

  useEffect(() => {
    checkinSettings(school.id).then(setSettings, () => {});
  }, [school.id]);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError("");
    const [from, to] = view === "today" ? [today, today] : [`${month}-01`, lastDay(month)];
    checkinRegister(school.id, from, to).then(
      (r) => !cancelled && setRows(r),
      () => !cancelled && (setRows([]), setError("Couldn’t load staff attendance. Check your connection."))
    );
    return () => {
      cancelled = true;
    };
  }, [school.id, view, month, today]);

  // One entry per person, with their days
  const people = useMemo(() => {
    const map = new Map();
    for (const r of rows ?? []) {
      if (!map.has(r.email)) map.set(r.email, { email: r.email, name: r.name || r.email, designation: r.designation || ROLE[r.role] || "", days: [] });
      if (r.day) map.get(r.email).days.push(r);
    }
    return [...map.values()];
  }, [rows]);

  const lateAfter = settings?.checkin_late_after ?? null;
  const on = settings?.checkin_enabled && settings?.lat != null;

  return (
    <div className="ci-page">
      <div className="ci-bar">
        <nav className="segmented" aria-label="Staff attendance view">
          <button className={view === "today" ? "active" : ""} onClick={() => setView("today")}>
            Today
          </button>
          <button className={view === "month" ? "active" : ""} onClick={() => setView("month")}>
            Month
          </button>
        </nav>
        {view === "month" && <input className="input ci-month" type="month" value={month} max={monthKey()} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />}
        <span className="ci-grow" />
        {view === "month" && canDownload && people.length > 0 && (
          <button className="btn btn-secondary btn-sm" onClick={() => download(school, month, people, lateAfter)}>
            <Icon name="download" /> CSV
          </button>
        )}
        {canEdit && (
          <button className={`btn btn-secondary btn-sm${editing ? " is-on" : ""}`} onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
            <Icon name="settings" /> Settings
          </button>
        )}
      </div>

      {settings && !on && !editing && (
        <p className="notice ci-off">
          {settings.lat == null ? "Pin the school’s location to start check-in." : "Check-in is off, so staff don’t see the button yet."}
          {canEdit && (
            <button className="link-btn" onClick={() => setEditing(true)}>
              Set it up
            </button>
          )}
        </p>
      )}

      {editing && settings && <Settings school={school} settings={settings} canLocate={canLocate} onSaved={() => (setEditing(false), checkinSettings(school.id).then(setSettings, () => {}))} />}

      {error && <p className="notice notice-error">{error}</p>}

      {rows === null ? (
        <div className="card card-skeleton" aria-busy="true" />
      ) : people.length === 0 ? (
        <p className="row-sub">No staff sign in to Godview yet. Add them in App access.</p>
      ) : view === "today" ? (
        <Today people={people} lateAfter={lateAfter} />
      ) : (
        <Month people={people} lateAfter={lateAfter} />
      )}
    </div>
  );
}

function Today({ people, lateAfter }) {
  const sorted = [...people].sort((a, b) => (a.days[0]?.in_at ?? "~").localeCompare(b.days[0]?.in_at ?? "~") || a.name.localeCompare(b.name));
  const inCount = people.filter((p) => p.days[0]).length;
  const lateCount = people.filter((p) => isLate(p.days[0]?.in_at, lateAfter)).length;
  return (
    <>
      <p className="ci-summary">
        <strong>{inCount}</strong> of {people.length} checked in
        {lateCount > 0 && (
          <>
            {" "}
            · <span className="is-late">{lateCount} late</span>
          </>
        )}
      </p>
      <ul className="ci-list">
        {sorted.map((p) => {
          const d = p.days[0];
          const late = isLate(d?.in_at, lateAfter);
          return (
            <li key={p.email} className={d ? "" : "is-missing"}>
              <span className="ci-who">
                <strong>{p.name}</strong>
                {p.designation && <span className="row-sub">{p.designation}</span>}
              </span>
              <span className="ci-times">
                {d ? (
                  <>
                    <span className={`badge ${late ? "badge-warning" : "badge-success"}`}>{late ? "Late" : "In"} {timeText(d.in_at)}</span>
                    <span className="row-sub">{d.out_at ? `Out ${timeText(d.out_at)} · ${hoursText(d.in_at, d.out_at)}` : "Not checked out"}</span>
                  </>
                ) : (
                  <span className="badge">Not in</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

const avgHours = (days) => {
  const done = days.filter((d) => d.out_at);
  if (!done.length) return "";
  const mins = done.reduce((s, d) => s + (new Date(d.out_at) - new Date(d.in_at)) / 6e4, 0) / done.length;
  return hoursText(0, mins * 6e4);
};

function Month({ people, lateAfter }) {
  const [open, setOpen] = useState(null);
  return (
    <div className="ci-scroll">
      <table className="ci-table">
        <thead>
          <tr>
            <th scope="col">Staff</th>
            <th scope="col">Days in</th>
            <th scope="col">Late</th>
            <th scope="col">Average day</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => {
            const late = p.days.filter((d) => isLate(d.in_at, lateAfter)).length;
            const isOpen = open === p.email;
            return [
              <tr key={p.email} className="ci-row" onClick={() => setOpen(isOpen ? null : p.email)}>
                <th scope="row">
                  <button className="ci-name" aria-expanded={isOpen}>
                    <Icon name={isOpen ? "chevronDown" : "chevronRight"} size={14} />
                    <span>
                      <strong>{p.name}</strong>
                      {p.designation && <span className="row-sub">{p.designation}</span>}
                    </span>
                  </button>
                </th>
                <td>{p.days.length}</td>
                <td className={late ? "is-late" : ""}>{late || ""}</td>
                <td>{avgHours(p.days)}</td>
              </tr>,
              isOpen && (
                <tr key={`${p.email}-days`} className="ci-days">
                  <td colSpan={4}>
                    {p.days.length === 0 ? (
                      <span className="row-sub">No check-ins this month.</span>
                    ) : (
                      <ul>
                        {p.days.map((d) => (
                          <li key={d.day}>
                            <span>{new Date(`${d.day}T12:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</span>
                            <span className={isLate(d.in_at, lateAfter) ? "is-late" : ""}>{timeText(d.in_at)}</span>
                            <span>{d.out_at ? timeText(d.out_at) : "-"}</span>
                            <span className="row-sub">{d.out_at ? hoursText(d.in_at, d.out_at) : ""}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

function Settings({ school, settings, canLocate, onSaved }) {
  const [enabled, setEnabled] = useState(settings.checkin_enabled);
  const [radius, setRadius] = useState(settings.checkin_radius_m ?? 100);
  const [late, setLate] = useState((settings.checkin_late_after ?? "").slice(0, 5));
  const [located, setLocated] = useState(settings.lat != null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const pinHere = () => {
    setError("");
    if (!navigator.geolocation) return setError("This browser can’t share your location.");
    setBusy("locating");
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          if (coords.accuracy > 75) throw new Error("rough");
          await setSchoolLocation(school.id, coords.latitude, coords.longitude);
          setLocated(true);
        } catch (e) {
          setError(e.message === "rough" ? `Your location is only accurate to ±${Math.round(coords.accuracy)} m. Try again outside or near a window.` : "Couldn’t save the location.");
        } finally {
          setBusy("");
        }
      },
      (e) => {
        setBusy("");
        setError(e.code === 1 ? "Allow location for this site, then try again." : "Couldn’t find your location. Try again.");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  };

  const save = async () => {
    setBusy("saving");
    setError("");
    try {
      await setCheckinSettings(school.id, { enabled, radius, lateAfter: late });
      onSaved();
    } catch {
      setError("Couldn’t save. Check your connection.");
      setBusy("");
    }
  };

  return (
    <section className="ci-settings">
      <div className="ci-field">
        <span>Check-in</span>
        <nav className="segmented" aria-label="Check-in on or off">
          <button className={enabled ? "active" : ""} onClick={() => setEnabled(true)}>
            On
          </button>
          <button className={!enabled ? "active" : ""} onClick={() => setEnabled(false)}>
            Off
          </button>
        </nav>
      </div>
      <div className="ci-field">
        <span>School location</span>
        <span className="ci-loc">
          {located ? (
            <span className="row-sub">
              <Icon name="check" size={14} /> Pinned
            </span>
          ) : (
            <span className="row-sub">Not pinned</span>
          )}
          {canLocate && (
            <button className="link-btn" disabled={Boolean(busy)} onClick={pinHere}>
              {busy === "locating" ? "Finding you…" : located ? "Move it to where I am" : "Use where I am now"}
            </button>
          )}
        </span>
      </div>
      <div className="ci-field">
        <span>Radius</span>
        <div className="choice-row">
          {RADII.map((r) => (
            <button type="button" key={r} className={`choice${radius === r ? " on" : ""}`} onClick={() => setRadius(r)}>
              {r} m
            </button>
          ))}
        </div>
      </div>
      <div className="ci-field">
        <span>Late after</span>
        <input className="input ci-time" type="time" value={late} onChange={(e) => setLate(e.target.value)} aria-label="Late after" />
      </div>
      {error && <p className="field-error">{error}</p>}
      <div className="ci-actions">
        <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || (enabled && !located)} onClick={save}>
          {busy === "saving" ? "Saving…" : "Save"}
        </button>
        {enabled && !located && <span className="row-sub">Pin the school’s location first.</span>}
      </div>
    </section>
  );
}

function download(school, month, people, lateAfter) {
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["Name", "Designation", "Date", "Check in", "Check out", "Hours", "Late"].map(cell).join(",")];
  for (const p of people)
    for (const d of p.days)
      lines.push([p.name, p.designation, d.day, timeText(d.in_at), d.out_at ? timeText(d.out_at) : "", d.out_at ? hoursText(d.in_at, d.out_at) : "", isLate(d.in_at, lateAfter) ? "Yes" : ""].map(cell).join(","));
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${school.slug || "school"}-staff-attendance-${month}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}
