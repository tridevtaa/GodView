import { useRef, useState } from "react";
import { logoUrl, removeSchoolLogo, setLogoScale, updateSchool, uploadSchoolLogo } from "../data/api.js";
import { LogoMark } from "./Logo.jsx";
import Icon from "./Icon.jsx";
import { StepBar } from "./Steps.jsx";

const BOARDS = ["CBSE", "ICSE / ISC", "State board", "IB", "Cambridge (IGCSE)", "NIOS"];

const FIELDS = [
  ["name", "School name", { required: true, maxLength: 120 }],
  ["short_name", "Short name (header)", { maxLength: 40, placeholder: "e.g. Mavericks" }],
  ["board", "Board", { maxLength: 60, list: "boards" }],
  ["affiliation_no", "Affiliation no.", { maxLength: 40 }],
  ["udise_code", "UDISE code", { inputMode: "numeric", pattern: "\\d{11}", title: "11 digits", maxLength: 11 }],
  ["principal_name", "Principal", { maxLength: 120 }],
  ["phone", "Phone", { type: "tel", maxLength: 20 }],
  ["email", "Email", { type: "email", maxLength: 120 }],
  ["website", "Website", { type: "url", maxLength: 200, placeholder: "https://" }],
  ["address", "Address", { maxLength: 300, wide: true }],
  ["city", "City", { maxLength: 80 }],
  ["state", "State", { maxLength: 80 }],
  ["pincode", "PIN code", { inputMode: "numeric", pattern: "\\d{6}", title: "6 digits", maxLength: 6 }],
];

// Edited in four short steps.
const STEPS = [
  ["Name & logo", ["name", "short_name"]],
  ["Board", ["board", "affiliation_no", "udise_code", "principal_name"]],
  ["Contact", ["phone", "email", "website"]],
  ["Address", ["address", "city", "state", "pincode"]],
];

