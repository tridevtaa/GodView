import { useEffect, useState } from "react";
import { accountDeletionBlockers, deleteMyAccount } from "../data/profile.js";
import { logOut } from "./AuthGate.jsx";
import Icon from "./Icon.jsx";

// Bottom of My profile (staff and parents): delete their own account, as
// Google Play asks. Their sign-in and personal details go; the school's
// records stay. A school's only owner is stopped (the school would have
// nobody to run it) and pointed to us instead.
export default function DeleteAccount({ isStaff }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="account-delete">
        <button type="button" className="link-btn account-delete-btn" onClick={() => setOpen(true)}>
          <Icon name="trash" size={14} /> Delete account
        </button>
      </div>
      {open && <DeleteAccountDialog isStaff={isStaff} onClose={() => setOpen(false)} />}
    </>
  );
}

function DeleteAccountDialog({ isStaff, onClose }) {
  const [blockers, setBlockers] = useState(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    accountDeletionBlockers().then(setBlockers, () => setError("Couldn’t check your account. Check your connection."));
  }, []);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const blocked = blockers?.length > 0;
  const ready = typed.trim().toUpperCase() === "DELETE";

  async function remove(e) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      await deleteMyAccount();
      setDone(true);
      setTimeout(() => logOut(), 1500);
    } catch (err) {
      setError(
        err.code === "sole_owner"
          ? "You’re the only owner of a school, so your account can’t be deleted yet."
          : err.code === "signed_out"
            ? "You’ve been signed out. Sign in again and try once more."
            : "Couldn’t delete your account. Check your connection and try again."
      );
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <form className="modal del-person" role="alertdialog" aria-modal="true" aria-label="Delete your account" onClick={(e) => e.stopPropagation()} onSubmit={remove}>
        <div className="del-top">
          <span className="del-icon">
            <Icon name={done ? "check" : "trash"} size={22} />
          </span>
          {!done && (
            <button type="button" className="btn-icon" onClick={onClose} aria-label="Close" disabled={busy}>
              <Icon name="x" size={18} />
            </button>
          )}
        </div>

        {done ? (
          <>
            <h2>Your account is deleted</h2>
            <p className="del-text">Signing you out…</p>
          </>
        ) : (
          <>
            <h2>Delete your account?</h2>
            {!blockers && !error && <p className="row-sub">Checking…</p>}

            {blocked && (
              <div className="del-note">
                <Icon name="x" size={18} />
                <p>
                  You’re the only owner of {blockers.map((s) => s.name).join(", ")}, so the school would have nobody to run it. Write to{" "}
                  <a href="mailto:support@godview.in?subject=Delete%20my%20Godview%20account">support@godview.in</a> and we’ll help you hand it over or close the
                  school.
                </p>
              </div>
            )}

            {blockers && !blocked && (
              <>
                <p className="del-text">This can’t be undone. Deleting removes:</p>
                <ul className="del-list">
                  <li>Your sign-in</li>
                  {isStaff && <li>Your access to the school and your classes</li>}
                  <li>Your photo and the personal details you added</li>
                  <li>Notifications on your devices</li>
                </ul>
                <p className="row-sub del-alt">Attendance, results, fees and messages stay with the school.</p>
                <label className="account-delete-confirm">
                  <span>Type DELETE to confirm</span>
                  <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={busy} />
                </label>
              </>
            )}

            {error && <p className="field-error">{error}</p>}

            <footer className="del-foot">
              {blockers && !blocked ? (
                <>
                  <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
                    Cancel
                  </button>
                  <button className="btn btn-danger" disabled={!ready || busy}>
                    <Icon name="trash" /> {busy ? "Deleting…" : "Delete account"}
                  </button>
                </>
              ) : (
                <button type="button" className="btn" onClick={onClose}>
                  Close
                </button>
              )}
            </footer>
          </>
        )}
      </form>
    </div>
  );
}
