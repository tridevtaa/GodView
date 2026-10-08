import { useState } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "../firebase.js";

// [field, label, input type or option list, required]
const FIELDS = {
  students: [
    ["Student", [
      ["name", "Full name", "text", true],
      ["gender", "Gender", ["", "F", "M"]],
      ["dob", "Date of birth", "date"],
      ["status", "Status", ["active", "inactive", "left"]],
      ["remarks", "Remarks", "text"],
    ]],
    ["Class", [
      ["class", "Grade", "text", true],
      ["section", "Section", "text"],
      ["stream", "Stream", "text"],
      ["roll_no", "Roll no.", "text"],
      ["session", "Session", "text"],
    ]],
    ["Family", [
      ["parent_name", "Father", "text"],
      ["mother_name", "Mother", "text"],
      ["parent_phone", "Parent phone", "tel"],
      ["father_phone", "Father phone", "tel"],
      ["mother_phone", "Mother phone", "tel"],
      ["email", "Email", "email"],
    ]],
    ["Address & transport", [
      ["address", "Address", "text"],
      ["city", "City", "text"],
      ["state", "State", "text"],
      ["pickup_point", "Pick-up point", "text"],
      ["transport_route", "Bus route", "text"],
    ]],
    ["Admission", [
      ["admission_date", "Admission date", "date"],
      ["admission_type", "Admission type", ["", "New", "Old"]],
      ["admission_category", "Admission category", "text"],
      ["category", "Category", "text"],
      ["religion", "Religion", "text"],
      ["srn", "SRN", "text"],
      ["aadhaar", "Aadhaar", "text"],
    ]],
  ],
  employees: [
    ["Employee", [
      ["name", "Full name", "text", true],
      ["employee_no", "Employee no.", "text"],
      ["designation", "Designation", "text"],
      ["department", "Department", "text"],
      ["phone", "Phone", "tel"],
      ["email", "Email", "email"],
      ["joining_date", "Joined", "date"],
    ]],
  ],
};

const STATUS_LABEL = { active: "Active", inactive: "Inactive", left: "Left (hidden)" };
const GENDER_LABEL = { "": "—", F: "Female", M: "Male" };
const optionLabel = (key, opt) =>
  key === "status" ? STATUS_LABEL[opt] : key === "gender" ? GENDER_LABEL[opt] : opt || "—";

export default function ProfileEdit({ person, kind, onSaved, onCancel }) {
  const fields = FIELDS[kind].flatMap(([, list]) => list);
  const initial = Object.fromEntries(
    fields.map(([key]) => [key, String(person[key] ?? (key === "status" ? "active" : ""))])
  );
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const changes = Object.fromEntries(
    Object.entries(form)
      .map(([k, v]) => [k, v.trim()])
      .filter(([k, v]) => v !== initial[k].trim())
  );
  const dirty = Object.keys(changes).length > 0;

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const extra = changes.status === "left" ? { left_as_of: new Date().toISOString().slice(0, 10) } : {};
      await updateDoc(doc(db, kind, person.id), {
        ...changes,
        ...extra,
        updated_at: serverTimestamp(),
        updated_by: auth.currentUser?.email ?? "",
      });
      onSaved({ ...changes, ...extra });
    } catch {
      setError("Couldn’t save. Check your connection and that you have access, then try again.");
      setSaving(false);
    }
  }

  return (
    <form className="profile-edit" onSubmit={save}>
      {kind === "students" && (
        <p className="callout callout-neutral">
          Admission no. <strong>{person.admission_no}</strong> can’t be changed here. A later import from the ERP
          will overwrite edited fields with the ERP’s values.
        </p>
      )}
      {FIELDS[kind].map(([section, list]) => (
        <fieldset key={section}>
          <legend>{section}</legend>
          <div className="form-grid">
            {list.map(([key, label, type, required]) => (
              <label key={key}>
                <span>{label}</span>
                {Array.isArray(type) ? (
                  <select value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}>
                    {(type.includes(form[key]) ? type : [form[key], ...type]).map((opt) => (
                      <option key={opt} value={opt}>{optionLabel(key, opt)}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={type}
                    required={required}
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  />
                )}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {error && <p className="field-error">{error}</p>}
      <div className="modal-footer modal-footer-sticky">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
