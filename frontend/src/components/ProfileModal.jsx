import { useEffect, useRef, useState } from "react";
import { savePhoto } from "../data/photos.js";
import { attendanceMonth, listAssignments, listResults } from "../data/api.js";
import { idText } from "./Designation.jsx";
import ProfileEdit from "./ProfileEdit.jsx";
import DeletePerson from "./DeletePerson.jsx";
import Chat, { useBackToClose } from "./Chat.jsx";
import StudentResults from "./StudentResults.jsx";
import FeeLedger from "./FeeLedger.jsx";
import StudentParents from "./StudentParents.jsx";
import { Photo, gradeLabel, tintFor } from "./PersonCard.jsx";
import { rupees } from "../data/money.js";
import { mapsLink } from "../data/maps.js";
import { stopLabel } from "./TransportPicker.jsx";
import { Hint, useInsights } from "./AiInsights.jsx";
import Icon, { WhatsAppLogo } from "./Icon.jsx";
import ClassCard, { ClassTeacherBadge, useClassTeachers } from "./ClassCard.jsx";

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
  "Student ID": "idcard",
  "Staff ID": "idcard",
  "Aadhaar / PAN": "idcard",
  "Emergency contact": "phone",
  Qualification: "academics",
  Subjects: "book",
  Classes: "scholar",
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
        ["Student ID", (p) => p.ref_no],
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
        ["Emergency contact", (p) => (p.emergency_name || p.emergency_phone) && <>{p.emergency_name}{p.emergency_name && p.emergency_phone ? " · " : ""}{phone(p.emergency_phone)}</>],
      ],
    ],
    [
      "Work",
      [
        ["Staff ID", (p) => [p.ref_no, p.employee_no].filter(Boolean).join(" · ")],
        ["Joined", (p) => longDate(p.joining_date)],
        ["Classes", (p) => p.classes_text, "wide"],
        ["Subjects", (p) => p.subjects],
        ["Qualification", (p) => p.qualification],
      ],
    ],
    ["Identity", [["Aadhaar / PAN", (p) => p.id_last4 && <span className="masked">{idText(p.id_type, p.id_last4)}</span>]]],
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

const TAB_ICONS = { details: "file", fees: "rupee", messages: "plane", results: "chart" };

