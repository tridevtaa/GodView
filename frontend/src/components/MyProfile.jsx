import { useEffect, useRef, useState } from "react";
import { listGrades, requestClassAllocation } from "../data/api.js";
import { loadMyProfile, saveMyPhoto, saveMyProfile } from "../data/profile.js";
import { Photo, gradeLabel } from "./PersonCard.jsx";
import DesignationField from "./Designation.jsx";
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
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadMyProfile(school.id, email, session?.id).then(
      (d) => {
        setData(d);
        setForm({
          fullName: d.member?.full_name || d.staff?.name || googleName || "",
          designation: d.member?.designation || d.staff?.designation || "",
          phone: d.member?.phone || d.staff?.phone || "",
        });
      },
      () => setError("Couldn’t load your profile. Check your connection and try again.")
    );
  }, [school.id, email, session?.id, googleName]);

  if (error) return <p className="notice notice-error">{error}</p>;
  if (!data || !form) return <div className="card card-skeleton" aria-busy="true" />;

  const role = data.member?.role;
  const dirty =
    form.fullName.trim() !== (data.member?.full_name || "") ||
    form.designation !== (data.member?.designation || "") ||
    form.phone.trim() !== (data.member?.phone || "");
  const ok = form.fullName.trim() && form.designation.trim();

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await saveMyProfile(school.id, form);
      haptic("success");
      setData((d) => ({ ...d, member: { ...d.member, full_name: form.fullName.trim(), designation: form.designation, phone: form.phone.trim() } }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Couldn’t save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="profile-page my-profile">
      <nav className="profile-page-bar" aria-label="My profile">
        <button className="back-btn" onClick={onBack} aria-label="Back" title="Back">
          <Icon name="chevronLeft" size={22} />
        </button>
      </nav>

      <header className="ig-hero">
        <div className="ig-top">
          <MyPhoto school={school} staff={data.staff} name={form.fullName || email} onSaved={(p) => setData((d) => ({ ...d, staff: { ...d.staff, ...p } }))} />
          <div className="ig-head">
            <div>
              <h2 className="ig-name">{data.member?.full_name || form.fullName || email}</h2>
              <p className="ig-id">
                {[ROLE[role], data.member?.designation && data.member.designation !== ROLE[role] ? data.member.designation : null, school.name].filter(Boolean).join(" · ")}
              </p>
              <p className="ig-id">{email}</p>
            </div>
          </div>
        </div>
      </header>

      <form className="profile-group profile-facts my-profile-form" onSubmit={save}>
        <h3 className="facts-title">Your details</h3>
        <label>
          <span>Full name *</span>
          <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required maxLength={120} autoComplete="name" />
        </label>
        <DesignationField value={form.designation} onChange={(designation) => setForm({ ...form, designation })} />
        <label>
          <span>Phone</span>
          <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={20} autoComplete="tel" />
        </label>
        <div className="my-profile-actions">
          {saved && (
            <span className="my-profile-saved">
              <Icon name="check" size={14} /> Saved
            </span>
          )}
          <button className="btn btn-primary" disabled={saving || !dirty || !ok}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>

      {role === "teacher" && <MyClasses school={school} session={session} classes={data.classes} request={data.request} />}
    </div>
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
