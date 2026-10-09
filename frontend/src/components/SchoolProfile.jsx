import { useRef, useState } from "react";
import { logoUrl, removeSchoolLogo, updateSchool, uploadSchoolLogo } from "../data/api.js";
import Icon from "./Icon.jsx";

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

// Owner-only: the school's name, logo and details.
export default function SchoolProfile({ school, onSaved }) {
  const initial = Object.fromEntries(FIELDS.map(([k]) => [k, school[k] ?? ""]));
  const [form, setForm] = useState(initial);
  const [state, setState] = useState("idle"); // idle | saving | saved | logo
  const [error, setError] = useState("");
  const file = useRef(null);
  const dirty = FIELDS.some(([k]) => (form[k] ?? "") !== (initial[k] ?? ""));

  async function save(e) {
    e.preventDefault();
    setState("saving");
    setError("");
    try {
      onSaved(await updateSchool(school.id, form));
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
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

  return (
    <section className="panel school-panel">
      <h2 className="panel-title">School profile</h2>
      <div className="school-body">
        <div className="logo-box">
          {school.logo_path ? (
            <img src={logoUrl(school.logo_path)} alt={`${school.name} logo`} />
          ) : (
            <span className="row-sub">No logo</span>
          )}
          <input ref={file} type="file" accept="image/*" hidden onChange={changeLogo} />
          <div className="logo-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => file.current.click()} disabled={state === "logo"}>
              <Icon name="upload" />
              {state === "logo" ? "Uploading…" : school.logo_path ? "Replace" : "Upload logo"}
            </button>
            {school.logo_path && (
              <button type="button" className="link-btn" onClick={dropLogo} disabled={state === "logo"}>
                Remove
              </button>
            )}
          </div>
          <span className="row-sub">Shown in the header and on the join screen.</span>
        </div>

        <form className="school-form" onSubmit={save}>
          <div className="form-grid">
            {FIELDS.map(([k, label, { wide, ...attrs }]) => (
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
          <div className="school-actions">
            {dirty && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm(initial)}>
                Discard
              </button>
            )}
            <button className="btn btn-primary btn-sm" disabled={!dirty || state === "saving"}>
              {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Save details"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
