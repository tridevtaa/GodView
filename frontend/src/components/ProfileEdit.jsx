import { useEffect, useState } from "react";
import { listPlans, setStudentFeePlan, studentFeePlan, updateEmployee, updateStudent } from "../data/api.js";
import PlacePicker from "./PlacePicker.jsx";
import TransportPicker from "./TransportPicker.jsx";
import Icon from "./Icon.jsx";
import { StepBar } from "./Steps.jsx";
import { haptic } from "../pwa/haptics.js";

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
    ["Admission & fees", [
      ["admission_date", "Admission date", "date"],
      ["admission_type", "Admission type", ["", "New", "Old"]],
      ["admission_category", "Admission category", "text"],
      ["category", "Category", "text"],
      ["religion", "Religion", "text"],
      ["srn", "House", "text"],
      ["aadhaar", "Aadhaar (last 4 digits)", "text"],
    ]],
  ],
  employees: [
    ["Employee", [
      ["name", "Full name", "text", true],
      ["designation", "Designation", "text"],
      ["department", "Department", "text"],
      ["phone", "Phone", "tel"],
      ["email", "Email", "email"],
      ["dob", "Date of birth", "date"],
    ]],
    ["Work", [
      ["joining_date", "Joined", "date"],
      ["employee_no", "School's own staff no.", "text"],
      ["qualification", "Qualification", "text"],
      ["subjects", "Subjects", "text"],
      ["status", "Status", ["active", "inactive", "left"]],
    ]],
    ["ID & emergency", [
      ["id_type", "ID type", ["", "aadhaar", "pan"]],
      ["id_last4", "Aadhaar / PAN (last 4)", "text"],
      ["emergency_name", "Emergency contact", "text"],
      ["emergency_phone", "Emergency phone", "tel"],
    ]],
  ],
};

const STATUS_LABEL = { active: "Active", inactive: "Inactive", left: "Left (hidden)" };
const GENDER_LABEL = { "": "Not set", F: "Female", M: "Male" };
const ID_TYPE_LABEL = { "": "Not set", aadhaar: "Aadhaar", pan: "PAN" };
const optionLabel = (key, opt) =>
  key === "status" ? STATUS_LABEL[opt] : key === "gender" ? GENDER_LABEL[opt] : key === "id_type" ? ID_TYPE_LABEL[opt] : opt || "Not set";

// editsFees: this person can change fees, so the Admission step also has the
// student's payment plan (onFeesChanged: their dues were regrouped).
export default function ProfileEdit({ person, kind, sessionId, schoolId, onSaved, onCancel, onDelete, routes = [], editsFees = false, onFeesChanged }) {
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
  // The student's own payment plan this session: "" follows the fee structure.
  const withPlan = editsFees && kind === "students" && Boolean(sessionId);
  // The school's plans (Monthly, Quarterly, its own…) and the student's
  // current one load separately: before the database has student plans, the
  // list still shows and saving says it needs the update.
  const planSchool = schoolId ?? person.school_id;
  const [plans, setPlans] = useState(null);
  const [planReady, setPlanReady] = useState(false);
  const [startPlan, setStartPlan] = useState("");
  const [plan, setPlan] = useState("");
  useEffect(() => {
    if (!withPlan || !planSchool) return;
    let live = true;
    listPlans(planSchool).then(
      (list) => live && setPlans(list),
      () => live && setPlans([])
    );
    studentFeePlan(person.id, sessionId).then(
      (current) => {
        if (!live) return;
        setStartPlan(current ?? "");
        setPlan(current ?? "");
        setPlanReady(true);
      },
      () => live && setPlanReady(false)
    );
    return () => {
      live = false;
    };
  }, [withPlan, planSchool, person.id, sessionId]);
  const planChanged = withPlan && planReady && plan !== startPlan;
  // Edited in steps: the field groups (students then add home and bus).
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
  const dirty = Object.keys(changes).length > 0 || planChanged;
  const HOME_KEYS = ["address", "home_lat", "uses_bus", "bus_stop_id"];
  const stepChanged = (i) =>
    steps[i].keys.some((k) => k in changes) ||
    (steps[i].title === "Home & bus" && HOME_KEYS.some((k) => k in changes)) ||
    (steps[i].title === "Admission & fees" && planChanged);
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
        kind === "students"
          ? Object.keys(changes).length
            ? await updateStudent(person, sessionId, changes)
            : person
          : await updateEmployee(person, changes);
      if (planChanged) {
        try {
          await setStudentFeePlan(person.id, sessionId, plan || null);
          onFeesChanged?.();
        } catch {
          setError("Saved, but the payment plan couldn’t be changed. Try again.");
          setSaving(false);
          return;
        }
      }
      haptic("success");
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
        <StepBar steps={steps.map((st) => st.title)} step={step} onPick={(i) => (setStep(i), setError(""))} marks={steps.map((_, i) => stepChanged(i))} />
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
            {group[0] === "Admission & fees" && withPlan && (
              <label>
                <span>Fee payment plan</span>
                <select value={plan} onChange={(e) => setPlan(e.target.value)} disabled={plans === null || !planReady}>
                  <option value="">As the fee structure</option>
                  {(plans ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.months.length === 1 ? "once a year" : `${p.months.length} times a year`}
                    </option>
                  ))}
                </select>
                {plans !== null && !planReady && (
                  <small className="row-sub">Payment plans need the latest database update before they can be set.</small>
                )}
                {planChanged && (
                  <small className="row-sub">
                    Monthly and other recurring fees are split this way, same total for the year. Paid dues stay as they are.
                  </small>
                )}
              </label>
            )}
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
      {/* Owner only, apart from Save: deleting the whole profile */}
      {onDelete && step === 0 && (
        <button type="button" className="link-btn link-danger edit-delete" onClick={onDelete}>
          <Icon name="trash" size={15} /> Delete this profile
        </button>
      )}
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
