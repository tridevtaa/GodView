import { useEffect, useState } from "react";
import { doc, writeBatch } from "firebase/firestore";
import { db } from "../firebase.js";
import { checkHeaders, planImport } from "../data/studentImport.js";

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

export default function ImportModal({ students, onClose, onDone }) {
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

  const plan = rows ? planImport(rows, students, { session, today: today() }) : null;
  const writes = plan ? [...plan.upserts.map((w) => ({ ...w, merge: true })), ...(markLeft ? plan.leaving : [])] : [];

  async function confirm() {
    setStatus("saving");
    setError("");
    try {
      for (let i = 0; i < writes.length; i += 400) {
        const batch = writeBatch(db);
        for (const w of writes.slice(i, i + 400)) {
          const ref = doc(db, "students", w.id);
          if (w.merge) batch.set(ref, w.data, { merge: true });
          else batch.update(ref, w.data);
        }
        await batch.commit();
        setProgress(`${Math.min(i + 400, writes.length)} / ${writes.length}`);
      }
      setStatus("done");
      onDone();
    } catch {
      setStatus("ready");
      setError("Import stopped part-way. It’s safe to run the same file again.");
    }
  }

  const c = plan?.counts;
  return (
    <div className="modal-backdrop" onClick={() => status !== "saving" && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="Import students" onClick={(e) => e.stopPropagation()}>
        <h2>Import students</h2>

        {status === "done" ? (
          <>
            <p className="import-text">
              Done — {c.created} added, {c.updated} updated{markLeft && c.leaving ? `, ${c.leaving} marked as left` : ""}.
            </p>
            <div className="modal-actions">
              <button className="btn-add" onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <>
            <p className="import-text">
              Upload the <strong>Student Data</strong> Excel export from the school ERP. Students are matched by
              registration number; existing photos and fee records are kept.
            </p>
            <label className="import-file">
              <input type="file" accept=".xlsx,.xls,.csv" onChange={choose} disabled={status === "saving"} />
              <span>{file ? file.name : "Choose file…"}</span>
            </label>

            {status === "reading" && <p className="import-text">Reading…</p>}

            {plan && (
              <>
                <div className="form-grid import-options">
                  <label>
                    <span>Session</span>
                    <input value={session} onChange={(e) => setSession(e.target.value)} disabled={status === "saving"} />
                  </label>
                </div>
                <ul className="import-summary">
                  <li><strong>{c.created}</strong> new students</li>
                  <li><strong>{c.updated}</strong> existing students updated</li>
                  {c.inactive > 0 && <li><strong>{c.inactive}</strong> marked inactive in the file’s remarks</li>}
                  {c.skipped > 0 && <li><strong>{c.skipped}</strong> rows skipped (no registration number or name, or repeated)</li>}
                </ul>
                {c.leaving > 0 && (
                  <label className="import-check">
                    <input type="checkbox" checked={markLeft} onChange={(e) => setMarkLeft(e.target.checked)} disabled={status === "saving"} />
                    Mark the <strong>{c.leaving}</strong> students not in this file as left (hidden, not deleted)
                  </label>
                )}
              </>
            )}

            {error && <p className="auth-error">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={onClose} disabled={status === "saving"}>
                Cancel
              </button>
              <button className="btn-add" onClick={confirm} disabled={status !== "ready" || writes.length === 0}>
                {status === "saving" ? `Importing… ${progress}` : "Import"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
