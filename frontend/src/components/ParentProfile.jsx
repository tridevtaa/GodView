import { useEffect, useRef, useState } from "react";
import { loadMyGuardian, saveMyGuardian, saveMyGuardianPhoto } from "../data/profile.js";
import { Photo, gradeLabel } from "./PersonCard.jsx";
import { idText } from "./Designation.jsx";
import Icon from "./Icon.jsx";
import { haptic } from "../pwa/haptics.js";

const RELATION = { father: "Father", mother: "Mother", guardian: "Guardian" };
const showPhone = (p = "") => p.replace(/^\+91(\d{5})(\d{5})$/, "+91 $1 $2");

// A parent's own profile (from the name at the top of their menu): Parent
// ID, photo, name, phone, email, Aadhaar or PAN (last 4), address, and the
// children linked to them with how they're related.
// family: the children the app already loaded (photos, classes).
export default function ParentProfile({ family = [], onOpenChild }) {
  const [me, setMe] = useState(undefined); // undefined: loading, null: none
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadMyGuardian().then(setMe, () => {
      setMe(null);
      setError("Couldn’t load your profile. Check your connection and try again.");
    });
  }, []);

  if (me === undefined) return <div className="pa-card pa-skeleton" aria-busy="true" />;
  if (!me) return <p className="notice notice-error">{error || "No profile found for this number."}</p>;

  const facts = [
    ["Parent ID", me.ref_no, "idcard"],
    ["Contact number", showPhone(me.phone), "phone"],
    ["Email", me.email, "mail"],
    ["Aadhaar / PAN", me.id_last4 && idText(me.id_type, me.id_last4), "idcard"],
    ["Address", me.address, "pin"],
  ];
  const byId = new Map(family.map((c) => [c.id, c]));

  return (
    <div className="pa-profile-page">
      <section className="profile-page pa-profile">
        <header className="ig-hero">
          <div className="ig-top">
            <GuardianPhoto me={me} onSaved={(p) => setMe((m) => ({ ...m, ...p }))} />
            <div className="ig-head">
              <div>
                <h1 className="ig-name">{me.name || "Your name"}</h1>
                <p className="ig-id">{[me.ref_no, "Parent"].filter(Boolean).join(" · ")}</p>
              </div>
            </div>
          </div>
        </header>
      </section>

      {editing ? (
        <EditGuardian
          me={me}
          onCancel={() => setEditing(false)}
          onSaved={(f) => {
            setMe((m) => ({ ...m, name: f.name.trim() || m.name, email: f.email.trim().toLowerCase() || null, id_type: f.idLast4 ? f.idType : null, id_last4: f.idLast4 || null, address: f.address.trim() || null }));
            setEditing(false);
          }}
        />
      ) : (
        <section className="pa-card my-profile-form">
          <div className="my-profile-head">
            <h2 className="pa-h2">Your details</h2>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
              <Icon name="edit" /> Edit
            </button>
          </div>
          <ul className="facts pa-facts">
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

      {!editing && me.children.length > 0 && (
        <section className="pa-card">
          <h2 className="pa-h2">Your children</h2>
          <ul className="pa-list">
            {me.children.map((c) => {
              const kid = byId.get(c.id) ?? c;
              return (
                <li key={c.id} className="pa-row">
                  <Photo person={kid} className="inbox-photo" />
                  <span className="pa-row-main">
                    <strong>{kid.name}</strong>
                    <span className="row-sub">
                      {[`${RELATION[c.relation] ?? "Guardian"}`, kid.class && `${gradeLabel(kid.class)}${kid.section ? ` · ${kid.section}` : ""}`, c.admission_no && `#${c.admission_no}`].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {byId.has(c.id) && onOpenChild && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpenChild(c.id)}>
                      Open
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function EditGuardian({ me, onCancel, onSaved }) {
  const [form, setForm] = useState({ name: me.name || "", email: me.email || "", idType: me.id_type || "aadhaar", idLast4: me.id_last4 || "", address: me.address || "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const last4 = form.idLast4.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const idOk = !last4 || last4.length === 4;

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const f = { ...form, idLast4: last4 };
      await saveMyGuardian(f);
      haptic("success");
      onSaved(f);
    } catch {
      setError("Couldn’t save. Check your connection and try again.");
      setSaving(false);
    }
  }

  return (
    <form className="pa-card my-profile-form" onSubmit={save}>
      <h2 className="pa-h2">Your details</h2>
      <label>
        <span>Full name</span>
        <input value={form.name} onChange={set("name")} maxLength={120} autoComplete="name" autoFocus />
      </label>
      <label>
        <span>Email</span>
        <input type="email" value={form.email} onChange={set("email")} maxLength={200} autoComplete="email" />
      </label>
      <div className="my-profile-pair">
        <label>
          <span>ID</span>
          <select value={form.idType} onChange={set("idType")}>
            <option value="aadhaar">Aadhaar</option>
            <option value="pan">PAN</option>
          </select>
        </label>
        <label>
          <span>Last 4 only</span>
          <input value={form.idLast4} onChange={set("idLast4")} maxLength={4} placeholder="1234" autoCapitalize="characters" />
        </label>
      </div>
      <label>
        <span>Address</span>
        <input value={form.address} onChange={set("address")} maxLength={300} autoComplete="street-address" />
      </label>
      {!idOk && <p className="field-error">Enter the last 4 characters of the ID.</p>}
      {error && <p className="field-error">{error}</p>}
      <div className="my-profile-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={saving || !idOk}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function GuardianPhoto({ me, onSaved }) {
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
      onSaved(await saveMyGuardianPhoto(me, file));
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
        <Photo person={{ ...me, name: me.name || "Parent" }} className="ig-photo-img" />
        <span className="ig-photo-hint" aria-hidden="true">
          {busy ? <span className="spinner" /> : <Icon name="camera" size={22} />}
        </span>
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={onFile} />
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
