import { useState } from "react";
import Icon from "./Icon.jsx";

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
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave(form);
      onClose();
    } catch {
      setError("Couldn’t save. Check your connection and that you have access, then try again.");
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-header">
          <h2>Add {mode === "students" ? "student" : "employee"}</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body">
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
        {error && <p className="field-error">{error}</p>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
