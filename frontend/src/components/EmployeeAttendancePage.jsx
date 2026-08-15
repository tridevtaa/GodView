import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase.js";

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function EmployeeAttendancePage() {
  const [schools, setSchools] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const [schoolId, setSchoolId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [statusById, setStatusById] = useState({}); // employeeId -> "Present" | "Absent"

  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [schoolSnap, employeeSnap] = await Promise.all([
          getDocs(collection(db, "schools")),
          getDocs(collection(db, "employees")),
        ]);
        setSchools(schoolSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setEmployees(employeeSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        setLoadError(
          "Could not load schools/employees. Add them first, and check Firestore rules."
        );
      }
    }
    load();
  }, []);

  const schoolEmployees = useMemo(
    () => employees.filter((e) => e.schoolId === schoolId),
    [employees, schoolId]
  );

  useEffect(() => {
    setStatusById((prev) => {
      const next = {};
      schoolEmployees.forEach((e) => {
        next[e.id] = prev[e.id] || "Present";
      });
      return next;
    });
  }, [schoolEmployees]);

  function toggle(employeeId) {
    setStatusById((prev) => ({
      ...prev,
      [employeeId]: prev[employeeId] === "Present" ? "Absent" : "Present",
    }));
  }

  async function handleSubmit() {
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch(`${BACKEND_URL}/staff-attendance/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          school_id: schoolId,
          date,
          records: schoolEmployees.map((e) => ({
            employee_id: e.id,
            status: statusById[e.id] || "Present",
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
        message: `Staff attendance saved for ${data.records_total} employee(s).`,
      });
    } catch (e) {
      setStatus({ type: "error", message: e.message, details: e.details });
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = schoolId && date && schoolEmployees.length > 0 && !busy;

  return (
    <div className="add-route-page">
      <h1>Mark Staff Attendance</h1>
      <p>
        Pick a school and date — the matching employees load automatically,
        defaulted to Present. Toggle anyone who's Absent.
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
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      <div className="stop-list">
        {schoolId && schoolEmployees.length === 0 && (
          <p className="hint">No employees found for this school yet.</p>
        )}
        {schoolEmployees.map((e) => {
          const present = (statusById[e.id] || "Present") === "Present";
          return (
            <div key={e.id} className="stop-row attendance-row">
              <span className="attendance-name">
                {e.name}
                {e.designation ? ` — ${e.designation}` : ""}
              </span>
              <button
                type="button"
                className={present ? "attendance-toggle present" : "attendance-toggle absent"}
                onClick={() => toggle(e.id)}
              >
                {present ? "Present" : "Absent"}
              </button>
            </div>
          );
        })}
      </div>

      <button onClick={handleSubmit} disabled={!canSubmit}>
        {busy ? "Saving..." : "Save Attendance"}
      </button>

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
