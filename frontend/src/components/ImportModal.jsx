import { useEffect, useState } from "react";
import { checkHeaders, planImport, studentId } from "../data/studentImport.js";
import { applyImport } from "../data/api.js";
import Icon from "./Icon.jsx";

// Academic sessions start in April: Oct 2026 -> "2026-27", Feb 2027 -> "2026-27".
function currentSession(date = new Date()) {
  const start = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

const today = () => new Date().toISOString().slice(0, 10);

async function readRows(file) {
  const XLSX = await import("xlsx"); // loaded only when importing
  const book = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheet = book.Sheets[book.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false, dateNF: "dd/mm/yyyy" });
  checkHeaders(Object.keys(rows[0] ?? {}));
  return rows;
}

// `students` are the people in the session being viewed; anyone among them who
// isn't in the file can be marked as left.
export default function ImportModal({ schoolId, students, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState(null);
  const [session, setSession] = useState(currentSession);
  const [markLeft, setMarkLeft] = useState(true);
  const [status, setStatus] = useState("idle"); // idle | reading | ready | saving | done
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && status !== "saving" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, status]);

  async function choose(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setError("");
    setStatus("reading");
    try {
      setRows(await readRows(f));
      setStatus("ready");
    } catch (err) {
      setRows(null);
      setStatus("idle");
      setError(err.message?.startsWith("Missing column") ? `This doesn’t look like a student export. ${err.message}.` : "Couldn’t read that file. Use the Excel export from the school ERP.");
    }
  }

  // planImport matches by registration number, so key existing students the
  // same way and keep their database ids to mark leavers.
  const existing = students.map((p) => ({ id: studentId(p.admission_no), uuid: p.id, status: p.status }));
  const uuidOf = new Map(existing.map((e) => [e.id, e.uuid]));
  const plan = rows ? planImport(rows, existing, { session, today: today() }) : null;
  const leaving = plan && markLeft ? plan.leaving.map((l) => ({ id: uuidOf.get(l.id) })) : [];
  const writes = plan ? [...plan.upserts, ...leaving] : [];

  async function confirm() {
    setStatus("saving");
    setError("");
    try {
      await applyImport(schoolId, session, { upserts: plan.upserts, leaving }, (done, total) =>
        setProgress(`${done} / ${total}`)
      );
      setStatus("done");
      onDone();
    } catch (err) {
      setStatus("ready");
      setError(
        /academic_sessions/.test(err?.message ?? "") || err?.code === "42501"
          ? `Session ${session} doesn’t exist yet and only a school admin can create it.`
          : "Import stopped part-way. It’s safe to run the same file again."
      );
    }
  }

  const c = plan?.counts;
  const busy = status === "saving";
  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="Import students" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Import students</h2>
          <button className="btn-icon" onClick={onClose} disabled={busy} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>

        {status === "done" ? (
          <>
            <div className="modal-body">
              <div className="callout callout-success">
                <strong>Import complete.</strong> {c.created} added, {c.updated} updated
                {markLeft && c.leaving ? `, ${c.leaving} marked as left` : ""}.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-body">
              <p className="muted">
                Upload the <strong>Student Data</strong> Excel export from the school ERP. Students are matched by
                registration number; photos and fee records are kept.
              </p>
              <label className={`dropzone${file ? " has-file" : ""}`}>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={choose} disabled={busy} />
                <Icon name={file ? "file" : "upload"} size={20} />
                <span className="dropzone-title">{file ? file.name : "Choose a file"}</span>
                <span className="dropzone-hint">{status === "reading" ? "Reading…" : ".xlsx export from the ERP"}</span>
              </label>

              {plan && (
                <>
                  <dl className="summary-list">
                    <div><dt>New students</dt><dd>{c.created}</dd></div>
                    <div><dt>Existing students updated</dt><dd>{c.updated}</dd></div>
                    {c.inactive > 0 && <div><dt>Marked inactive in remarks</dt><dd>{c.inactive}</dd></div>}
                    {c.skipped > 0 && <div><dt>Rows skipped</dt><dd>{c.skipped}</dd></div>}
                  </dl>
                  <div className="form-grid">
                    <label>
                      <span>Session</span>
                      <input value={session} onChange={(e) => setSession(e.target.value)} disabled={busy} />
                    </label>
                  </div>
                  {c.leaving > 0 && (
                    <label className="checkbox">
                      <input type="checkbox" checked={markLeft} onChange={(e) => setMarkLeft(e.target.checked)} disabled={busy} />
                      <span>
                        Mark the <strong>{c.leaving}</strong> students not in this file as left (hidden, not deleted)
                      </span>
                    </label>
                  )}
                </>
              )}
              {error && <p className="field-error">{error}</p>}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={confirm} disabled={status !== "ready" || writes.length === 0}>
                {busy ? `Importing… ${progress}` : "Import"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
