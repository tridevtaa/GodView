import { useEffect, useRef, useState } from "react";
import { savePhoto } from "../data/photos.js";
import ProfileEdit from "./ProfileEdit.jsx";
import StudentNotes from "./StudentNotes.jsx";
import StudentResults from "./StudentResults.jsx";
import FeeLedger from "./FeeLedger.jsx";
import StudentParents from "./StudentParents.jsx";
import { Photo, gradeLabel, relation, tintFor } from "./PersonCard.jsx";
import { rupees } from "../data/money.js";
import { mapsLink } from "../data/maps.js";
import { stopLabel } from "./TransportPicker.jsx";
import Icon from "./Icon.jsx";

const phone = (n) => n && <a href={`tel:${n}`}>{n}</a>;
const longDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
function age(dob) {
  if (!dob) return "";
  const b = new Date(dob);
  const now = new Date();
  let y = now.getFullYear() - b.getFullYear();
  if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) y -= 1;
  return y >= 0 ? `${y} yrs` : "";
}
const digits = (n = "") => String(n).replace(/\D/g, "").slice(-10);

// Details in groups; empty rows and empty groups are left out.
const GROUPS = {
  students: [
    [
      "Family",
      [
        ["Father", (p) => p.parent_name],
        ["Mother", (p) => p.mother_name],
        ["Parent phone", (p) => phone(p.parent_phone)],
        ["Father phone", (p) => p.father_phone !== p.parent_phone && phone(p.father_phone)],
        ["Mother phone", (p) => p.mother_phone !== p.parent_phone && phone(p.mother_phone)],
        ["Email", (p) => p.email && <a href={`mailto:${p.email}`}>{p.email}</a>],
      ],
    ],
    [
      "Personal",
      [
        ["Date of birth", (p) => p.dob && `${longDate(p.dob)}${age(p.dob) ? ` · ${age(p.dob)}` : ""}`],
        ["Category", (p) => p.category],
        ["Religion", (p) => p.religion],
        // Only the last 4 digits are stored.
        ["Aadhaar", (p) => p.aadhaar && <span className="masked">•••• •••• {p.aadhaar}</span>],
        [
          "Home",
          (p) => {
            const text = [p.address, p.city, p.state].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ");
            if (p.home_lat == null) return text;
            return (
              <span className="home-line">
                {text || "Pinned on the map"}
                <a className="pin-link" href={mapsLink(p.home_lat, p.home_lng)} target="_blank" rel="noreferrer">
                  <Icon name="pin" size={13} />
                  Map
                </a>
              </span>
            );
          },
          "wide",
        ],
      ],
    ],
    [
      "School",
      [
        ["Roll no.", (p) => p.roll_no],
        ["Stream", (p) => p.stream],
        // Office details: teachers don't need them.
        ["Admission date", (p) => longDate(p.admission_date), null, "admin"],
        ["Admission type", (p) => [p.admission_type, p.admission_category].filter(Boolean).join(" · "), null, "admin"],
        ["SRN", (p) => p.srn],
        ["Bus", (p, routes) => (p.uses_bus ? stopLabel(routes, p.bus_stop_id) || [p.transport_route, p.pickup_point].filter(Boolean).join(" · ") || "Uses the bus" : !p.bus_stop_id && [p.transport_route, p.pickup_point].filter(Boolean).join(" · "))],
        ["Left on", (p) => p.status === "left" && longDate(p.left_as_of)],
        ["Remarks", (p) => p.remarks, "wide"],
      ],
    ],
  ],
  employees: [
    [
      "Contact",
      [
        ["Phone", (p) => phone(p.phone)],
        ["Email", (p) => p.email && <a href={`mailto:${p.email}`}>{p.email}</a>],
        ["Joined", (p) => longDate(p.joining_date)],
      ],
    ],
  ],
};

// Boy / girl mark beside a student's name.
function GenderMark({ gender }) {
  const g = { M: ["male", "Boy"], F: ["female", "Girl"] }[gender];
  if (!g) return null;
  return (
    <span className={`gender gender-${g[0]}`} title={g[1]} aria-label={g[1]}>
      <Icon name={g[0]} size={14} />
    </span>
  );
}

