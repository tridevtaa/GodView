import { useEffect, useRef, useState } from "react";
import { listGrades, requestClassAllocation } from "../data/api.js";
import { loadMyProfile, saveMyPhoto, saveMyProfile } from "../data/profile.js";
import { Photo, gradeLabel } from "./PersonCard.jsx";
import DesignationField, { idText } from "./Designation.jsx";
import { StepBar } from "./Steps.jsx";
import ClassPicker from "./ClassPicker.jsx";
import { InChargePicker, gradeOptions, inChargeKey, withInCharge } from "./ClassAllocationGate.jsx";
import Icon from "./Icon.jsx";
import { haptic } from "../pwa/haptics.js";

const ROLE = { owner: "Owner", admin: "Admin", principal: "Principal", teacher: "Teacher" };
const classText = (c) => `${gradeLabel(c.class)}${c.section ? ` · ${c.section}` : ""}`;

// My profile, from the account menu: any staff member's own photo, name,
// designation and phone; teachers also see their classes (and which
// they're class teacher of) and can ask the owner to change them.
export default function MyProfile({ school, session, email, googleName, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    loadMyProfile(school.id, email, session?.id).then(setData, () => setError("Couldn’t load your profile. Check your connection and try again."));
  }, [school.id, email, session?.id]);

  if (error && !data) return <p className="notice notice-error">{error}</p>;
  if (!data) return <div className="card card-skeleton" aria-busy="true" />;

  const { member, staff } = data;
  const role = member?.role;
  const isTeacher = role === "teacher";
  const name = member?.full_name || staff?.name || googleName || email;
  const status = staff?.status || "active";
  // Admin profile: ID, designation, contact, school, ID proof, emergency,
  // joining. Teacher profile adds subjects and qualification (their
  // classes are just below).
  const facts = [
    [isTeacher ? "Teacher ID" : "Admin ID", staff?.ref_no, "idcard"],
    ["Role", [ROLE[role], member?.designation && member.designation !== ROLE[role] ? member.designation : null].filter(Boolean).join(" · "), "teacher"],
    ["Email", email, "mail"],
    ["Contact number", member?.phone || staff?.phone, "phone"],
    !isTeacher && ["School", school.name, "home"],
    isTeacher && ["Subjects", staff?.subjects, "book"],
    isTeacher && ["Qualification", staff?.qualification, "academics"],
    ["Aadhaar / PAN", staff?.id_last4 && idText(staff.id_type, staff.id_last4), "idcard"],
    ["Emergency contact", [staff?.emergency_name, staff?.emergency_phone].filter(Boolean).join(" · "), "phone"],
    ["Joined", staff?.joining_date && new Date(staff.joining_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }), "register"],
  ].filter(Boolean);

  return (
    <div className="profile-page my-profile">
      <nav className="profile-page-bar" aria-label="My profile">
        <button className="back-btn" onClick={onBack} aria-label="Back" title="Back">
          <Icon name="chevronLeft" size={22} />
        </button>
      </nav>

      <header className="ig-hero">
        <div className="ig-top">
          <MyPhoto school={school} staff={staff} name={name} onSaved={(p) => setData((d) => ({ ...d, staff: { ...d.staff, ...p } }))} />
          <div className="ig-head">
            <div>
              {staff && <span className={`staff-status is-${status}`}>{{ active: "Active", inactive: "Inactive", left: "Left" }[status]}</span>}
              <h2 className="ig-name">{name}</h2>
              <p className="ig-id">{[staff?.ref_no, ROLE[role], school.name].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
        </div>
      </header>

      {editing ? (
        <EditMyProfile
          school={school}
          data={data}
          isTeacher={isTeacher}
          googleName={googleName}
          onCancel={() => setEditing(false)}
          onSaved={(f) => {
            setData((d) => ({
              ...d,
              member: { ...d.member, full_name: f.fullName.trim(), designation: f.designation, phone: f.phone.trim() },
              staff: d.staff && {
                ...d.staff,
                name: f.fullName.trim(),
                designation: f.designation,
                phone: f.phone.trim(),
                id_type: f.idLast4.trim() ? f.idType : null,
                id_last4: f.idLast4.trim().toUpperCase().slice(-4) || null,
                emergency_name: f.emergencyName.trim() || null,
                emergency_phone: f.emergencyPhone.trim() || null,
                qualification: f.qualification.trim() || null,
                subjects: f.subjects.trim() || null,
              },
            }));
            setEditing(false);
          }}
        />
      ) : (
        <section className="profile-group profile-facts my-profile-form">
          <div className="my-profile-head">
            <h3 className="facts-title">Your details</h3>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
              <Icon name="edit" /> Edit
            </button>
          </div>
          <ul className="facts">
            {facts.map(([label, value, icon]) => (
              <li key={label}>
                <span className="fact-icon" aria-hidden="true">
                  <Icon name={icon} size={18} />
                </span>
                <span className="fact-text">
                  <span className={`fact-value${value ? "" : " is-empty"}`}>{value || "Not added"}</span>
                  <span className="fact-label">{label}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isTeacher && !editing && <MyClasses school={school} session={session} classes={data.classes} request={data.request} />}
    </div>
  );
}

// Editing their details, in short steps: the basics, then ID and an
// emergency contact, then (teachers) what they teach.
function EditMyProfile({ school, data, isTeacher, googleName, onCancel, onSaved }) {
  const { member, staff } = data;
  const [form, setForm] = useState({
    fullName: member?.full_name || staff?.name || googleName || "",
    designation: member?.designation || staff?.designation || "",
    phone: member?.phone || staff?.phone || "",
    idType: staff?.id_type || "aadhaar",
    idLast4: staff?.id_last4 || "",
    emergencyName: staff?.emergency_name || "",
    emergencyPhone: staff?.emergency_phone || "",
    qualification: staff?.qualification || "",
    subjects: staff?.subjects || "",
  });
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const steps = ["Basics", "ID & emergency", ...(isTeacher ? ["Teaching"] : [])];
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const last4 = form.idLast4.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const basicsOk = form.fullName.trim() && form.designation.trim();
  const idOk = !last4 || last4.length === 4;

  async function save(e) {
    e.preventDefault();
    if (step < steps.length - 1) return setStep(step + 1);
    setSaving(true);
    setError("");
    try {
      const f = { ...form, idLast4: last4 };
      await saveMyProfile(school.id, f);
      haptic("success");
      onSaved(f);
    } catch (err) {
      setError(/last 4/i.test(err?.message ?? "") ? "Enter only the last 4 characters of the ID." : "Couldn’t save. Check your connection and try again.");
      setSaving(false);
    }
  }

  return (
    <form className="profile-group profile-facts my-profile-form" onSubmit={save}>
      <StepBar steps={steps} step={step} onPick={setStep} canPick={() => basicsOk} />
      {step === 0 && (
        <>
          <label>
            <span>Full name *</span>
            <input value={form.fullName} onChange={set("fullName")} required maxLength={120} autoComplete="name" autoFocus />
          </label>
          <DesignationField value={form.designation} onChange={(designation) => setForm({ ...form, designation })} />
          <label>
            <span>Contact number</span>
            <input type="tel" value={form.phone} onChange={set("phone")} maxLength={20} autoComplete="tel" />
          </label>
        </>
      )}
      {step === 1 && (
        <>
          {!staff && <p className="row-sub">Your ID and emergency contact are kept on your staff record, which the owner hasn’t set up yet.</p>}
          <div className="my-profile-pair">
            <label>
              <span>ID</span>
              <select value={form.idType} onChange={set("idType")} disabled={!staff}>
                <option value="aadhaar">Aadhaar</option>
                <option value="pan">PAN</option>
              </select>
            </label>
            <label>
              <span>Last 4 only</span>
              <input value={form.idLast4} onChange={set("idLast4")} maxLength={4} placeholder="1234" autoCapitalize="characters" disabled={!staff} />
            </label>
          </div>
          <label>
            <span>Emergency contact name</span>
            <input value={form.emergencyName} onChange={set("emergencyName")} maxLength={120} placeholder="e.g. Sunita (wife)" disabled={!staff} />
          </label>
          <label>
            <span>Emergency contact number</span>
            <input type="tel" value={form.emergencyPhone} onChange={set("emergencyPhone")} maxLength={20} disabled={!staff} />
          </label>
          {!idOk && <p className="field-error">Enter the last 4 characters of the ID.</p>}
        </>
      )}
      {step === 2 && (
        <>
          <label>
            <span>Subjects</span>
            <input value={form.subjects} onChange={set("subjects")} maxLength={200} placeholder="e.g. Maths, EVS" autoFocus />
          </label>
          <label>
            <span>Qualification</span>
            <input value={form.qualification} onChange={set("qualification")} maxLength={200} placeholder="e.g. M.Sc. Maths, B.Ed." />
          </label>
        </>
      )}
      {error && <p className="field-error">{error}</p>}
      <div className="my-profile-actions">
        <button type="button" className="btn btn-secondary" onClick={() => (step ? setStep(step - 1) : onCancel())} disabled={saving}>
          {step ? "Back" : "Cancel"}
        </button>
        <button className="btn btn-primary" disabled={saving || !basicsOk || !idOk}>
          {saving ? "Saving…" : step < steps.length - 1 ? "Next" : "Save"}
        </button>
      </div>
    </form>
  );
}

// Their photo: tap to change it (staff with a staff record).
function MyPhoto({ school, staff, name, onSaved }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const person = { ...(staff ?? {}), name };
  if (!staff) {
    return (
      <div className="ig-photo">
        <Photo person={person} className="ig-photo-img" />
      </div>
    );
  }
  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      onSaved(await saveMyPhoto(school.id, staff, file));
      haptic("success");
    } catch (err) {
      setError(err.message === "not-an-image" ? "Choose an image." : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ig-photo-wrap">
      <button type="button" className={`ig-photo is-editable${busy ? " is-busy" : ""}`} onClick={() => input.current.click()} disabled={busy} title="Change photo" aria-label="Change photo">
        <Photo person={person} className="ig-photo-img" />
        <span className="ig-photo-hint" aria-hidden="true">
          {busy ? <span className="spinner" /> : <Icon name="camera" size={22} />}
        </span>
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={onFile} />
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

// Teachers: their classes this session (star: class teacher), and asking
// the owner to change them (the same request as when they joined).
function MyClasses({ school, session, classes, request: initialRequest }) {
  const [request, setRequest] = useState(initialRequest);
  const [editing, setEditing] = useState(false);
  const [options, setOptions] = useState([]);
  const [picked, setPicked] = useState([]);
  const [inCharge, setInCharge] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = request?.status === "pending";

  function start() {
    const mine = classes.map((c) => ({ class: c.class, section: c.section ?? "", in_charge: c.is_class_teacher }));
    setPicked(mine);
    setInCharge(inChargeKey(mine));
    setEditing(true);
    listGrades(school.id).then((g) => setOptions(gradeOptions(g)), () => {});
  }

  async function send() {
    setBusy(true);
    setError("");
    try {
      const sent = withInCharge(picked, inCharge);
      await requestClassAllocation(school.id, sent, "", "");
      haptic("success");
      setRequest({ status: "pending", classes: sent });
      setEditing(false);
    } catch (err) {
      setError(/pick at least one/i.test(err?.message ?? "") ? "Pick at least one class." : "Couldn’t send that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="profile-group profile-facts my-profile-form">
      <h3 className="facts-title">Your classes{session?.name ? ` · ${session.name}` : ""}</h3>
      {classes.length ? (
        <div className="my-classes">
          {classes.map((c) => (
            <span key={c.id} className={`chip${c.is_class_teacher ? " chip-ct" : ""}`}>
              {c.is_class_teacher && "★ "}
              {classText(c)}
              {c.is_class_teacher && <span className="chip-ct-label">Class teacher</span>}
            </span>
          ))}
        </div>
      ) : (
        <p className="row-sub">No classes yet this session.</p>
      )}

      {pending && !editing && (
        <p className="callout">
          Waiting for the owner to approve: {request.classes.map((c) => `${classText(c)}${c.in_charge ? " (class teacher)" : ""}`).join(", ")}
        </p>
      )}

      {editing ? (
        <>
          <ClassPicker options={options} value={picked} onChange={setPicked} />
          <InChargePicker classes={picked} value={picked.some((c) => `${c.class}|${c.section ?? ""}` === inCharge) ? inCharge : ""} onChange={setInCharge} />
          {error && <p className="field-error">{error}</p>}
          <div className="my-profile-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={send} disabled={busy || !picked.length}>
              {busy ? "Sending…" : "Send to the owner"}
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="btn btn-secondary my-classes-change" onClick={start}>
          <Icon name="edit" /> {pending ? "Change request" : "Ask for changes"}
        </button>
      )}
    </section>
  );
}
