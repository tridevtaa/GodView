import React, { useEffect, useMemo, useState } from "react";
import { BACKEND_URL, useRecords } from "./entityApi.jsx";

// Marks are entered one subject at a time for a whole class/section, but the
// backend stores all of an exam's marks in a single "results" document
// (keyed by exam_id) that gets fully replaced on save. So every save here
// merges the new subject's rows back in with whatever other subjects were
// already recorded for this exam, instead of wiping them out.
export default function MarksEntryPanel() {
  const exams = useRecords("exams");
  const students = useRecords("students");
  const results = useRecords("results");

  const [examId, setExamId] = useState("");
  const [subject, setSubject] = useState("");
  const [maxMarks, setMaxMarks] = useState("100");
  const [marksByStudent, setMarksByStudent] = useState({});
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const exam = (exams || []).find((e) => e.id === examId) || null;
  const existingDoc = (results || []).find((r) => r.id === examId) || null;
  const existingEntries = existingDoc?.entries || [];

  const classStudents = useMemo(() => {
    if (!exam || !students) return [];
    return students.filter(
      (s) => s.schoolId === exam.schoolId && s.class === exam.class && s.section === exam.section
    );
  }, [students, exam]);

  useEffect(() => {
    if (!subject) {
      setMarksByStudent({});
      return;
    }
    const forSubject = existingEntries.filter((e) => e.subject === subject);
    const map = {};
    forSubject.forEach((e) => {
      map[e.studentId] = String(e.marksObtained);
    });
    setMarksByStudent(map);
    if (forSubject.length > 0 && forSubject[0].maxMarks != null) {
      setMaxMarks(String(forSubject[0].maxMarks));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, examId]);

  function setMark(studentId, value) {
    setMarksByStudent((prev) => ({ ...prev, [studentId]: value }));
  }

  async function handleSave() {
    setStatus(null);
    setBusy(true);
    try {
      const otherSubjectEntries = existingEntries.filter((e) => e.subject !== subject);
      const newEntries = classStudents
        .filter((s) => marksByStudent[s.id] !== undefined && marksByStudent[s.id] !== "")
        .map((s) => ({
          student_id: s.id,
          subject,
          marks_obtained: Number(marksByStudent[s.id]),
          max_marks: Number(maxMarks),
        }));
      const carriedEntries = otherSubjectEntries.map((e) => ({
        student_id: e.studentId,
        subject: e.subject,
        marks_obtained: e.marksObtained,
        max_marks: e.maxMarks,
      }));

      const res = await fetch(`${BACKEND_URL}/results/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exam_id: examId,
          entries: [...carriedEntries, ...newEntries],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw Object.assign(new Error(data.error || "Save failed"), { details: data.details });
      }
      setStatus({ type: "success", message: `Marks saved for ${newEntries.length} student(s).` });
    } catch (e) {
      setStatus({ type: "error", message: e.message, details: e.details });
    } finally {
      setBusy(false);
    }
  }

  const canSave = examId && subject.trim() && maxMarks && classStudents.length > 0 && !busy;

  return (
    <div className="add-route-page">
      <h1>Marks Entry</h1>
      <p>Pick an exam and a subject — enter marks for each student in that class/section.</p>

      <div className="route-form-row">
        <label>
          Exam
          <select value={examId} onChange={(e) => setExamId(e.target.value)}>
            <option value="">Select exam</option>
            {(exams || []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.class}
                {e.section} · {e.date}
              </option>
            ))}
          </select>
        </label>
        <label>
          Subject
          <input
            type="text"
            value={subject}
            placeholder="Mathematics"
            onChange={(ev) => setSubject(ev.target.value)}
            disabled={!examId}
          />
        </label>
        <label>
          Max Marks
          <input
            type="number"
            value={maxMarks}
            onChange={(e) => setMaxMarks(e.target.value)}
            disabled={!examId}
          />
        </label>
      </div>

      <div className="stop-list">
        {examId && subject && classStudents.length === 0 && (
          <p className="hint">No students found for this exam's class/section yet.</p>
        )}
        {examId &&
          subject &&
          classStudents.map((s) => (
            <div key={s.id} className="stop-row attendance-row">
              <span className="attendance-name">
                {s.name}
                {s.rollNo ? ` — Roll ${s.rollNo}` : ""}
              </span>
              <input
                type="number"
                placeholder="Marks"
                value={marksByStudent[s.id] ?? ""}
                onChange={(e) => setMark(s.id, e.target.value)}
              />
            </div>
          ))}
      </div>

      <button onClick={handleSave} disabled={!canSave}>
        {busy ? "Saving..." : "Save Marks"}
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
