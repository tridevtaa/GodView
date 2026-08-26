import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase.js";

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function StudentAttendancePage() {
  const [schools, setSchools] = useState([]);
  const [students, setStudents] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const [schoolId, setSchoolId] = useState("");
  const [classValue, setClassValue] = useState("");
  const [section, setSection] = useState("");
  const [date, setDate] = useState(todayIso());
  const [statusById, setStatusById] = useState({}); // studentId -> "Present" | "Absent"

  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [schoolSnap, studentSnap] = await Promise.all([
          getDocs(collection(db, "schools")),
          getDocs(collection(db, "students")),
        ]);
        setSchools(schoolSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setStudents(studentSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        setLoadError(
          "Could not load schools/students. Add them first, and check Firestore rules."
        );
      }
    }
    load();
  }, []);

  const schoolStudents = useMemo(
    () => students.filter((s) => s.schoolId === schoolId),
    [students, schoolId]
  );

  const classOptions = useMemo(
    () => Array.from(new Set(schoolStudents.map((s) => s.class).filter(Boolean))).sort(),
    [schoolStudents]
  );

  const sectionOptions = useMemo(
    () =>
      Array.from(
        new Set(
          schoolStudents.filter((s) => s.class === classValue).map((s) => s.section).filter(Boolean)
        )
      ).sort(),
    [schoolStudents, classValue]
  );

  const classStudents = useMemo(
    () => schoolStudents.filter((s) => s.class === classValue && s.section === section),
    [schoolStudents, classValue, section]
  );

  useEffect(() => {
    setStatusById((prev) => {
      const next = {};
      classStudents.forEach((s) => {
        next[s.id] = prev[s.id] || "Present";
      });
      return next;
    });
  }, [classStudents]);

  function toggle(studentId) {
    setStatusById((prev) => ({
      ...prev,
      [studentId]: prev[studentId] === "Present" ? "Absent" : "Present",
    }));
  }

  async function handleSubmit() {
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch(`${BACKEND_URL}/attendance/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          school_id: schoolId,
          class: classValue,
          section,
          date,
          records: classStudents.map((s) => ({
            student_id: s.id,
            status: statusById[s.id] || "Present",
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
        message: `Attendance saved for ${data.records_total} student(s).`,
      });
    } catch (e) {
      setStatus({ type: "error", message: e.message, details: e.details });
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = schoolId && classValue && section && date && classStudents.length > 0 && !busy;

  return (
    <div className="add-route-page">
      <h1>Mark Student Attendance</h1>
      <p>
        Pick a school, class and section — the matching students load
        automatically, defaulted to Present. Toggle anyone who's Absent.
      </p>

      {loadError && <p className="status-err">{loadError}</p>}

      <div className="route-form-row">
        <label>
          School
          <select
            value={schoolId}
            onChange={(e) => {
              setSchoolId(e.target.value);
              setClassValue("");
              setSection("");
            }}
          >
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
          <select
            value={classValue}
            onChange={(e) => {
              setClassValue(e.target.value);
              setSection("");
            }}
            disabled={!schoolId}
          >
            <option value="">Select class</option>
            {classOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Section
          <select value={section} onChange={(e) => setSection(e.target.value)} disabled={!classValue}>
            <option value="">Select section</option>
            {sectionOptions.map((s) => (
              <option key={s} value={s}>
                {s}
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
        {classValue && section && classStudents.length === 0 && (
          <p className="hint">No students found for this class/section yet.</p>
        )}
        {classStudents.map((s) => {
          const present = (statusById[s.id] || "Present") === "Present";
          return (
            <div key={s.id} className="stop-row attendance-row">
              <span className="attendance-name">
                {s.name}
                {s.rollNo ? ` — Roll ${s.rollNo}` : ""}
              </span>
              <button
                type="button"
                className={present ? "attendance-toggle present" : "attendance-toggle absent"}
                onClick={() => toggle(s.id)}
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
