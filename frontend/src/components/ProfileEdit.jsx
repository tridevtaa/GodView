import { useState } from "react";
import { updateEmployee, updateStudent } from "../data/api.js";
import PlacePicker from "./PlacePicker.jsx";
import TransportPicker from "./TransportPicker.jsx";
import Icon from "./Icon.jsx";

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
    ]],
    ["Family", [
      ["parent_name", "Father", "text"],
      ["mother_name", "Mother", "text"],
      ["parent_phone", "Parent phone", "tel"],
      ["father_phone", "Father phone", "tel"],
      ["mother_phone", "Mother phone", "tel"],
      ["email", "Email", "email"],
    ]],
    ["Admission", [
      ["admission_date", "Admission date", "date"],
      ["admission_type", "Admission type", ["", "New", "Old"]],
      ["admission_category", "Admission category", "text"],
      ["category", "Category", "text"],
      ["religion", "Religion", "text"],
      ["srn", "SRN", "text"],
      ["aadhaar", "Aadhaar (last 4 digits)", "text"],
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
const GENDER_LABEL = { "": "Not set", F: "Female", M: "Male" };
const optionLabel = (key, opt) =>
  key === "status" ? STATUS_LABEL[opt] : key === "gender" ? GENDER_LABEL[opt] : opt || "Not set";

export default function ProfileEdit({ person, kind, sessionId, onSaved, onCancel, routes = [] }) {
  const fields = FIELDS[kind].flatMap(([, list]) => list);
  const initial = Object.fromEntries(
    fields.map(([key]) => [key, String(person[key] ?? (key === "status" ? "active" : ""))])
  );
  const [form, setForm] = useState(initial);
  // Home pin and transport (students), edited with the map search and route picker.
  const startHome =
    person.home_lat != null || person.address
      ? { address: [person.address, person.city, person.state].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", "), lat: person.home_lat ?? null, lng: person.home_lng ?? null, place_id: person.home_place_id ?? null }
      : null;
  const [home, setHome] = useState(startHome);
  const [transport, setTransport] = useState({ uses_bus: Boolean(person.uses_bus), bus_stop_id: person.bus_stop_id ?? null });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const changes = Object.fromEntries(
    Object.entries(form)
      .map(([k, v]) => [k, v.trim()])
      .filter(([k, v]) => v !== initial[k].trim())
  );
  if (kind === "students") {
    if (JSON.stringify(home) !== JSON.stringify(startHome)) {
      Object.assign(changes, {
        address: home?.address ?? "",
        city: home?.city ?? (home ? person.city ?? "" : ""),
        state: home?.state ?? (home ? person.state ?? "" : ""),
        home_lat: home?.lat ?? null,
        home_lng: home?.lng ?? null,
        home_place_id: home?.place_id ?? null,
      });
      // A picked place carries the full address; don't repeat city and state.
      if (home?.place_id) Object.assign(changes, { city: home.city ?? "", state: home.state ?? "" });
    }
    if (transport.uses_bus !== Boolean(person.uses_bus) || (transport.bus_stop_id ?? null) !== (person.bus_stop_id ?? null)) {
      const route = routes.find((r) => r.stops.some((s) => s.id === transport.bus_stop_id));
      Object.assign(changes, {
        uses_bus: transport.uses_bus,
        bus_stop_id: transport.uses_bus ? transport.bus_stop_id ?? null : null,
        transport_route: transport.uses_bus ? route?.name ?? person.transport_route ?? "" : "",
        pickup_point: transport.uses_bus ? route?.stops.find((s) => s.id === transport.bus_stop_id)?.name ?? person.pickup_point ?? "" : "",
      });
    }
  }
  const dirty = Object.keys(changes).length > 0;

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const saved =
        kind === "students" ? await updateStudent(person, sessionId, changes) : await updateEmployee(person, changes);
      onSaved(saved);
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
      {kind === "students" && (
        <fieldset>
          <legend>Home & transport</legend>
          <div className="ns-sections">
            <section>
              <h3>
                <Icon name="pin" />
                Home
              </h3>
              <PlacePicker value={home} onChange={setHome} label="Home location" />
            </section>
            <section>
              <h3>
                <Icon name="bus" />
                Transport
              </h3>
              {person.transport_route && !person.bus_stop_id && (
                <p className="row-sub">
                  From the ERP: {[person.transport_route, person.pickup_point].filter(Boolean).join(" · ")}
                </p>
              )}
              <TransportPicker routes={routes} value={transport} onChange={setTransport} />
            </section>
          </div>
        </fieldset>
      )}
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
