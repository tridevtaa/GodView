import { useEffect, useMemo, useState } from "react";
import { deleteResult, listResults, saveResult } from "../data/api.js";

const EMPTY = { exam: "", subject: "", marks: "", max_marks: "100" };
const pct = (r) => (r.marks !== null && r.max_marks ? Math.round((r.marks / r.max_marks) * 100) : null);

// Marks per exam and subject for the session being viewed.
export default function StudentResults({ person, sessionId, me, isAdmin, canWrite }) {
  const [results, setResults] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    listResults(person.id, sessionId).then(
      (rows) => !cancelled && setResults(rows),
      () => !cancelled && setError("Couldn’t load results.")
    );
    return () => {
      cancelled = true;
    };
  }, [person.id, sessionId]);

  const byExam = useMemo(() => {
    const groups = new Map();
    (results ?? []).forEach((r) => groups.set(r.exam, [...(groups.get(r.exam) ?? []), r]));
    return [...groups];
  }, [results]);
  const exams = byExam.map(([exam]) => exam);

  const invalid =
    !form.exam.trim() ||
    !form.subject.trim() ||
    form.marks === "" ||
    Number(form.marks) < 0 ||
    (form.max_marks !== "" && Number(form.marks) > Number(form.max_marks));

  async function submit(e) {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    setError("");
    try {
      const saved = await saveResult(person.school_id, sessionId, person.id, form);
      setResults((rs) => [...(rs ?? []).filter((r) => r.id !== saved.id), saved]);
      setForm((f) => ({ ...EMPTY, exam: f.exam, max_marks: f.max_marks }));
    } catch {
      setError("Couldn’t save the result. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    try {
      await deleteResult(id);
      setResults((rs) => rs.filter((r) => r.id !== id));
    } catch {
      setError("Couldn’t delete that result.");
    }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="results">
      {results === null ? (
        <p className="row-sub">Loading…</p>
      ) : byExam.length === 0 ? (
        <p className="row-sub">No results for this session yet.</p>
      ) : (
        byExam.map(([exam, rows]) => {
          const scored = rows.filter((r) => r.marks !== null && r.max_marks);
          const total = scored.reduce((s, r) => s + Number(r.marks), 0);
          const max = scored.reduce((s, r) => s + Number(r.max_marks), 0);
          return (
            <table key={exam} className="result-table">
              <caption>
                {exam}
                {max > 0 && (
                  <span>
                    {total} / {max} · {Math.round((total / max) * 100)}%
                  </span>
                )}
              </caption>
              <tbody>
                {rows
                  .sort((a, b) => a.subject.localeCompare(b.subject))
                  .map((r) => (
                    <tr key={r.id}>
                      <th scope="row">{r.subject}</th>
                      <td>
                        {r.marks ?? "—"}
                        {r.max_marks ? ` / ${r.max_marks}` : ""}
                      </td>
                      <td className="result-pct">{pct(r) !== null ? `${pct(r)}%` : ""}</td>
                      <td className="result-actions">
                        {canWrite && (r.entered_by === me || isAdmin) && (
                          <button className="link-btn" onClick={() => remove(r.id)}>
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          );
        })
      )}

      {canWrite && (
        <form className="result-form" onSubmit={submit}>
          <input className="input" list="exam-names" placeholder="Exam (e.g. Term 1)" value={form.exam} onChange={set("exam")} />
          <datalist id="exam-names">
            {exams.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
          <input className="input" placeholder="Subject" value={form.subject} onChange={set("subject")} />
          <input className="input input-num" type="number" min="0" step="0.5" placeholder="Marks" value={form.marks} onChange={set("marks")} />
          <span className="row-sub">/</span>
          <input className="input input-num" type="number" min="1" step="0.5" placeholder="Max" value={form.max_marks} onChange={set("max_marks")} />
          <button className="btn btn-primary btn-sm" disabled={busy || invalid}>
            {busy ? "Saving…" : "Save"}
          </button>
        </form>
      )}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
