import { useState } from "react";
import { CONTACT_FIELDS, updateSchoolContact } from "../data/api.js";
import Icon from "./Icon.jsx";
import { StepBar } from "./Steps.jsx";

// [field, label, input attributes]
const FIELDS = {
  phone: ["Phone", { type: "tel", maxLength: 20 }],
  phone_2: ["Other phone", { type: "tel", maxLength: 20, placeholder: "Office, transport…" }],
  email: ["Email", { type: "email", maxLength: 120 }],
  website: ["Website", { type: "url", maxLength: 200, placeholder: "https://" }],
  address: ["Address", { maxLength: 300, wide: true }],
  city: ["City", { maxLength: 80 }],
  state: ["State", { maxLength: 80 }],
  pincode: ["PIN code", { inputMode: "numeric", pattern: "\\d{6}", title: "6 digits", maxLength: 6 }],
  office_hours: ["Office hours", { maxLength: 120, placeholder: "e.g. Mon to Sat, 8 AM to 2 PM", wide: true }],
};
const STEPS = [
  ["Phone & email", ["phone", "phone_2", "email", "website"]],
  ["Address & hours", ["address", "city", "state", "pincode", "office_hours"]],
];

const placeOf = (s) => [s.address, s.city, s.state, s.pincode].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ");
const mapsUrl = (s) =>
  s.lat != null && s.lng != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([s.name, placeOf(s)].filter(Boolean).join(", "))}`;
const webUrl = (w) => (/^https?:\/\//i.test(w) ? w : `https://${w}`);

// School settings (owners and admins): the contact details parents see on
// their Home. A one-line summary until opened, then two short steps.
export function SchoolContactPanel({ school, onSaved }) {
  const initial = Object.fromEntries(CONTACT_FIELDS.map((k) => [k, school[k] ?? ""]));
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(initial);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const changed = (k) => String(form[k] ?? "").trim() !== String(initial[k] ?? "").trim();
  const dirty = CONTACT_FIELDS.some(changed);
  const last = step === STEPS.length - 1;
  const summary = [school.phone, school.email, school.city].filter(Boolean);

  async function save(e) {
    e.preventDefault();
    if (!last && !dirty) return setStep(step + 1);
    setSaving(true);
    setError("");
    try {
      onSaved(await updateSchoolContact(school, form));
      setEditing(false);
    } catch (err) {
      setError(/pincode/.test(err?.message ?? "") ? "The PIN code needs 6 digits." : "Couldn’t save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`panel school-panel${editing ? " is-editing" : ""}`}>
      <div className="school-summary">
        <span className="school-logo">
          <Icon name="phone" size={20} />
        </span>
        <div className="school-id">
          <h2 className="school-name">Contact for parents</h2>
          <p className="row-sub">{summary.length ? summary.join(" · ") : "Add a phone, email and address. Parents see them on their Home."}</p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => (editing ? (setForm(initial), setEditing(false), setError("")) : (setStep(0), setEditing(true)))}>
          {editing ? "Close" : <><Icon name="edit" /> Edit</>}
        </button>
      </div>
      {editing && (
        <form className="school-body school-steps" onSubmit={save}>
          <StepBar steps={STEPS.map(([t]) => t)} step={step} onPick={(i) => (setStep(i), setError(""))} marks={STEPS.map(([, keys]) => keys.some(changed))} />
          <div className="form-grid">
            {STEPS[step][1].map((k) => {
              const [label, { wide, ...attrs }] = FIELDS[k];
              return (
                <label key={k} className={wide ? "span-2" : ""}>
                  <span>{label}</span>
                  <input value={form[k] ?? ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} {...attrs} />
                </label>
              );
            })}
          </div>
          {error && <p className="field-error">{error}</p>}
          <div className="school-actions edit-foot">
            {step === 0 ? (
              <span />
            ) : (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => (setStep(step - 1), setError(""))}>
                <Icon name="arrowLeft" /> Back
              </button>
            )}
            <span className="edit-foot-right">
              {!last && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => (setStep(step + 1), setError(""))}>
                  Next <Icon name="arrowRight" />
                </button>
              )}
              <button className="btn btn-primary btn-sm" disabled={!dirty || saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </span>
          </div>
        </form>
      )}
    </section>
  );
}

// Parents' Home: how to reach the school. Each line is a tap: call, email,
// open the website, or get directions. Nothing shows if nothing is set.
export function SchoolContactCard({ school }) {
  if (!school) return null;
  const place = placeOf(school);
  const rows = [
    school.phone && ["phone", school.phone, "Call", `tel:${school.phone.replace(/\s+/g, "")}`],
    school.phone_2 && ["phone", school.phone_2, "Call", `tel:${school.phone_2.replace(/\s+/g, "")}`],
    school.email && ["mail", school.email, "Email", `mailto:${school.email}`],
    school.website && ["home", school.website.replace(/^https?:\/\//i, "").replace(/\/$/, ""), "Website", webUrl(school.website)],
    place && ["pin", place, "Directions", mapsUrl(school)],
  ].filter(Boolean);
  if (!rows.length && !school.office_hours) return null;
  return (
    <section className="pa-card school-contact">
      <h3 className="pa-h2">Contact {school.short_name || school.name}</h3>
      {school.office_hours && (
        <p className="school-contact-hours">
          <Icon name="calendar" size={15} />
          {school.office_hours}
        </p>
      )}
      <ul className="school-contact-list">
        {rows.map(([icon, text, action, href]) => (
          <li key={`${icon}${text}`}>
            <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
              <span className="school-contact-icon">
                <Icon name={icon} size={18} />
              </span>
              <span className="school-contact-text">{text}</span>
              <span className="school-contact-action">{action}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
