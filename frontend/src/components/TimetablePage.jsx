import React, { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase.js";

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function TimetablePage() {
  const [schools, setSchools] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const [schoolId, setSchoolId] = useState("");
  const [klass, setKlass] = useState("");
  const [section, setSection] = useState("");
  const [periods, setPeriods] = useState([]); // { day, period_no, subject, teacher, start_time, end_time }

  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getDocs(collection(db, "schools"))
      .then((snap) => setSchools(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch(() =>
        setLoadError("Could not load schools. Add one first, and check Firestore rules.")
      );
  }, []);

  function addPeriod() {
    setPeriods((prev) => [
      ...prev,
      {
        day: "Monday",
        period_no: prev.length + 1,
        subject: "",
        teacher: "",
        start_time: "",
        end_time: "",
      },
    ]);
  }

  function updatePeriod(idx, field, value) {
    setPeriods((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p))
    );
  }

  function removePeriod(idx) {
    setPeriods((prev) => prev.filter((_, i) => i !== idx));
  }

  function movePeriod(idx, dir) {
    setPeriods((prev) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  async function handleSubmit() {
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch(`${BACKEND_URL}/timetable/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          school_id: schoolId,
          class: klass,
          section,
          periods: periods.map((p) => ({
            day: p.day,
            period_no: Number(p.period_no) || 0,
            subject: p.subject,
            teacher: p.teacher,
            start_time: p.start_time,
            end_time: p.end_time,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw Object.assign(new Error(data.error || "Save failed"), {
          details: data.details,
        });
      }
      setStatus({
        type: "success",
        message: `Timetable saved with ${data.periods_total} period(s).`,
      });
      setPeriods([]);
    } catch (e) {
      setStatus({ type: "error", message: e.message, details: e.details });
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    schoolId && klass.trim() && section.trim() && periods.length > 0 && !busy;

  return (
    <div className="add-route-page">
      <h1>Build Timetable</h1>
      <p>
        Pick a school, class and section, then add each period — day, subject,
        teacher and timing. Saving replaces that class's full timetable.
      </p>

      {loadError && <p className="status-err">{loadError}</p>}

      <div className="route-form-row">
        <label>
          School
          <select value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
            <option value="">Select school</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.id})
              </option>
            ))}
          </select>
        </label>
        <label>
          Class
          <input value={klass} onChange={(e) => setKlass(e.target.value)} placeholder="10" />
        </label>
        <label>
          Section
          <input value={section} onChange={(e) => setSection(e.target.value)} placeholder="A" />
        </label>
      </div>

      <div className="stop-list">
        {periods.length === 0 && (
          <p className="hint">Click "Add Period" below to start building the schedule.</p>
        )}
        {periods.map((p, i) => (
          <div key={i} className="stop-row timetable-row">
            <select value={p.day} onChange={(e) => updatePeriod(i, "day", e.target.value)}>
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="1"
              value={p.period_no}
              onChange={(e) => updatePeriod(i, "period_no", e.target.value)}
              placeholder="Period #"
              title="Period number"
            />
            <input
              value={p.subject}
              onChange={(e) => updatePeriod(i, "subject", e.target.value)}
              placeholder="Subject"
            />
            <input
              value={p.teacher}
              onChange={(e) => updatePeriod(i, "teacher", e.target.value)}
              placeholder="Teacher"
            />
            <input
              value={p.start_time}
              onChange={(e) => updatePeriod(i, "start_time", e.target.value)}
              placeholder="08:00"
            />
            <input
              value={p.end_time}
              onChange={(e) => updatePeriod(i, "end_time", e.target.value)}
              placeholder="08:45"
            />
            <button type="button" onClick={() => movePeriod(i, -1)} disabled={i === 0} title="Move up">
              ↑
            </button>
            <button
              type="button"
              onClick={() => movePeriod(i, 1)}
              disabled={i === periods.length - 1}
              title="Move down"
            >
              ↓
            </button>
            <button type="button" onClick={() => removePeriod(i)} title="Remove">
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="upload-card-actions">
        <button type="button" className="btn-secondary" onClick={addPeriod}>
          + Add Period
        </button>
        <button className="btn-primary" onClick={handleSubmit} disabled={!canSubmit}>
          {busy ? "Saving..." : "Save Timetable"}
        </button>
      </div>

      {status && (
        <div className={status.type === "success" ? "status-ok" : "status-err"}>
          <p>{status.message}</p>
          {status.details && (
            <ul>
              {status.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
