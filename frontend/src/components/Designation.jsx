import { useState } from "react";

// Designation, picked from a short list (signup and My profile). Other
// lets them type theirs; left empty, it's saved as "Other".
export const DESIGNATIONS = ["Admin", "Principal", "Teacher", "Other"];

// The role the owner most likely wants for a designation (approval).
export const roleFor = (designation = "") => (/admin/i.test(designation) ? "admin" : /principal/i.test(designation) ? "principal" : "teacher");

export default function DesignationField({ value, onChange, autoFocus = false }) {
  const listed = DESIGNATIONS.slice(0, 3).includes(value);
  const [other, setOther] = useState(!listed && Boolean(value));
  const pick = other ? "Other" : listed ? value : "";
  return (
    <>
      <label>
        <span>Designation *</span>
        <select
          className="select"
          value={pick}
          required
          autoFocus={autoFocus}
          onChange={(e) => {
            const v = e.target.value;
            setOther(v === "Other");
            onChange(v);
          }}
        >
          <option value="" disabled>
            Pick one
          </option>
          {DESIGNATIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      {other && (
        <label>
          <span>Your designation</span>
          <input value={value === "Other" ? "" : value} onChange={(e) => onChange(e.target.value.trim() ? e.target.value : "Other")} maxLength={80} placeholder="e.g. Accountant, Librarian" />
        </label>
      )}
    </>
  );
}
