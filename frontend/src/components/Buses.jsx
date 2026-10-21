import { useState } from "react";
import { addBus, deleteBus, updateBus, updateRoute } from "../data/api.js";
import { StepBar } from "./Steps.jsx";
import Icon from "./Icon.jsx";

// The school's buses: number, seats, driver and conductor, and the dates
// its papers run out. A paper that has run out shows red; one running
// out within a month shows amber.

export const PAPERS = [
  ["insurance_until", "Insurance"],
  ["fitness_until", "Fitness (passing)"],
  ["puc_until", "Pollution (PUC)"],
  ["permit_until", "Permit"],
  ["tax_until", "Road tax"],
  ["extinguisher_until", "Fire extinguisher"],
  ["licence_until", "Driver’s licence"],
];
const SAFETY = [
  ["has_gps", "GPS tracker"],
  ["has_cctv", "CCTV camera"],
  ["has_speed_governor", "Speed governor"],
  ["has_first_aid", "First aid box"],
];
export const STATUS = { active: "On the road", repair: "In repair", retired: "Retired" };
const SOON = 30; // days

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const daysTo = (date) => Math.round((new Date(`${date}T12:00:00`) - new Date(`${todayIso()}T12:00:00`)) / 864e5);
const shortDate = (date) => new Date(`${date}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

// "Ran out 3 Oct 2026", "Runs out in 12 days", "Till 4 Mar 2027"
export function paperState(date) {
  if (!date) return { level: "none", text: "Not added" };
  const d = daysTo(date);
  if (d < 0) return { level: "red", text: `Ran out ${shortDate(date)}` };
  if (d === 0) return { level: "red", text: "Runs out today" };
  if (d <= SOON) return { level: "amber", text: `Runs out in ${d} day${d === 1 ? "" : "s"}` };
  return { level: "ok", text: `Till ${shortDate(date)}` };
}

// Papers that have run out or will within a month (buses on the road or
// in repair; retired ones don't count).
export function busAlerts(bus) {
  if (bus.status === "retired") return [];
  return PAPERS.map(([key, label]) => ({ key, label, ...paperState(bus[key]) }))
    .filter((p) => p.level === "red" || p.level === "amber")
    .map((p) => ({ level: p.level, text: `${label(bus)}: ${p.label.toLowerCase()} ${p.text.charAt(0).toLowerCase()}${p.text.slice(1)}` }));
}

export const label = (bus) => bus.name || bus.number;
export const plate = (number) => number.toUpperCase();

export function BusList({ buses, routes, onEdit, onAdd }) {
  return (
    <section className="fc bus-section">
      <header className="fc-head">
        <div className="fc-title">
          <h2 className="bus-h">
            <Icon name="bus" size={20} />
            Buses
          </h2>
          {buses.length > 0 && <span className="freq-btn fc-mini-freq">{buses.length}</span>}
        </div>
        <button className="btn btn-secondary btn-sm" onClick={onAdd}>
          <Icon name="plus" />
          Add bus
        </button>
      </header>
      {buses.length === 0 ? (
        <p className="row-sub bus-empty">Add each bus with its driver and the dates its papers run out. Then pick a bus for each route.</p>
      ) : (
        <div className="bus-grid">
          {buses.map((b) => {
            const runs = routes.filter((r) => r.bus_id === b.id);
            const worst = PAPERS.map(([k]) => paperState(b[k])).sort((x, y) => rank(x.level) - rank(y.level))[0];
            const alerts = busAlerts(b);
            return (
              <button key={b.id} type="button" className={`bus-card${b.status === "retired" ? " is-retired" : ""}`} onClick={() => onEdit(b)}>
                <span className="bus-card-top">
                  <span className="bus-plate">{plate(b.number)}</span>
                  {b.status !== "active" && <span className={`bus-status is-${b.status}`}>{STATUS[b.status]}</span>}
                </span>
                <strong className="bus-name">
                  {b.name || "Bus"}
                  {b.seats ? <span className="row-sub"> · {b.seats} seats</span> : null}
                </strong>
                <span className="bus-line">
                  <Icon name="idcard" size={14} />
                  {b.driver_name ? `${b.driver_name}${b.driver_phone ? ` · ${b.driver_phone}` : ""}` : "No driver added"}
                </span>
                {b.conductor_name && (
                  <span className="bus-line">
                    <Icon name="scholar" size={14} />
                    {b.conductor_name}
                    {b.conductor_phone ? ` · ${b.conductor_phone}` : ""}
                  </span>
                )}
                <span className="bus-line">
                  <Icon name="pin" size={14} />
                  {runs.length ? runs.map((r) => r.name).join(", ") : "Not on a route"}
                </span>
                {b.status !== "retired" && (
                  <span className={`bus-papers is-${alerts.length ? alerts.some((a) => a.level === "red") ? "red" : "amber" : worst?.level === "none" ? "none" : "ok"}`}>
                    {alerts.length
                      ? `${alerts.length} paper${alerts.length === 1 ? "" : "s"} ${alerts.some((a) => a.level === "red") ? "ran out" : "running out"}`
                      : worst?.level === "none"
                      ? "Add paper dates"
                      : "Papers up to date"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

const rank = (level) => ({ red: 0, amber: 1, none: 2, ok: 3 })[level];

const EMPTY = {
  number: "",
  name: "",
  seats: "",
  model: "",
  status: "active",
  driver_name: "",
  driver_phone: "",
  driver_licence: "",
  licence_until: "",
  conductor_name: "",
  conductor_phone: "",
  insurance_until: "",
  fitness_until: "",
  puc_until: "",
  permit_until: "",
  tax_until: "",
  extinguisher_until: "",
  has_gps: false,
  has_cctv: false,
  has_speed_governor: false,
  has_first_aid: false,
  notes: "",
};

const STEPS = ["Bus", "Driver & conductor", "Papers", "Safety"];
const phone = (v) => v.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");

// Add or edit a bus, in four short steps.
export function BusForm({ school, bus, buses, routes, onClose, onSaved }) {
  const [form, setForm] = useState(() => Object.fromEntries(Object.entries(EMPTY).map(([k, v]) => [k, bus?.[k] ?? v])));
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const runs = bus ? routes.filter((r) => r.bus_id === bus.id) : [];
  const key = (n) => n.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const twin = form.number.trim() && buses.find((b) => b.id !== bus?.id && key(b.number) === key(form.number));

  // What's wrong on a step, if anything
  const problem = (i) => {
    if (i === 0) {
      if (!form.number.trim()) return "Add the bus number.";
      if (twin) return `${plate(twin.number)} is already added.`;
      if (form.seats !== "" && !(Number(form.seats) >= 1 && Number(form.seats) <= 120)) return "Seats should be between 1 and 120.";
    }
    if (i === 1) {
      if (form.driver_phone && phone(form.driver_phone).length !== 10) return "The driver’s phone should have 10 digits.";
      if (form.conductor_phone && phone(form.conductor_phone).length !== 10) return "The conductor’s phone should have 10 digits.";
    }
    return "";
  };

  async function save(e) {
    e.preventDefault();
    const bad = [0, 1].find((i) => problem(i));
    if (bad !== undefined) {
      setStep(bad);
      setError(problem(bad));
      return;
    }
    setSaving(true);
    setError("");
    const fields = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, typeof v === "boolean" ? v : String(v).trim() === "" ? null : String(v).trim()])
    );
    fields.number = form.number.trim().toUpperCase().replace(/\s+/g, " ");
    fields.seats = fields.seats ? Number(fields.seats) : null;
    fields.driver_phone = fields.driver_phone ? phone(fields.driver_phone) : null;
    fields.conductor_phone = fields.conductor_phone ? phone(fields.conductor_phone) : null;
    try {
      const saved = bus ? await updateBus(bus.id, fields) : await addBus(school.id, fields);
      // A retired bus comes off its routes
      if (fields.status === "retired" && runs.length) await Promise.all(runs.map((r) => updateRoute(r.id, { bus_id: null })));
      await onSaved(saved, { routesChanged: fields.status === "retired" && runs.length > 0 });
      onClose();
    } catch (err) {
      setSaving(false);
      setError(
        err?.code === "23505"
          ? "A bus with that number is already added."
          : err?.code === "PGRST205" || err?.code === "42P01"
          ? "Buses aren’t set up in the database yet (npx supabase db push)."
          : err?.code === "23514"
          ? "Check the numbers: phones need 10 digits, seats 1 to 120."
          : "That didn’t go through. Try again."
      );
    }
  }

  async function remove() {
    setSaving(true);
    try {
      await deleteBus(bus.id);
      await onSaved(null, { routesChanged: runs.length > 0 });
      onClose();
    } catch {
      setSaving(false);
      setError("Couldn’t remove the bus. Try again.");
    }
  }

  const field = (k, text, props = {}) => (
    <label key={k}>
      <span>{text}</span>
      <input value={form[k]} onChange={set(k)} {...props} />
    </label>
  );
  const last = step === STEPS.length - 1;

  return (
    <div className="modal-backdrop" onClick={() => !saving && onClose()}>
      <section className="modal bus-modal" role="dialog" aria-modal="true" aria-label={bus ? "Edit bus" : "Add bus"} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <Icon name="bus" /> {bus ? plate(bus.number) : "Add bus"}
          </h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>
        <form className="modal-body profile-edit" onSubmit={save}>
          <StepBar steps={STEPS} step={step} onPick={(i) => (setStep(i), setError(""))} canPick={(i) => Boolean(bus) || i <= step || !problem(0)} />

          <div className="edit-step">
            {step === 0 && (
              <div className="form-grid">
                {field("number", "Bus number", { placeholder: "HR 01 AB 1234", maxLength: 20, required: true, autoFocus: !bus })}
                {field("name", "Name (optional)", { placeholder: "Bus 1", maxLength: 40 })}
                {field("seats", "Seats", { type: "number", min: 1, max: 120, inputMode: "numeric" })}
                {field("model", "Make and model", { placeholder: "Tata Starbus, 2019", maxLength: 60 })}
                <label>
                  <span>Status</span>
                  <select value={form.status} onChange={set("status")}>
                    {Object.entries(STATUS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                {form.status === "retired" && runs.length > 0 && (
                  <p className="callout callout-neutral bus-wide">It comes off {runs.map((r) => r.name).join(", ")}. Pick another bus for {runs.length === 1 ? "it" : "them"}.</p>
                )}
                {form.status === "repair" && runs.length > 0 && (
                  <p className="callout callout-neutral bus-wide">Still on {runs.map((r) => r.name).join(", ")}. Those routes will show it’s in repair.</p>
                )}
              </div>
            )}
            {step === 1 && (
              <div className="form-grid">
                {field("driver_name", "Driver’s name", { maxLength: 80, autoComplete: "off" })}
                {field("driver_phone", "Driver’s phone", { type: "tel", inputMode: "numeric", maxLength: 14, placeholder: "10 digits" })}
                {field("driver_licence", "Licence number", { maxLength: 30 })}
                {field("licence_until", "Licence valid till", { type: "date" })}
                {field("conductor_name", "Conductor’s name", { maxLength: 80, autoComplete: "off" })}
                {field("conductor_phone", "Conductor’s phone", { type: "tel", inputMode: "numeric", maxLength: 14, placeholder: "10 digits" })}
              </div>
            )}
            {step === 2 && (
              <div className="form-grid">
                {PAPERS.filter(([k]) => k !== "licence_until").map(([k, text]) => {
                  const st = paperState(form[k]);
                  return (
                    <label key={k}>
                      <span>{text} valid till</span>
                      <input type="date" value={form[k]} onChange={set(k)} />
                      {form[k] && st.level !== "ok" && <small className={`bus-hint is-${st.level}`}>{st.text}</small>}
                    </label>
                  );
                })}
              </div>
            )}
            {step === 3 && (
              <>
                <div className="bus-checks">
                  {SAFETY.map(([k, text]) => (
                    <label key={k} className="bus-check">
                      <input type="checkbox" checked={form[k]} onChange={set(k)} />
                      {text}
                    </label>
                  ))}
                </div>
                <label className="bus-notes">
                  <span>Notes</span>
                  <textarea rows={3} maxLength={300} value={form.notes} onChange={set("notes")} placeholder="Anything else, e.g. service due at 80,000 km" />
                </label>
                {bus &&
                  (asking ? (
                    <p className="ft-confirm">
                      <span>Remove {plate(bus.number)}{runs.length ? `? ${runs.map((r) => r.name).join(", ")} will have no bus.` : "?"}</span>
                      <button type="button" className="link-btn link-danger" onClick={remove} disabled={saving}>
                        Remove
                      </button>
                      <button type="button" className="link-btn" onClick={() => setAsking(false)}>
                        Keep
                      </button>
                    </p>
                  ) : (
                    <button type="button" className="link-btn link-danger edit-delete" onClick={() => setAsking(true)}>
                      <Icon name="trash" size={15} /> Remove this bus
                    </button>
                  ))}
              </>
            )}
          </div>

          {error && <p className="notice notice-error">{error}</p>}

          <div className="modal-footer modal-footer-sticky edit-foot">
            {step === 0 ? (
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
                Cancel
              </button>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={() => (setStep(step - 1), setError(""))} disabled={saving}>
                <Icon name="arrowLeft" /> Back
              </button>
            )}
            <span className="edit-foot-right">
              {!last && (
                <button
                  type="button"
                  className={`btn ${bus ? "btn-secondary" : "btn-primary"}`}
                  onClick={() => {
                    const p = problem(step);
                    if (p) return setError(p);
                    setError("");
                    setStep(step + 1);
                  }}
                >
                  Next <Icon name="arrowRight" />
                </button>
              )}
              {(bus || last) && (
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? "Saving…" : bus ? "Save" : "Add bus"}
                </button>
              )}
            </span>
          </div>
        </form>
      </section>
    </div>
  );
}
