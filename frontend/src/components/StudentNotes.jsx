import { useEffect, useRef, useState } from "react";
import { addNote, deleteNote, listNotes, setNoteShared } from "../data/api.js";

const when = (iso) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

// Notes about a student from anyone who can see them; authors (and admins)
// can delete their notes.
// One-tap starters for the notes teachers write most.
const STARTERS = ["Great work today", "Homework not done", "Needs help with", "Absent without notice", "Spoke to parents about"];

export default function StudentNotes({ person, me, isAdmin, canWrite, autoFocus }) {
  const box = useRef(null);
  useEffect(() => {
    if (autoFocus) box.current?.focus();
  }, [autoFocus]);
  const [notes, setNotes] = useState(null);
  const [body, setBody] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    listNotes(person.id).then(
      (rows) => !cancelled && setNotes(rows),
      () => !cancelled && setError("Couldn’t load notes.")
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
      const saved = await addNote(person.school_id, person.id, body.trim(), shared);
      setNotes((n) => [saved, ...(n ?? [])]);
      setBody("");
      setShared(false);
    } catch {
      setError("Couldn’t save the note. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleShare(note) {
    try {
      await setNoteShared(note.id, !note.shared_with_parents);
      setNotes((n) => n.map((x) => (x.id === note.id ? { ...x, shared_with_parents: !x.shared_with_parents } : x)));
    } catch {
      setError("Couldn’t change sharing.");
    }
  }

  async function remove(id) {
    try {
      await deleteNote(id);
      setNotes((n) => n.filter((x) => x.id !== id));
    } catch {
      setError("Couldn’t delete the note.");
    }
  }

  return (
    <div className="notes">
      {canWrite && (
        <form className="note-form" onSubmit={submit}>
          <div className="note-starters">
            {STARTERS.map((s) => (
              <button type="button" key={s} onClick={() => (setBody((b) => (b.trim() ? `${b.trim()} ${s}` : s) + " "), box.current?.focus())}>
                {s}
              </button>
            ))}
          </div>
          <textarea
            ref={box}
            className="textarea"
            rows={3}
            maxLength={4000}
            placeholder={`Add a note about ${person.name}…`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="note-form-actions">
            <label className="checkbox checkbox-inline">
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
              <span>Share with parents</span>
            </label>
            <button className="btn btn-primary btn-sm" disabled={busy || !body.trim()}>
              {busy ? "Saving…" : "Add note"}
            </button>
          </div>
        </form>
      )}
      {error && <p className="field-error">{error}</p>}
      {notes === null ? (
        <p className="row-sub">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="row-sub">No notes yet.</p>
      ) : (
        <ul className="note-list">
          {notes.map((n) => (
            <li key={n.id}>
              <p className="note-body">{n.body}</p>
              {n.shared_with_parents && <span className="badge badge-success note-shared">Shared with parents</span>}
              <div className="note-meta">
                <span>
                  {n.author_email} · {when(n.created_at)}
                </span>
                {canWrite && (n.author_email === me || isAdmin) && (
                  <span className="note-actions">
                    <button className="link-btn" onClick={() => toggleShare(n)}>
                      {n.shared_with_parents ? "Stop sharing" : "Share with parents"}
                    </button>
                    <button className="link-btn" onClick={() => remove(n.id)}>
                      Delete
                    </button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
