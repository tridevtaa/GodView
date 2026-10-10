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
  // Students edit in steps (the field groups, then home and bus); employees
  // have one short group.
  const steps = [...FIELDS[kind].map(([title, list]) => ({ title, keys: list.map(([k]) => k) })), ...(kind === "students" ? [{ title: "Home & bus", keys: [] }] : [])];
  const [step, setStep] = useState(0);

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
  const HOME_KEYS = ["address", "home_lat", "uses_bus", "bus_stop_id"];
  const stepChanged = (i) =>
    steps[i].keys.some((k) => k in changes) || (steps[i].title === "Home & bus" && HOME_KEYS.some((k) => k in changes));
  const last = step === steps.length - 1;

  async function save(e) {
    e.preventDefault();
    // Required fields may sit on another step; go there.
    const missing = fields.find(([key, , , required]) => required && !form[key].trim());
    if (missing) {
      setStep(steps.findIndex((st) => st.keys.includes(missing[0])));
      setError(`${missing[1]} is needed.`);
      return;
    }
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

  const group = FIELDS[kind][step];
  return (
    <form className="profile-edit" onSubmit={save}>
      {steps.length > 1 && (
        <nav className="edit-steps" aria-label="Sections">
          {steps.map((st, i) => (
            <button
              type="button"
              key={st.title}
              className={`${i === step ? "is-on" : ""}${i < step ? " is-done" : ""}`}
              aria-current={i === step ? "step" : undefined}
              onClick={() => (setStep(i), setError(""))}
            >
              <span className="edit-step-n">{i + 1}</span>
              <span className="edit-step-label">{st.title}</span>
              {stepChanged(i) && <span className="edit-step-dot" aria-label="changed" />}
            </button>
          ))}
        </nav>
      )}

      {group && (
        <div className="edit-step">
          {kind === "students" && step === 0 && (
            <p className="row-sub edit-note">
              Admission no. <strong>{person.admission_no}</strong> stays fixed. An ERP import overwrites edited fields.
            </p>
          )}
          <div className="form-grid">
            {group[1].map(([key, label, type, required]) => (
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
        </div>
      )}

      {kind === "students" && !group && (
        <div className="edit-step ns-sections">
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
              Bus
            </h3>
            {person.transport_route && !person.bus_stop_id && (
              <p className="row-sub">From the ERP: {[person.transport_route, person.pickup_point].filter(Boolean).join(" · ")}</p>
            )}
            <TransportPicker routes={routes} value={transport} onChange={setTransport} />
          </section>
        </div>
      )}

      {error && <p className="field-error">{error}</p>}
      <div className="modal-footer modal-footer-sticky edit-foot">
        {step === 0 ? (
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={() => (setStep(step - 1), setError(""))} disabled={saving}>
            <Icon name="arrowLeft" /> Back
          </button>
        )}
        <span className="edit-foot-right">
          {!last && (
            <button type="button" className="btn btn-secondary" onClick={() => (setStep(step + 1), setError(""))}>
              Next <Icon name="arrowRight" />
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save"}
          </button>
        </span>
      </div>
    </form>
  );
}