// Owner-only: the school's name, logo and details. A one-line summary (with
// `aside`, the join code) until the owner opens it to edit.
export default function SchoolProfile({ school, onSaved, aside }) {
  const [editing, setEditing] = useState(false);
  const initial = Object.fromEntries(FIELDS.map(([k]) => [k, school[k] ?? ""]));
  const [form, setForm] = useState(initial);
  const [state, setState] = useState("idle"); // idle | saving | logo
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  // Logo size in the header, previewed live beside the Godview mark.
  const [scale, setScale] = useState(Number(school.logo_scale ?? 1));
  const [scaleState, setScaleState] = useState("");
  async function saveScale(v) {
    setScaleState("saving");
    try {
      onSaved(await setLogoScale(school.id, v));
      setScaleState("saved");
      setTimeout(() => setScaleState(""), 1200);
    } catch {
      setScaleState("error");
    }
  }
  const file = useRef(null);
  const changed = (k) => (form[k] ?? "") !== (initial[k] ?? "");
  const dirty = FIELDS.some(([k]) => changed(k));
  const last = step === STEPS.length - 1;

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      setStep(0);
      return setError("The school needs a name.");
    }
    setState("saving");
    setError("");
    try {
      onSaved(await updateSchool(school.id, form));
      setState("idle");
      setEditing(false);
    } catch (err) {
      setState("idle");
      setError(
        /pincode|udise|name_length/.test(err?.message ?? "")
          ? "Check the PIN (6 digits), UDISE code (11 digits) and name."
          : "Couldn’t save. Try again."
      );
    }
  }

  async function changeLogo(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setState("logo");
    setError("");
    try {
      onSaved(await uploadSchoolLogo(school, f));
    } catch {
      setError("Couldn’t upload that image. Use a PNG, JPG or SVG under 1 MB.");
    } finally {
      setState("idle");
    }
  }

  async function dropLogo() {
    setState("logo");
    try {
      onSaved(await removeSchoolLogo(school));
    } catch {
      setError("Couldn’t remove the logo.");
    } finally {
      setState("idle");
    }
  }

  const place = [school.city, school.state].filter(Boolean).join(", ");
  const meta = [school.board, place, school.principal_name && `Principal ${school.principal_name}`].filter(Boolean);
  const missing = FIELDS.filter(([k]) => k !== "short_name" && !school[k]).length;

  return (
    <section className={`panel school-panel${editing ? " is-editing" : ""}`}>
      <div className="school-summary">
        <span className="school-logo">
          {school.logo_path ? <img src={logoUrl(school.logo_path)} alt="" /> : <Icon name="camera" size={20} />}
        </span>
        <div className="school-id">
          <h2 className="school-name">{school.name}</h2>
          <p className="row-sub">
            {meta.length ? meta.join(" · ") : "Add the board, address and contact details"}
            {missing > 0 && meta.length > 0 && <span className="school-missing"> · {missing} details to add</span>}
          </p>
        </div>
        {aside}
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => (editing ? (setForm(initial), setEditing(false)) : (setStep(0), setEditing(true)))}>
          {editing ? "Close" : <><Icon name="edit" /> Edit details</>}
        </button>
      </div>
      {editing && (
        <form className="school-body school-steps" onSubmit={save}>
          <StepBar steps={STEPS.map(([t]) => t)} step={step} onPick={(i) => (setStep(i), setError(""))} marks={STEPS.map(([, keys]) => keys.some(changed))} />

          {step === 0 && (
            <div className="logo-box">
              {school.logo_path ? <img src={logoUrl(school.logo_path)} alt={`${school.name} logo`} /> : <span className="row-sub">No logo</span>}
              <input ref={file} type="file" accept="image/*" hidden onChange={changeLogo} />
              <div className="logo-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => file.current.click()} disabled={state === "logo"}>
                  <Icon name="upload" />
                  {state === "logo" ? "Uploading…" : school.logo_path ? "Replace" : "Upload logo"}
                </button>
                {school.logo_path && (
                  <button type="button" className="icon-btn-sm" onClick={dropLogo} disabled={state === "logo"} aria-label="Remove logo" title="Remove logo">
                    <Icon name="trash" size={15} />
                  </button>
                )}
              </div>
            </div>
          )}

          {step === 0 && school.logo_path && (
            <div className="logo-size">
              <span className="logo-size-preview" aria-hidden="true">
                <LogoMark size={26} />
                <span className="logo-x">×</span>
                <img className="logo-partner" src={logoUrl(school.logo_path)} alt="" style={{ "--logo-scale": scale }} />
              </span>
              <label className="logo-size-range">
                <span>
                  Logo size in the header
                  {scaleState === "saved" && <em> · Saved</em>}
                  {scaleState === "error" && <em className="field-error"> · Couldn’t save</em>}
                </span>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.05"
                  value={scale}
                  onChange={(e) => setScale(Number(e.target.value))}
                  onPointerUp={(e) => saveScale(Number(e.target.value))}
                  onKeyUp={(e) => saveScale(Number(e.target.value))}
                  aria-label="Logo size"
                />
              </label>
              {scale !== 1 && (
                <button type="button" className="link-btn" onClick={() => (setScale(1), saveScale(1))}>
                  Reset
                </button>
              )}
            </div>
          )}

          <div className="form-grid">
            {FIELDS.filter(([k]) => STEPS[step][1].includes(k)).map(([k, label, { wide, ...attrs }]) => (
              <label key={k} className={wide ? "span-2" : ""}>
                <span>{label}</span>
                <input value={form[k] ?? ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} {...attrs} />
              </label>
            ))}
            <datalist id="boards">
              {BOARDS.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </div>
          {error && <p className="field-error">{error}</p>}
          <div className="school-actions edit-foot">
            {step === 0 ? (
              dirty ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm(initial)}>
                  Discard
                </button>
              ) : (
                <span />
              )
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
              <button className="btn btn-primary btn-sm" disabled={!dirty || state === "saving"}>
                {state === "saving" ? "Saving…" : "Save"}
              </button>
            </span>
          </div>
        </form>
      )}
    </section>
  );
}