// The student page header, kept minimal: photo, name and three numbers
// (each opens its tab), a line about the student, and the main actions.
function StudentHero({ person, mode, school, schoolId, sessionId, routes, isAdmin, canEdit, canWrite, editing, callNo, onEdit, onDelete, onUpdate, onTab }) {
  const [att, setAtt] = useState(null);
  const [result, setResult] = useState(null);
  const teachers = useClassTeachers(person.id, sessionId);

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
  // Each a small tile in the app's colours: [label, value, note, tone, tap]
  const stats = [
    ["Attendance", att === null ? "–" : `${att}%`, "this month", "green", () => onTab("details")],
    ["Result", result ? `${result.pct}%` : "–", result?.exam ?? "no marks yet", "violet", () => onTab("results")],
    isAdmin
      ? ["Fees due", feeKnown ? (due > 0 ? rupees(due) : "Paid") : "–", feeKnown ? (due > 0 ? "due now" : "all clear") : "not set", !feeKnown ? "indigo" : person.fee_status === "overdue" ? "red" : due > 0 ? "amber" : "green", () => onTab("fees")]
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
          {mode === "students" && <ClassTeacherBadge teachers={teachers} />}
          <ul className="ig-stats">
            {stats.map(([label, value, note, tone, onClick]) => (
              <li key={label} title={`${label}: ${value} ${note}`}>
                <button type="button" className={`ig-stat t-${tone}`} onClick={onClick}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </button>
              </li>
            ))}
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
        {mode === "students" && <StudentHint school={school} isAdmin={isAdmin} id={person.id} />}
      </div>

      {!editing && (
        <div className="ig-actions">
          {/* Messages with the parents, beside the other ways to reach them */}
          <button className="ig-act ig-act-msg" onClick={() => onTab("messages")} aria-label="Messages" title="Messages">
            <Icon name="message" size={18} />
          </button>
          {callNo && (
            <a className="ig-act" href={`tel:${callNo}`} aria-label="Call parent" title="Call parent">
              <Icon name="phone" size={18} />
            </a>
          )}
          {callNo && (
            <a className="ig-act" href={`https://wa.me/91${digits(callNo)}`} target="_blank" rel="noreferrer" aria-label="WhatsApp parent" title="WhatsApp parent">
              <WhatsAppLogo size={26} />
            </a>
          )}
          {canEdit && (
            <button className="ig-act" onClick={onEdit} aria-label="Edit details" title="Edit details">
              <Icon name="edit" size={18} />
            </button>
          )}
          {/* Owners only: opens the delete check (what goes with it, or Mark as Left) */}
          {onDelete && (
            <button className="ig-act ig-act-del" onClick={onDelete} aria-label="Delete student" title="Delete student">
              <Icon name="trash" size={18} />
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
      console.error("[profile-photo]", err);
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

// canEdit: change the record (owners/admins, current session)
// canWrite: photos, notes and results (anyone who can see the student, current session)
// A student's or employee's profile. Students open as a full page (asPage),
// with a back bar and previous/next; employees as a pop-up.
export default function ProfileModal({ person, mode, initialTab = "details", school, schoolId, sessionId, me, isAdmin, isOwner = false, canEdit, canWrite, onUpdate, onDeleted, onFeesChanged, onClose, routes = [], asPage = false, students = [], onOpenStudent }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState(initialTab);
  // Phones: Messages opens as a screen of its own; Back returns to Details.
  const closeChat = useBackToClose(tab === "messages", () => setTab("details"));

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
  // Staff: their classes this session (the class teacher one starred)
  const [staffClasses, setStaffClasses] = useState("");
  useEffect(() => {
    if (mode !== "employees" || !person.email || !sessionId || !isAdmin) return;
    let live = true;
    listAssignments(schoolId).then(
      (rows) => {
        if (!live) return;
        const mine = rows.filter((r) => r.session_id === sessionId && r.email === String(person.email).toLowerCase());
        setStaffClasses(mine.map((r) => `${r.is_class_teacher ? "★ " : ""}${gradeLabel(r.class)}${r.section ? ` · ${r.section}` : ""}`).join(", "));
      },
      () => {}
    );
    return () => {
      live = false;
    };
  }, [mode, person.email, sessionId, schoolId, isAdmin]);
  const shown = mode === "employees" ? { ...person, classes_text: staffClasses } : person;
  const groups = GROUPS[mode]
    .map(([title, rows]) => [
      title,
      rows
        .filter(([, , , only]) => (only !== "admin" || isAdmin) && (only !== "staff" || !isAdmin))
        .map(([label, get, wide]) => [label, get(shown, routes), wide])
        .filter(([, v]) => v),
    ])
    .filter(([, rows]) => rows.length);
  const callNo = person.parent_phone || person.father_phone || person.mother_phone || person.phone;
  const tabs = [
    ["details", "Details"],
    ...(isAdmin ? [["fees", "Fees"]] : []),
    // On the full page, Messages is a button beside Call instead
    ...(asPage ? [] : [["messages", "Messages"]]),
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
          school={school}
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
            onDelete={isOwner && onDeleted ? () => setDeleting(true) : null}
            onUpdate={onUpdate}
            onTab={setTab}
          />
        ) : (
        <header className="ig-hero staff-hero">
          <div className="ig-top">
            <EditablePhoto person={person} kind={mode} schoolId={schoolId} canWrite={canWrite} onSaved={(patch) => onUpdate(person.id, patch)} />
            <div className="ig-head">
              <div>
                {/* Account status, on top */}
                <span className={`staff-status is-${person.status || "active"}`}>{{ active: "Active", inactive: "Inactive", left: "Left" }[person.status || "active"]}</span>
                <h2 className="ig-name">{person.name}</h2>
                <p className="ig-id">{[person.ref_no, person.designation, person.department].filter(Boolean).join(" · ")}</p>
              </div>
              {!editing && (
                <div className="ig-actions">
                  {callNo && (
                    <a className="ig-act" href={`tel:${callNo}`} aria-label="Call" title="Call">
                      <Icon name="phone" size={18} />
                    </a>
                  )}
                  {callNo && (
                    <a className="ig-act" href={`https://wa.me/91${digits(callNo)}`} target="_blank" rel="noreferrer" aria-label="WhatsApp" title="WhatsApp">
                      <WhatsAppLogo size={26} />
                    </a>
                  )}
                  {canEdit && (
                    <button className="ig-act" onClick={() => setEditing(true)} aria-label="Edit details" title="Edit details">
                      <Icon name="edit" size={18} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          <button className="btn-icon profile-close staff-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </header>
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
            <Chat
              screen
              studentId={person.id}
              viewer="staff"
              me={me}
              canSend={canWrite}
              canAnswer={canWrite}
              headOnPhone
              head={
                <>
                  <button className="btn-icon chat-back" onClick={closeChat} aria-label="Back to the student">
                    <Icon name="arrowLeft" size={20} />
                  </button>
                  <span className="inbox-who">
                    <Photo person={person} className="inbox-photo" />
                    <span className="inbox-main">
                      <strong>{person.name}</strong>
                      <span className="row-sub">
                        {person.class ? gradeLabel(person.class) : ""}
                        {person.section ? ` · ${person.section}` : ""}
                      </span>
                    </span>
                  </span>
                </>
              }
            />
          ) : isStudent && !editing && tab === "results" ? (
            <StudentResults person={person} sessionId={sessionId} me={me} isAdmin={isAdmin} canWrite={canWrite} autoFocus={initialTab === "results"} />
          ) : editing ? (
            <ProfileEdit
              person={person}
              kind={mode}
              sessionId={sessionId}
              routes={routes}
              onCancel={() => setEditing(false)}
              onDelete={isOwner && onDeleted ? () => setDeleting(true) : undefined}
              onSaved={(changes) => {
                onUpdate(person.id, changes);
                setEditing(false);
              }}
            />
          ) : (
            <div className="profile-groups">
              {isStudent && <MonthAttendance studentId={person.id} />}
              {groups.length === 0 && <p className="row-sub">No details recorded yet.</p>}
              {/* One card per group (Family, Personal, School…): each fact
                  with its icon, its value, and what it is underneath */}
              {groups.map(([title, rows]) => (
                <section key={title} className={`profile-group profile-facts g-${title.toLowerCase()}`}>
                  <h3 className="facts-title">{title}</h3>
                  <ul className="facts">
                    {rows.map(([label, value, wide]) => (
                      <li key={label} className={wide ? "is-wide" : ""}>
                        <span className="fact-icon" aria-hidden="true">
                          <Icon name={FACT_ICON[label] ?? "note"} size={18} />
                        </span>
                        <span className="fact-text">
                          <span className="fact-value">{value}</span>
                          <span className="fact-label">{label}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {isStudent && <StudentClass person={person} sessionId={sessionId} students={students} onOpenStudent={onOpenStudent} />}
              {isStudent && isAdmin && (
                <section className="profile-group profile-facts g-parents">
                  <StudentParents person={person} canEdit={canEdit} />
                </section>
              )}
            </div>
          )}
        </div>
      </section>
  );

  const del = deleting && (
    <DeletePerson
      person={person}
      kind={mode}
      sessionId={sessionId}
      onClose={() => setDeleting(false)}
      onDeleted={(id) => {
        setDeleting(false);
        onDeleted(id);
      }}
      onLeft={(changes) => {
        setDeleting(false);
        setEditing(false);
        onUpdate(person.id, changes);
      }}
    />
  );

  if (!asPage) {
    return (
      <>
        <div className="modal-backdrop" onClick={() => !editing && onClose()}>
          {card}
        </div>
        {del}
      </>
    );
  }
  return (
    <div className="profile-page">
      {del}
      <nav className="profile-page-bar" aria-label="Student">
        <button className="back-btn" onClick={onClose} aria-label="Back to students" title="Back">
          <Icon name="chevronLeft" size={22} />
        </button>
      </nav>
      {card}
    </div>
  );
}

// The student's class (see ClassCard). Classmates come from the
// session's students already loaded; teachers from the class's assignments.
function StudentClass({ person, sessionId, students, onOpenStudent }) {
  const teachers = useClassTeachers(person.id, sessionId);

  if (!person.class) return null;
  const mates = students
    .filter((p) => p.id !== person.id && p.class === person.class && (p.section ?? "") === (person.section ?? "") && p.status !== "left")
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <ClassCard
      title={`${gradeLabel(person.class)}${person.section ? ` ${person.section}` : ""}`}
      teachers={teachers}
      mates={mates}
      onOpenMate={onOpenStudent}
    />
  );
}

// Premium: the AI's line on this student's results, if it wrote one.
function StudentHint({ school, isAdmin, id }) {
  const ins = useInsights(school, "results", isAdmin && Boolean(school));
  return <Hint ins={ins} slot="student" target={id} className="ai-hint-block" />;
}
