import { useEffect, useRef, useState } from "react";
import { savePhoto } from "../data/photos.js";
import { Photo, feeTitle, formatINR, gradeLabel, relation } from "./PersonCard.jsx";

const DETAILS = {
  students: [
    ["Admission no.", (p) => p.admission_no],
    ["Grade", (p) => [gradeLabel(p.class), p.stream, p.section].filter(Boolean).join(" – ")],
    ["Father", (p) => p.parent_name && `${relation(p.gender)} ${p.parent_name}`],
    ["Mother", (p) => p.mother_name],
    ["Parent phone", (p) => p.parent_phone && <a href={`tel:${p.parent_phone}`}>{p.parent_phone}</a>],
    ["Roll no.", (p) => p.roll_no],
    ["Date of birth", (p) => p.dob],
    ["Category", (p) => p.category],
    ["Session", (p) => p.session],
    ["Bus route", (p) => [p.transport_route, p.pickup_point].filter(Boolean).join(" · ")],
    ["School", (p) => p.school_id],
  ],
  employees: [
    ["Employee no.", (p) => p.employee_no],
    ["Designation", (p) => p.designation],
    ["Department", (p) => p.department],
    ["Phone", (p) => p.phone && <a href={`tel:${p.phone}`}>{p.phone}</a>],
    ["Email", (p) => p.email && <a href={`mailto:${p.email}`}>{p.email}</a>],
    ["Joined", (p) => p.joining_date],
  ],
};

function PhotoUpload({ person, kind, onSaved }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      await savePhoto(kind, person.id, file);
      onSaved({ has_photo: true });
    } catch (err) {
      setError(err.message === "not-an-image" ? "Please choose an image file." : "Upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input ref={input} type="file" accept="image/*" hidden onChange={onFile} />
      <button
        type="button"
        className="photo-upload"
        onClick={() => input.current.click()}
        disabled={busy}
        aria-label={person.has_photo ? "Change photo" : "Upload photo"}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3zm3 5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z" />
        </svg>
        {busy ? "Uploading…" : person.has_photo ? "Change" : "Upload photo"}
      </button>
      {error && <p className="photo-error">{error}</p>}
    </>
  );
}

export default function ProfileModal({ person, mode, index, canEdit, onUpdate, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isStudent = mode === "students";
  const fee = person.fee_status || "unknown";
  const rows = DETAILS[mode]
    .map(([label, get]) => [label, get(person)])
    .filter(([, value]) => value);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal profile"
        role="dialog"
        aria-modal="true"
        aria-label={`${person.name} profile`}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="profile-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="profile-head">
          <div className="profile-photo">
            <Photo person={person} kind={mode} index={index} />
            {canEdit && (
              <PhotoUpload person={person} kind={mode} onSaved={(patch) => onUpdate(person.id, patch)} />
            )}
          </div>
          <div>
            <h2>{person.name}</h2>
            <span className="tag">{isStudent ? gradeLabel(person.class) : person.designation}</span>
            {isStudent && (
              <div className="profile-fee">
                <span className={`fee fee-${fee}`} aria-hidden="true">₹</span>
                {feeTitle(person)}
              </div>
            )}
            {isStudent && person.fee_as_of && (
              <div className="profile-fee-note">as of {person.fee_as_of}</div>
            )}
          </div>
        </div>
        <dl className="profile-details">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {isStudent && person.fee_due > 0 && (
          <div className="profile-dues">
            <h3>Pending fees</h3>
            {person.fee_due_months?.length > 0 && <p>For {person.fee_due_months.join(", ")}</p>}
            <dl>
              {Object.entries(person.fee_breakdown || {}).map(([head, amount]) => (
                <div key={head}>
                  <dt>{head.replace(/_/g, " ")}</dt>
                  <dd>{formatINR(amount)}</dd>
                </div>
              ))}
              <div className="profile-dues-total">
                <dt>Total</dt>
                <dd>{formatINR(person.fee_due)}</dd>
              </div>
            </dl>
          </div>
        )}
      </section>
    </div>
  );
}
