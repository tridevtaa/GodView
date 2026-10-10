import { useEffect, useRef, useState } from "react";
import { addNote, deleteNote, listNotes, setNoteShared } from "../data/api.js";
import Icon from "./Icon.jsx";

const day = (iso) => new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const short = (iso) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

// Stamps, like the ones teachers put in a school diary.
export const STAMPS = {
  remark: "Remark",
  appreciation: "Well done",
  concern: "Concern",
  reminder: "Reminder",
};

// One-tap starters for what teachers write most.
const STARTERS = ["Great work today", "Homework not done", "Needs help with", "Absent without notice", "Please meet the class teacher", "Please sign and return"];

// The student's diary: dated pages written to the parents and signed by the
// writer. Parents sign each page in their app (optionally with a reply).
// "Staff only" pages never reach parents.
export default function StudentNotes({ person, me, isAdmin, canWrite, autoFocus }) {
  const [notes, setNotes] = useState(null);
  const [body, setBody] = useState("");
  const [kind, setKind] = useState("remark");
  const [staffOnly, setStaffOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const box = useRef(null);
  const first = person.name.split(" ")[0];

  useEffect(() => {
    if (autoFocus) box.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    let cancelled = false;
    listNotes(person.id).then(
      (rows) => !cancelled && setNotes(rows),
      () => !cancelled && setError("Couldn’t load the diary.")
    );
    return () => {
      cancelled = true;
    };
  }, [person.id]);

  async function submit(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError("");
    try {
      const saved = await addNote(person.school_id, person.id, body.trim(), !staffOnly, kind);
      setNotes((n) => [saved, ...(n ?? [])]);
      setBody("");
      setKind("remark");
      setStaffOnly(false);
    } catch {
      setError("Couldn’t write in the diary. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleShare(note) {
    try {
      await setNoteShared(note.id, !note.shared_with_parents);
      setNotes((n) => n.map((x) => (x.id === note.id ? { ...x, shared_with_parents: !x.shared_with_parents } : x)));
    } catch {
      setError("Couldn’t change who sees this page.");
    }
  }

  async function remove(id) {
    try {
      await deleteNote(id);
      setNotes((n) => n.filter((x) => x.id !== id));
    } catch {
      setError("Couldn’t remove the page.");
    }
  }

  return (
    <div className="diary">
      {canWrite && (
        <form className="diary-page diary-write" onSubmit={submit}>
          <div className="diary-date">{day(new Date().toISOString())}</div>
          <div className="diary-stamps" role="radiogroup" aria-label="Stamp">
            {Object.entries(STAMPS).map(([k, label]) => (
              <button type="button" key={k} role="radio" aria-checked={kind === k} className={`stamp stamp-${k}${kind === k ? " is-on" : ""}`} onClick={() => setKind(k)}>
                {label}
              </button>
            ))}
          </div>
          <div className="note-starters">
            {STARTERS.map((s) => (
              <button type="button" key={s} onClick={() => (setBody((b) => (b.trim() ? `${b.trim()} ${s}` : s) + " "), box.current?.focus())}>
                {s}
              </button>
            ))}
          </div>
          <textarea
            ref={box}
            className="diary-lines"
            rows={4}
            maxLength={4000}
            placeholder={staffOnly ? `A note about ${first} for school staff only…` : `Dear Parent, …`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="diary-write-foot">
            <label className="checkbox checkbox-inline">
              <input type="checkbox" checked={staffOnly} onChange={(e) => setStaffOnly(e.target.checked)} />
              <span>Staff only (parents won’t see it)</span>
            </label>
            <button className="btn btn-primary btn-sm" disabled={busy || !body.trim()}>
              <Icon name="edit" />
              {busy ? "Writing…" : "Write in diary"}
            </button>
          </div>
        </form>
      )}
      {error && <p className="field-error">{error}</p>}
      {notes === null ? (
        <p className="row-sub">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="row-sub diary-empty">The diary is empty. Pages written here reach {first}’s parents in the Godview app, and they sign them.</p>
      ) : (
        <ul className="diary-list">
          {notes.map((n) => {
            const sig = Array.isArray(n.signature) ? n.signature[0] : n.signature;
            return (
              <li key={n.id} className={`diary-page${n.shared_with_parents ? "" : " is-private"}`}>
                <div className="diary-page-head">
                  <span className="diary-date">{day(n.created_at)}</span>
                  {n.kind && n.kind !== "remark" && <span className={`stamp stamp-${n.kind} is-on`}>{STAMPS[n.kind]}</span>}
                </div>
                <p className="diary-body">{n.body}</p>
                <p className="diary-sign">
                  {n.author_name || n.author_email}
                  {n.author_role ? `, ${n.author_role}` : ""}
                </p>
                <div className="diary-foot">
                  {!n.shared_with_parents ? (
                    <span className="badge badge-neutral">Staff only</span>
                  ) : sig ? (
                    <span className="diary-signed">
                      <Icon name="check" size={14} /> Signed by parent · {short(sig.signed_at)}
                    </span>
                  ) : (
                    <span className="diary-waiting">Waiting for parent’s signature</span>
                  )}
                  {canWrite && (n.author_email === me || isAdmin) && (
                    <span className="note-actions">
                      <button className="link-btn" onClick={() => toggleShare(n)}>
                        {n.shared_with_parents ? "Make staff only" : "Send to parents"}
                      </button>
                      <button className="link-btn" onClick={() => remove(n.id)}>
                        Remove
                      </button>
                    </span>
                  )}
                </div>
                {sig?.reply && <p className="diary-reply">Parent: “{sig.reply}”</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
