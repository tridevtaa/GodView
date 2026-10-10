import { useEffect, useRef, useState } from "react";
import { savePhoto } from "../data/photos.js";
import { attendanceMonth, listResults } from "../data/api.js";
import ProfileEdit from "./ProfileEdit.jsx";
import Chat from "./Chat.jsx";
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

// Facts shown as an icon and the value (the label is the tooltip); facts
// without an icon keep a small label.
const FACT_ICON = {
  Father: "father",
  Mother: "mother",
  "Parent phone": "phone",
  "Father phone": "phone",
  "Mother phone": "phone",
  Email: "mail",
  "Date of birth": "cake",
  Category: "tag",
  Religion: "religion",
  Aadhaar: "idcard",
  Home: "pin",
  Stream: "book",
  "Admission date": "register",
  "Admission type": "newAdmission",
  SRN: "hash",
  "Left on": "logout",
  Remarks: "note",
  Phone: "phone",
  Joined: "register",
};

// Details in groups; empty rows and empty groups are left out.
const GROUPS = {
  students: [
    [
      "Family",
      [
        ["Father", (p) => p.parent_name],
        ["Mother", (p) => p.mother_name],
        // Owners and admins see the numbers under Parent app instead.
        ["Parent phone", (p) => phone(p.parent_phone), null, "staff"],
        ["Father phone", (p) => p.father_phone !== p.parent_phone && phone(p.father_phone), null, "staff"],
        ["Mother phone", (p) => p.mother_phone !== p.parent_phone && phone(p.mother_phone), null, "staff"],
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
        ],
      ],
    ],
    [
      "School",
      [
        ["Stream", (p) => p.stream],
        // Office details: teachers don't need them. (The bus is in the header.)
        ["Admission date", (p) => longDate(p.admission_date), null, "admin"],
        ["Admission type", (p) => [p.admission_type, p.admission_category].filter(Boolean).join(" · "), null, "admin"],
        ["SRN", (p) => p.srn],
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

// This month's attendance: a dot per marked day and the totals.
export function MonthAttendance({ studentId, title = "This month" }) {
  const [days, setDays] = useState(null);
  useEffect(() => {
    const d = new Date();
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    attendanceMonth(studentId, local).then(setDays, () => setDays([]));
  }, [studentId]);
  if (!days?.length) return null;
  const n = (s) => days.filter((d) => d.status === s).length;
  const present = n("present") + n("late");
  return (
    <section className="profile-group month-att">
      <h3>{title}</h3>
      <div className="month-att-dots" aria-hidden="true">
        {days.map((d) => (
          <i key={d.day} className={`att-dot att-${d.status}`} title={`${d.day}: ${d.status}`} />
        ))}
      </div>
      <p className="month-att-sum">
        <strong>
          {present} of {days.length} days
        </strong>{" "}
        {n("absent") > 0 && ` · ${n("absent")} absent`}
        {n("late") > 0 && ` · ${n("late")} late`}
        {n("leave") > 0 && ` · ${n("leave")} on leave`}
      </p>
    </section>
  );
}

const TAB_ICONS = { details: "file", fees: "rupee", messages: "message", results: "chart" };

// The student page header, kept minimal: photo, name and three numbers
// (each opens its tab), a line about the student, and the main actions.
function StudentHero({ person, mode, schoolId, sessionId, routes, isAdmin, canEdit, canWrite, editing, callNo, onEdit, onUpdate, onTab }) {
  const [att, setAtt] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let off = false;
    const d = new Date();
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    attendanceMonth(person.id, local).then(
      (days) => {
        if (off || !days.length) return;
        const present = days.filter((x) => x.status === "present" || x.status === "late").length;
        setAtt(Math.round((present / days.length) * 100));
      },
      () => {}
    );
    if (sessionId) {
      listResults(person.id, sessionId).then(
        (rows) => {
          if (off) return;
          // The most recently entered exam's overall percentage.
          const latest = [...rows].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0]?.exam;
          const scored = rows.filter((r) => r.exam === latest && r.marks !== null && r.max_marks);
          const max = scored.reduce((t, r) => t + Number(r.max_marks), 0);
          if (max) setResult({ pct: Math.round((scored.reduce((t, r) => t + Number(r.marks), 0) / max) * 100), exam: latest });
        },
        () => {}
      );
    }
    return () => {
      off = true;
    };
  }, [person.id, sessionId]);

  const due = Number(person.fee_due) || 0;
  const feeKnown = isAdmin && person.fee_status && person.fee_status !== "unknown";
  const bus = person.uses_bus ? stopLabel(routes, person.bus_stop_id) || [person.transport_route, person.pickup_point].filter(Boolean).join(" · ") : "";
  const stats = [
    ["Attendance", att === null ? "–" : `${att}%`, "this month", "", () => onTab("details")],
    ["Result", result ? `${result.pct}%` : "–", result?.exam ?? "no marks yet", "", () => onTab("results")],
    isAdmin
      ? ["Fees due", feeKnown ? (due > 0 ? rupees(due) : "Paid") : "–", feeKnown ? (due > 0 ? "due now" : "all clear") : "not set", due > 0 ? "is-due" : "", () => onTab("fees")]
      : null,
  ].filter(Boolean);

  return (
    <header className="ig-hero">
      <div className="ig-top">
        <EditablePhoto person={person} kind={mode} schoolId={schoolId} canWrite={canWrite} onSaved={(patch) => onUpdate(person.id, patch)} />
        <div className="ig-head">
          <div>
            <h2 className="ig-name">
              {person.name}
              <GenderMark gender={person.gender} />
            </h2>
            {person.admission_no && <p className="ig-id">#{person.admission_no}</p>}
          </div>
          <ul className="ig-stats">
            {stats.map(([label, value, note, tone, onClick]) => {
              const inner = (
                <>
                  <strong className={tone || ""}>{value}</strong>
                  <span>{label}</span>
                </>
              );
              return (
                <li key={label} title={`${label}: ${value} ${note}`}>
                  {onClick ? (
                    <button type="button" onClick={onClick}>
                      {inner}
                    </button>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="ig-bio-row">
      <div className="ig-bio">
        <p className="ig-bio-main">
          <span>
            {gradeLabel(person.class)}
            <span className="ig-section">
              {person.section ? ` · ${person.section}` : ""}
              {person.roll_no ? ` · Roll ${person.roll_no}` : ""}
            </span>
          </span>
          {person.status === "left" && <span className="badge badge-danger">Left</span>}
        </p>
        {bus && (
          <p className="ig-bus">
            <Icon name="bus" size={14} /> {bus}
          </p>
        )}
      </div>

      {!editing && (callNo || canEdit) && (
        <div className="ig-actions">
          {callNo && (
            <a className="ig-act" href={`tel:${callNo}`} aria-label="Call parent" title="Call parent">
              <Icon name="phone" size={18} />
            </a>
          )}
          {callNo && (
            <a className="ig-act" href={`https://wa.me/91${digits(callNo)}`} target="_blank" rel="noreferrer" aria-label="WhatsApp parent" title="WhatsApp parent">
              <Icon name="whatsapp" size={19} />
            </a>
          )}
          {canEdit && (
            <button className="ig-act" onClick={onEdit} aria-label="Edit details" title="Edit details">
              <Icon name="edit" size={18} />
            </button>
          )}
        </div>
      )}
      </div>

    </header>
  );
}

// The student's photo; staff who can write tap it to add or change it.
function EditablePhoto({ person, kind, schoolId, canWrite, onSaved }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const img = <Photo person={person} className="ig-photo-img" />;
  if (!canWrite) return <div className="ig-photo">{img}</div>;

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      onSaved(await savePhoto(schoolId, kind, person, file));
    } catch (err) {
      setError(err.message === "not-an-image" ? "Choose an image." : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  const label = person.has_photo || person.photo_url ? "Change photo" : "Add photo";
  return (
    <div className="ig-photo-wrap">
      <button type="button" className={`ig-photo is-editable${busy ? " is-busy" : ""}`} onClick={() => input.current.click()} disabled={busy} title={label} aria-label={label}>
        {img}
        <span className="ig-photo-hint" aria-hidden="true">
          {busy ? <span className="spinner" /> : <Icon name="camera" size={22} />}
        </span>
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={onFile} />
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

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
// A student's or employee's profile. Students open as a full page (asPage),
// with a back bar and previous/next; employees as a pop-up.
export default function ProfileModal({ person, mode, initialTab = "details", school, schoolId, sessionId, me, isAdmin, canEdit, canWrite, onUpdate, onFeesChanged, onClose, routes = [], asPage = false }) {
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState(initialTab);

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
        .filter(([, , , only]) => (only !== "admin" || isAdmin) && (only !== "staff" || !isAdmin))
        .map(([label, get, wide]) => [label, get(person, routes), wide])
        .filter(([, v]) => v),
    ])
    .filter(([, rows]) => rows.length);
  const callNo = person.parent_phone || person.father_phone || person.mother_phone || person.phone;
  const feeKnown = isStudent && isAdmin && person.fee_status && person.fee_status !== "unknown";
  const tabs = [
    ["details", "Details"],
    ...(isAdmin ? [["fees", "Fees"]] : []),
    ["messages", "Messages"],
    ["results", "Results"],
  ];

  const card = (
      <section
        className={asPage ? "profile profile-full" : "modal modal-lg profile"}
        {...(asPage ? { "aria-label": `${person.name} profile` } : { role: "dialog", "aria-modal": "true", "aria-label": `${person.name} profile` })}
        onClick={(e) => e.stopPropagation()}
        style={{ "--tint": tintFor(person) }}
      >
        {asPage && isStudent ? (
          <StudentHero
            person={person}
            mode={mode}
            schoolId={schoolId}
            sessionId={sessionId}
            routes={routes}
            isAdmin={isAdmin}
            canEdit={canEdit}
            canWrite={canWrite}
            editing={editing}
            callNo={callNo}
            onEdit={() => setEditing(true)}
            onUpdate={onUpdate}
            onTab={setTab}
          />
        ) : (
        <>
        <div className="profile-band">
          <div className="profile-tools">
            {canEdit && !editing && (
              <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
                <Icon name="edit" />
                Edit
              </button>
            )}
            {!asPage && (
              <button className="btn-icon profile-close" onClick={onClose} aria-label="Close">
                <Icon name="x" size={18} />
              </button>
            )}
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

        </>
        )}

        {isStudent && !editing && asPage && (
          <nav className="ig-tabs" aria-label="Profile sections">
            {tabs.map(([value, label]) => (
              <button key={value} className={tab === value ? "is-on" : ""} onClick={() => setTab(value)} aria-current={tab === value ? "page" : undefined}>
                <Icon name={TAB_ICONS[value]} size={18} weight={tab === value ? "fill" : "regular"} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        )}
        {isStudent && !editing && !asPage && (
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
          ) : isStudent && !editing && tab === "messages" ? (
            <Chat studentId={person.id} viewer="staff" me={me} canSend={canWrite} canAnswer={canWrite} />
          ) : isStudent && !editing && tab === "results" ? (
            <StudentResults person={person} sessionId={sessionId} me={me} isAdmin={isAdmin} canWrite={canWrite} />
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
              {isStudent && <MonthAttendance studentId={person.id} />}
              {groups.length === 0 && <p className="row-sub">No details recorded yet.</p>}
              {(groups.length > 0 || (isStudent && isAdmin)) && (
                <section className="profile-group profile-facts">
                  <ul className="facts">
                    {groups.flatMap(([, rows]) => rows).map(([label, value, wide]) => (
                      <li key={label} className={wide ? "is-wide" : ""} title={label}>
                        {FACT_ICON[label] ? (
                          <span className="fact-icon" role="img" aria-label={label}>
                            <Icon name={FACT_ICON[label]} size={18} />
                          </span>
                        ) : (
                          <span className="fact-label">{label}</span>
                        )}
                        <span className="fact-value">{value}</span>
                      </li>
                    ))}
                  </ul>
                  {isStudent && isAdmin && <StudentParents person={person} canEdit={canEdit} />}
                </section>
              )}
            </div>
          )}
        </div>
      </section>
  );

  if (!asPage) {
    return (
      <div className="modal-backdrop" onClick={() => !editing && onClose()}>
        {card}
      </div>
    );
  }
  return (
    <div className="profile-page">
      <nav className="profile-page-bar" aria-label="Student">
        <button className="back-btn" onClick={onClose} aria-label="Back to students" title="Back">
          <Icon name="chevronLeft" size={22} />
        </button>
      </nav>
      {card}
    </div>
  );
}
