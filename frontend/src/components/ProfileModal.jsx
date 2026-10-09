import { useEffect, useRef, useState } from "react";
import { savePhoto } from "../data/photos.js";
import ProfileEdit from "./ProfileEdit.jsx";
import { FeeBadge, Photo, feeTitle, formatINR, gradeLabel, relation } from "./PersonCard.jsx";
import Icon from "./Icon.jsx";

const phone = (n) => n && <a href={`tel:${n}`}>{n}</a>;

// Shows only the last 4 digits until staff choose to reveal the number.
function Masked({ value }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="masked">
      {shown ? value : `•••• •••• ${value.slice(-4)}`}
      <button type="button" className="link-btn" onClick={() => setShown((s) => !s)}>
        {shown ? "Hide" : "Show"}
      </button>
    </span>
  );
}

const DETAILS = {
  students: [
    ["Stream", (p) => p.stream],
    ["Left on", (p) => p.status === "left" && p.left_as_of],
    ["Remarks", (p) => p.remarks],
    ["Father", (p) => p.parent_name && `${relation(p.gender)} ${p.parent_name}`],
    ["Mother", (p) => p.mother_name],
    ["Parent phone", (p) => phone(p.parent_phone)],
    ["Father phone", (p) => p.father_phone !== p.parent_phone && phone(p.father_phone)],
    ["Mother phone", (p) => p.mother_phone !== p.parent_phone && phone(p.mother_phone)],
    ["Email", (p) => p.email && <a href={`mailto:${p.email}`}>{p.email}</a>],
    ["Address", (p) => [p.address, p.city, p.state].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ")],
    ["Roll no.", (p) => p.roll_no],
    ["Date of birth", (p) => p.dob],
    ["Category", (p) => p.category],
    ["Session", (p) => p.session],
    ["Admission date", (p) => p.admission_date],
    ["Admission type", (p) => [p.admission_type, p.admission_category].filter(Boolean).join(" · ")],
    ["Religion", (p) => p.religion],
    ["SRN", (p) => p.srn],
    ["Aadhaar", (p) => p.aadhaar && <Masked value={p.aadhaar} />],
    ["Bus route", (p) => [p.transport_route, p.pickup_point].filter(Boolean).join(" · ")],
    ["School", (p) => p.school_id],
  ],
  employees: [

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
      onSaved(await savePhoto(kind, person.id, file));
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
        title={person.has_photo ? "Change photo" : "Upload photo"}
        aria-label={person.has_photo ? "Change photo" : "Upload photo"}
      >
        {busy ? <span className="spinner" /> : <Icon name="camera" />}
      </button>
      {error && <p className="field-error">{error}</p>}
    </>
  );
}

export default function ProfileModal({ person, mode, canEdit, onUpdate, onClose }) {
  const [editing, setEditing] = useState(false);

  // Esc leaves edit mode first, so unsaved changes aren't lost with the pop-up.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (editing) setEditing(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editing]);

  const isStudent = mode === "students";
  const rows = DETAILS[mode]
    .map(([label, get]) => [label, get(person)])
    .filter(([, value]) => value);

  return (
    <div className="modal-backdrop" onClick={() => !editing && onClose()}>
      <section
        className="modal modal-lg"
        role="dialog"
        aria-modal="true"
        aria-label={`${person.name} profile`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="profile-header">
          <div className="profile-photo">
            <Photo person={person} kind={mode} className="photo-lg" />
            {canEdit && (
              <PhotoUpload person={person} kind={mode} onSaved={(patch) => onUpdate(person.id, patch)} />
            )}
          </div>
          <div className="profile-heading">
            <h2>{person.name}</h2>
            <p className="profile-sub">
              {isStudent ? person.admission_no : [person.employee_no, person.department].filter(Boolean).join(" · ")}
            </p>
            <div className="badge-row">
              <span className="tag">{isStudent ? gradeLabel(person.class) : person.designation}</span>
              {isStudent && person.section && <span className="badge badge-neutral">{person.section}</span>}
              {person.status === "inactive" && <span className="badge badge-neutral">Inactive</span>}
              {person.status === "left" && <span className="badge badge-danger">Left</span>}
              {isStudent && <FeeBadge person={person} />}
            </div>
          </div>
          <div className="profile-tools">
            {canEdit && !editing && (
              <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
                <Icon name="edit" />
                Edit
              </button>
            )}
            <button className="btn-icon" onClick={onClose} aria-label="Close">
              <Icon name="x" size={18} />
            </button>
          </div>
        </header>

        <div className="modal-body">
          {editing ? (
            <ProfileEdit
              person={person}
              kind={mode}
              onCancel={() => setEditing(false)}
              onSaved={(changes) => {
                onUpdate(person.id, changes);
                setEditing(false);
              }}
            />
          ) : (
            <>
              {isStudent && person.fee_due > 0 && (
                <div className="callout callout-warning">
                  <div className="callout-head">
                    <strong>{feeTitle(person)}</strong>
                    {person.fee_as_of && <span>as of {person.fee_as_of}</span>}
                  </div>
                  {person.fee_due_months?.length > 0 && <p>For {person.fee_due_months.join(", ")}</p>}
                  <dl className="ledger">
                    {Object.entries(person.fee_breakdown || {}).map(([head, amount]) => (
                      <div key={head}>
                        <dt>{head.replace(/_/g, " ")}</dt>
                        <dd>{formatINR(amount)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
              <dl className="details">
                {rows.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
