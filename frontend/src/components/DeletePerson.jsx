import { useEffect, useState } from "react";
import { deletePerson, deletePreview, markStudentLeft } from "../data/api.js";
import { Photo, gradeLabel } from "./PersonCard.jsx";
import Icon from "./Icon.jsx";

const plural = (n, word) => `${n.toLocaleString("en-IN")} ${word}${n === 1 ? "" : "s"}`;

// Owner only: delete a student or staff profile for good, after showing
// what goes with it. Students with fee receipts can't be deleted (the
// school's accounts keep them); they can be marked Left instead.
export default function DeletePerson({ person, kind, sessionId, onClose, onDeleted, onLeft }) {
  const isStudent = kind === "students";
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    deletePreview(kind, person.id).then(
      (p) => (p ? setInfo(p) : setError("Only the school owner can delete profiles.")),
      () => setError("Couldn’t check this profile. Check your connection.")
    );
  }, [kind, person.id]);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const blocked = info && (isStudent ? info.payments > 0 : info.self || info.owner);
  const goes = !info
    ? []
    : isStudent
      ? [
          info.dues > 0 && plural(info.dues, "fee due"),
          info.results > 0 && plural(info.results, "result"),
          info.attendance > 0 && plural(info.attendance, "attendance mark"),
          info.messages > 0 && plural(info.messages, "message"),
          info.requests > 0 && plural(info.requests, "request"),
        ].filter(Boolean)
      : [info.access && `their app access (${info.access})`, info.classes > 0 && plural(info.classes, "class assignment")].filter(Boolean);

  async function remove() {
    if (!armed) return setArmed(true);
    setBusy(true);
    setError("");
    try {
      await deletePerson(kind, person);
      onDeleted(person.id);
    } catch (e) {
      setError(
        e?.hint === "has-payments"
          ? "This student has fee receipts, so the profile can’t be deleted."
          : e?.hint === "is-self"
            ? "You can’t delete your own profile."
            : e?.hint === "is-owner"
              ? "An owner’s profile can’t be deleted."
              : "Couldn’t delete. Check your connection and try again."
      );
      setBusy(false);
      setArmed(false);
    }
  }
  async function markLeft() {
    setBusy(true);
    setError("");
    try {
      onLeft(await markStudentLeft(person.id, sessionId));
    } catch {
      setError("Couldn’t mark as left. Check your connection.");
      setBusy(false);
    }
  }

  const sub = isStudent ? [gradeLabel(person.class), person.section, person.admission_no].filter(Boolean).join(" · ") : [person.designation, person.department].filter(Boolean).join(" · ");

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <section className="modal del-person" role="alertdialog" aria-modal="true" aria-label="Delete profile" onClick={(e) => e.stopPropagation()}>
        <div className="del-top">
          <span className="del-icon">
            <Icon name="trash" size={22} />
          </span>
          <button className="btn-icon" onClick={onClose} aria-label="Close" disabled={busy}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <h2>Delete this profile?</h2>
        <div className="del-who">
          <Photo person={person} className="inbox-photo" />
          <span>
            <strong>{person.name}</strong>
            {sub && <span className="row-sub">{sub}</span>}
          </span>
        </div>

        {!info && !error && <p className="row-sub">Checking…</p>}

        {info && blocked && isStudent && (
          <div className="del-note">
            <Icon name="rupee" size={18} />
            <p>
              {person.name.split(" ")[0]} has {plural(info.payments, "fee receipt")}, which the school’s accounts keep, so this profile can’t be deleted. Mark them as
              <strong> Left</strong> instead: they go off the lists and every record stays.
            </p>
          </div>
        )}
        {info && blocked && !isStudent && <div className="del-note"><Icon name="x" size={18} /><p>{info.self ? "This is your own profile; it can’t be deleted." : "An owner’s profile can’t be deleted."}</p></div>}

        {info && !blocked && (
          <>
            <p className="del-text">
              This can’t be undone.
              {goes.length > 0 ? " Deleting also removes:" : isStudent ? " Nothing else is recorded for this student." : " They have no app access or classes."}
            </p>
            {goes.length > 0 && (
              <ul className="del-list">
                {goes.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            )}
            {isStudent && <p className="row-sub del-alt">Leaving the school? Mark as Left keeps everything instead.</p>}
          </>
        )}

        {error && <p className="field-error">{error}</p>}

        <footer className="del-foot">
          {isStudent && info && person.status !== "left" && (
            <button className="btn btn-secondary" onClick={markLeft} disabled={busy}>
              Mark as Left
            </button>
          )}
          {info && !blocked && (
            <button className={`btn btn-danger${armed ? " is-armed" : ""}`} onClick={remove} disabled={busy}>
              <Icon name="trash" /> {busy ? "Deleting…" : armed ? "Tap again to delete" : "Delete for good"}
            </button>
          )}
          {(!info || blocked) && (
            <button className="btn" onClick={onClose} disabled={busy}>
              Close
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
