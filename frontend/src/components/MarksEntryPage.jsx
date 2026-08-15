import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase.js";

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";

function parseSubjects(text) {
  return Array.from(
    new Set(
      text
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
}

export default function MarksEntryPage() {
  const [exams, setExams] = useState([]);
  const [students, setStudents] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const [examId, setExamId] = useState("");
  const [subjectsText, setSubjectsText] = useState("");
  const [maxMarks, setMaxMarks] = useState({}); // subject -> string
  const [marks, setMarks] = useState({}); // `${studentId}__${subject}` -> string

  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [examSnap, studentSnap] = await Promise.all([
          getDocs(collection(db, "exams")),
          getDocs(collection(db, "students")),
        ]);
        setExams(examSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setStudents(studentSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        setLoadError(
          "Could not load exams/students. Create an exam and add students first."
        );
      }
    }
    load();
  }, []);

  const exam = useMemo(() => exams.find((e) => e.id === examId) || null, [exams, examId]);

  const classStudents = useMemo(() => {
    if (!exam) return [];
    return students.filter(
      (s) =>
        s.schoolId === exam.schoolId &&
        String(s.class) === String(exam.class) &&
        String(s.section) === String(exam.section)
    );
  }, [students, exam]);

  const subjects = useMemo(() => parseSubjects(subjectsText), [subjectsText]);

  function setMark(studentId, subject, value) {
    setMarks((prev) => ({ ...prev, [`${studentId}__${subject}`]: value }));
  }

  function setMaxMark(subject, value) {
    setMaxMarks((prev) => ({ ...prev, [subject]: value }));
  }

  const allFilled =
    subjects.length > 0 &&
    classStudents.length > 0 &&
    subjects.every((subj) => String(maxMarks[subj] || "").trim() !== "") &&
    classStudents.every((s) =>
      subjects.every((subj) => String(marks[`${s.id}__${subj}`] || "").trim() !== "")
    );

  async function handleSubmit() {
    setStatus(null);
    setBusy(true);
    try {
      const entries = [];
      classStudents.forEach((s) => {
        subjects.forEach((subj) => {
          entries.push({
            student_id: s.id,
            subject: subj,
            marks_obtained: Number(marks[`${s.id}__${subj}`]) || 0,
            max_marks: Number(maxMarks[subj]) || 0,
          });
        });
      });

      const res = await fetch(`${BACKEND_URL}/results/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exam_id: examId, entries }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw Object.assign(new Error(data.error || "Save failed"), {
          details: data.details,
        });
      }
      setStatus({
        type: "success",
        message: `Results saved: ${data.entries_total} entries.`,
      });
    } catch (e) {
      setStatus({ type: "error", message: e.message, details: e.details });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="add-route-page">
      <h1>Exam Marks Entry</h1>
      <p>
        Pick an exam, list its subjects once (comma-separated), then fill in
        every student's marks. Saving replaces that exam's full result sheet.
      </p>

      {loadError && <p className="status-err">{loadError}</p>}

      <div className="route-form-row">
        <label>
          Exam
          <select value={examId} onChange={(e) => setExamId(e.target.value)}>
            <option value="">Select exam</option>
            {exams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} — {e.class}
                {e.section} ({e.id})
              </option>
            ))}
          </select>
        </label>
        <label>
          Subjects
          <input
            value={subjectsText}
            onChange={(ev) => setSubjectsText(ev.target.value)}
            placeholder="Maths, Science, English"
          />
        </label>
      </div>

      {exam && subjects.length > 0 && (
        <div className="marks-grid-wrap">
          {classStudents.length === 0 ? (
            <p className="hint">
              No students found for {exam.class}
              {exam.section} at this school yet.
            </p>
          ) : (
            <table className="marks-grid">
              <thead>
                <tr>
                  <th>Student</th>
                  {subjects.map((subj) => (
                    <th key={subj}>{subj}</th>
                  ))}
                </tr>
                <tr className="marks-grid-max-row">
                  <th>Max Marks</th>
                  {subjects.map((subj) => (
                    <th key={subj}>
                      <input
                        type="number"
                        min="0"
                        value={maxMarks[subj] || ""}
                        onChange={(e) => setMaxMark(subj, e.target.value)}
                        placeholder="50"
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {classStudents.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    {subjects.map((subj) => (
                      <td key={subj}>
                        <input
                          type="number"
                          min="0"
                          value={marks[`${s.id}__${subj}`] || ""}
                          onChange={(e) => setMark(s.id, subj, e.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <button onClick={handleSubmit} disabled={!allFilled || busy}>
        {busy ? "Saving..." : "Save Results"}
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
