import { useState } from "react";

const FIELDS = {
  students: [
    ["name", "Full name", "text"],
    ["gender", "Gender", ["F", "M"]],
    ["parent_name", "Parent name", "text"],
    ["class", "Grade", "text"],
    ["section", "Section", "text"],
    ["admission_no", "Admission no.", "text"],
    ["parent_phone", "Parent phone", "tel"],
    ["fee_status", "Fee status", ["paid", "due", "overdue"]],
    ["photo_url", "Photo URL (optional)", "url"],
  ],
  employees: [
    ["name", "Full name", "text"],
    ["designation", "Designation", "text"],
    ["department", "Department", "text"],
    ["employee_no", "Employee no.", "text"],
    ["phone", "Phone", "tel"],
    ["email", "Email", "email"],
    ["photo_url", "Photo URL (optional)", "url"],
  ],
};

const OPTIONAL = new Set(["photo_url", "parent_phone", "phone", "email"]);

export default function AddModal({ mode, onClose, onSave }) {
  const fields = FIELDS[mode];
  const [form, setForm] = useState(() =>
    Object.fromEntries(fields.map(([key, , type]) => [key, Array.isArray(type) ? type[0] : ""]))
  );
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    await onSave(form);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Add {mode === "students" ? "Student" : "Employee"}</h2>
        <div className="form-grid">
          {fields.map(([key, label, type]) => (
            <label key={key}>
              <span>{label}</span>
              {Array.isArray(type) ? (
                <select value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}>
                  {type.map((opt) => (
                    <option key={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={type}
                  required={!OPTIONAL.has(key)}
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              )}
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-add" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