function PhotoUpload({ person, kind, schoolId, onSaved }) {
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
      onSaved(await savePhoto(schoolId, kind, person, file));
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

// canEdit: change the record (owners/admins, current session)
// canWrite: photos, notes and results (anyone who can see the student, current session)
export default function ProfileModal({ person, mode, initialTab = "details", school, schoolId, sessionId, me, isAdmin, canEdit, canWrite, onUpdate, onFeesChanged, onClose, routes = [] }) {
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState(initialTab);
  // "Add note" / "Add result" on Details open that tab ready to type.
  const [startAdding, setStartAdding] = useState(null);
  const addTo = (t) => {
    setStartAdding(t);
    setTab(t);
  };

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
  const groups = GROUPS[mode]
    .map(([title, rows]) => [
      title,
      rows
        .filter(([, , , only]) => only !== "admin" || isAdmin)
        .map(([label, get, wide]) => [label, get(person, routes), wide])
        .filter(([, v]) => v),
    ])
    .filter(([, rows]) => rows.length);
  const callNo = person.parent_phone || person.father_phone || person.mother_phone || person.phone;
  const feeKnown = isStudent && isAdmin && person.fee_status && person.fee_status !== "unknown";
  const tabs = [
    ["details", "Details"],
    ...(isAdmin ? [["fees", "Fees"], ["parents", "Parents"]] : []),
    ["notes", "Notes"],
    ["results", "Results"],
  ];

  return (
    <div className="modal-backdrop" onClick={() => !editing && onClose()}>
      <section
        className="modal modal-lg profile"
        role="dialog"
        aria-modal="true"
        aria-label={`${person.name} profile`}
        onClick={(e) => e.stopPropagation()}
        style={{ "--tint": tintFor(person) }}
      >
        <div className="profile-band">
          <div className="profile-tools">
            {canEdit && !editing && (
              <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
                <Icon name="edit" />
                Edit
              </button>
            )}
            <button className="btn-icon profile-close" onClick={onClose} aria-label="Close">
              <Icon name="x" size={18} />
            </button>
          </div>
        </div>

        <header className="profile-header">
          <div className="profile-photo">
            <Photo person={person} className="photo-lg" />
            {canWrite && (
              <PhotoUpload person={person} kind={mode} schoolId={schoolId} onSaved={(patch) => onUpdate(person.id, patch)} />
            )}
          </div>
          <div className="profile-heading">
            <div className="profile-chips">
              <span className="chip-id">{isStudent ? person.admission_no : person.employee_no}</span>
              <span className="tag">{isStudent ? gradeLabel(person.class) : person.designation}</span>
              {isStudent && person.section && <span className="profile-section">{person.section}</span>}
              {person.status === "inactive" && <span className="badge badge-neutral">Inactive</span>}
              {person.status === "left" && <span className="badge badge-danger">Left</span>}
            </div>
            <h2>
              {person.name}
              {isStudent && <GenderMark gender={person.gender} />}
            </h2>
            <p className="profile-sub">
              {isStudent
                ? person.parent_name && `${relation(person.gender)} ${person.parent_name}`
                : person.department}
            </p>
          </div>
        </header>

        {!editing && (feeKnown || callNo) && (
          <div className="profile-strip">
            {feeKnown && (
              <button className={`profile-stat is-${person.fee_status}`} onClick={() => setTab("fees")} title="Open fees">
                <span className={`fee fee-${person.fee_status}`}>₹</span>
                <span>
                  <span className="profile-stat-label">{Number(person.fee_due) > 0 ? "Due now" : "Fees"}</span>
                  <strong>{Number(person.fee_due) > 0 ? rupees(person.fee_due) : "All paid"}</strong>
                </span>
              </button>
            )}
            {feeKnown && Number(person.fee_paid) > 0 && (
              <div className="profile-stat">
                <span>
                  <span className="profile-stat-label">Paid this session</span>
                  <strong>{rupees(person.fee_paid)}</strong>
                </span>
              </div>
            )}
            {callNo && (
              <span className="profile-actions">
                <a className="btn btn-secondary btn-sm" href={`tel:${callNo}`}>
                  <Icon name="phone" />
                  Call
                </a>
                <a className="btn btn-secondary btn-sm" href={`https://wa.me/91${digits(callNo)}`} target="_blank" rel="noreferrer">
                  <Icon name="message" />
                  WhatsApp
                </a>
              </span>
            )}
          </div>
        )}

        {isStudent && !editing && (
          <nav className="segmented profile-tabs" aria-label="Profile sections">
            {tabs.map(([value, label]) => (
              <button key={value} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>
                {label}
              </button>
            ))}
          </nav>
        )}

        <div className="modal-body profile-body">
          {isStudent && !editing && tab === "fees" ? (
            <FeeLedger school={school} person={person} canEdit={canEdit} onChanged={onFeesChanged} />
          ) : isStudent && !editing && tab === "parents" ? (
            <StudentParents person={person} canEdit={canEdit} />
          ) : isStudent && !editing && tab === "notes" ? (
            <StudentNotes person={person} me={me} isAdmin={isAdmin} canWrite={canWrite} autoFocus={startAdding === "notes"} />
          ) : isStudent && !editing && tab === "results" ? (
            <StudentResults person={person} sessionId={sessionId} me={me} isAdmin={isAdmin} canWrite={canWrite} autoFocus={startAdding === "results"} />
          ) : editing ? (
            <ProfileEdit
              person={person}
              kind={mode}
              sessionId={sessionId}
              routes={routes}
              onCancel={() => setEditing(false)}
              onSaved={(changes) => {
                onUpdate(person.id, changes);
                setEditing(false);
              }}
            />
          ) : (
            <div className="profile-groups">
              {isStudent && canWrite && (
                <div className="profile-quick">
                  <button className="btn btn-secondary btn-sm" onClick={() => addTo("notes")}>
                    <Icon name="edit" /> Add note
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => addTo("results")}>
                    <Icon name="plus" /> Add result
                  </button>
                </div>
              )}
              {groups.length === 0 && <p className="row-sub">No details recorded yet.</p>}
              {groups.map(([title, rows]) => (
                <section key={title} className="profile-group">
                  <h3>{title}</h3>
                  <dl className="details">
                    {rows.map(([label, value, wide]) => (
                      <div key={label} className={wide ? "is-wide" : ""}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
