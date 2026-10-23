import { useEffect, useMemo, useState } from "react";
import PlacePicker from "./PlacePicker.jsx";
import TransportPicker from "./TransportPicker.jsx";
import { gradeLabel, tintFor } from "./PersonCard.jsx";
import { gradeRank } from "./GradeFilter.jsx";
import Icon from "./Icon.jsx";
import { StepBar } from "./Steps.jsx";
import { uploadStudentDocument } from "../data/api.js";

// Document kind (matches storage.uploadStudentDocument) -> the person field
// its saved path goes into (students.aadhaar_doc_path etc.).
const DOC_PATH_FIELD = { aadhaar: "aadhaar_doc_path", birth_certificate: "birth_cert_path", transfer_certificate: "transfer_cert_path" };

const EMPLOYEE_FIELDS = [
  ["name", "Full name", "text", true],
  ["designation", "Designation", "text", true],
  ["department", "Department", "text"],
  ["employee_no", "Employee no.", "text"],
  ["phone", "Phone", "tel"],
  ["email", "Email", "email"],
];

const STEPS = ["Student", "Class", "Family", "Home & bus"];
const EMPLOYEE_STEPS = ["Role", "Contact"];
const today = () => new Date().toISOString().slice(0, 10);
// Empty, or a 10-digit Indian mobile (an optional +91 or 0 in front is fine).
const tenDigits = (v) => !v.trim() || v.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "").length === 10;

// Next admission no. in the grade's own series, e.g. KG/0881 -> KG/0882.
function suggestAdmissionNo(students, grade) {
  const inGrade = students.filter((s) => s.class === grade && /\d+$/.test(s.admission_no ?? ""));
  if (!inGrade.length) return "";
  const prefixes = new Map();
  inGrade.forEach((s) => {
    const prefix = s.admission_no.replace(/\d+$/, "");
    prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
  });
  const prefix = [...prefixes].sort((a, b) => b[1] - a[1])[0][0];
  const series = students.map((s) => s.admission_no ?? "").filter((n) => n.startsWith(prefix) && /^\d+$/.test(n.slice(prefix.length)));
  const width = Math.max(...series.map((n) => n.length - prefix.length));
  const next = Math.max(...series.map((n) => Number(n.slice(prefix.length)))) + 1;
  return prefix + String(next).padStart(width, "0");
}

export default function AddModal({ mode, schoolId, grades = [], routes = [], students = [], onClose, onSave, onManageRoutes }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      {mode === "students" ? (
        <AddStudent schoolId={schoolId} grades={grades} routes={routes} students={students} onClose={onClose} onSave={onSave} onManageRoutes={onManageRoutes} />
      ) : (
        <AddEmployee onClose={onClose} onSave={onSave} />
      )}
    </div>
  );
}

function AddStudent({ schoolId, grades, routes, students, onClose, onSave, onManageRoutes }) {
  const [step, setStep] = useState(0);
  // Generated up front so documents can be uploaded to their final storage
  // path (keyed by this id) before the student row exists; save() passes
  // the same id to onSave so the insert lands at that path.
  const [studentId] = useState(() => crypto.randomUUID());
  const [docs, setDocs] = useState({});
  // Checked when the parent doesn't have the transfer certificate on hand
  // yet: the admission isn't held up for it, but it's tracked as owed
  // (transfer_cert_pending) until someone uploads it.
  const [slcDeferred, setSlcDeferred] = useState(false);
  const [form, setForm] = useState({
    name: "",
    gender: "",
    dob: "",
    class: "",
    section: "",
    stream: "",
    admission_no: "",
    admission_date: today(),
    // Every admission through this form is a new one; the school's own
    // record of transfers-in is the transfer certificate, not this field.
    admission_type: "New",
    parent_name: "",
    mother_name: "",
    parent_phone: "",
    mother_phone: "",
    email: "",
  });
  const [home, setHome] = useState(null);
  const [transport, setTransport] = useState({ uses_bus: false, bus_stop_id: null });
  const [suggested, setSuggested] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function pickDocument(kind, e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setDocs((d) => ({ ...d, [kind]: { name: file.name, busy: true, error: "" } }));
    try {
      const path = await uploadStudentDocument(schoolId, studentId, kind, file);
      setForm((f) => ({ ...f, [DOC_PATH_FIELD[kind]]: path }));
      // The SLC is in hand now, so there's nothing left to collect later.
      if (kind === "transfer_certificate") setSlcDeferred(false);
      setDocs((d) => ({ ...d, [kind]: { name: file.name, busy: false, error: "" } }));
    } catch {
      setDocs((d) => ({ ...d, [kind]: { name: file.name, busy: false, error: "Couldn’t upload. Try a smaller photo or PDF." } }));
    }
  }

  // Grades from the school's list, else from the students.
  const gradeOptions = useMemo(() => {
    if (grades.length) return grades.map((g) => ({ code: g.code, label: g.label }));
    return [...new Set(students.map((s) => s.class).filter(Boolean))].map((c) => ({ code: c, label: gradeLabel(c) }));
  }, [grades, students]);
  const inGrade = useMemo(() => students.filter((s) => s.class === form.class), [students, form.class]);
  const sections = useMemo(() => {
    const own = grades.find((g) => g.code === form.class)?.sections ?? [];
    return [...new Set([...own, ...inGrade.map((s) => s.section).filter(Boolean)])].sort();
  }, [grades, inGrade, form.class]);
  const streams = useMemo(() => [...new Set(inGrade.map((s) => s.stream).filter(Boolean))].sort(), [inGrade]);

  function pickGrade(code) {
    const next = suggestAdmissionNo(students, code);
    setForm((f) => ({
      ...f,
      class: code,
      section: "",
      stream: "",
      // Keep a typed number; replace an untouched suggestion.
      admission_no: !f.admission_no || f.admission_no === suggested ? next : f.admission_no,
    }));
    setSuggested(next);
  }

  const taken = form.admission_no.trim() && students.some((s) => s.admission_no?.toLowerCase() === form.admission_no.trim().toLowerCase());
  // The school's entry grade (Nursery, or whichever sorts lowest) is the one
  // nobody transfers into, so no SLC is expected for it.
  const entryGradeCode = grades.length
    ? grades.reduce((min, g) => (gradeRank(g.code) < gradeRank(min.code) ? g : min), grades[0]).code
    : null;
  const needsSlc = Boolean(form.class) && form.class !== entryGradeCode;
  const slcOk = !needsSlc || slcDeferred || Boolean(form.transfer_cert_path);
  const stepOk = [
    Boolean(form.name.trim()),
    Boolean(form.class && form.admission_no.trim() && !taken) && slcOk,
    tenDigits(form.parent_phone) && tenDigits(form.mother_phone),
    true,
  ];
  const canSave = stepOk[0] && stepOk[1] && stepOk[2];

  async function save() {
    setSaving(true);
    setError("");
    const route = routes.find((r) => r.stops.some((s) => s.id === transport.bus_stop_id));
    const stop = route?.stops.find((s) => s.id === transport.bus_stop_id);
    try {
      await onSave({
        id: studentId,
        ...form,
        transfer_cert_pending: needsSlc && slcDeferred && !form.transfer_cert_path,
        address: home?.address ?? "",
        city: home?.city ?? "",
        state: home?.state ?? "",
        home_lat: home?.lat ?? null,
        home_lng: home?.lng ?? null,
        home_place_id: home?.place_id ?? null,
        uses_bus: transport.uses_bus,
        bus_stop_id: transport.uses_bus ? transport.bus_stop_id : null,
        transport_route: transport.uses_bus ? route?.name ?? "" : "",
        pickup_point: transport.uses_bus ? stop?.name ?? "" : "",
      });
      onClose();
    } catch {
      setError("Couldn’t save. Check your connection and that you have access, then try again.");
      setSaving(false);
    }
  }

  const initials = form.name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  const last = step === STEPS.length - 1;

  return (
    <form
      className="modal modal-lg add"
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        if (!stepOk[step]) return;
        if (last) save();
        else setStep(step + 1);
      }}
      aria-label="Add student"
    >
      <header className="ns-head">
        <div className="ns-title">
          <span className="ns-avatar" style={{ background: tintFor({ id: form.admission_no || form.name }) }}>
            {initials || <Icon name="plus" size={20} />}
          </span>
          <div>
            <h2>{form.name.trim() || "New student"}</h2>
            <p className="row-sub">
              {[form.class && gradeLabel(form.class), form.section, form.admission_no].filter(Boolean).join(" · ") || "Add to the current session"}
            </p>
          </div>
          <button type="button" className="btn-icon ns-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>
        <StepBar steps={STEPS} step={step} onPick={setStep} canPick={(i) => i < step || stepOk.slice(0, i).every(Boolean)} />
      </header>

      <div className="modal-body ns-body">
        {step === 0 && (
          <div className="ns-grid">
            <label className="span-2">
              <span>Full name *</span>
              <input value={form.name} onChange={set("name")} required maxLength={80} autoFocus placeholder="e.g. Harman Singh" />
            </label>
            <label className="span-2">
              <span>Date of birth</span>
              <input type="date" value={form.dob} onChange={set("dob")} max={today()} />
            </label>
            <div className="field span-2">
              <span>Gender</span>
              <div className="choice-row">
                {[
                  ["F", "Girl"],
                  ["M", "Boy"],
                ].map(([v, l]) => (
                  <button type="button" key={v} className={`choice${form.gender === v ? " on" : ""}`} onClick={() => setForm((f) => ({ ...f, gender: f.gender === v ? "" : v }))}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="ns-grid">
            <label>
              <span>Grade *</span>
              <select value={form.class} onChange={(e) => pickGrade(e.target.value)} required>
                <option value="">Choose a grade</option>
                {gradeOptions.map((g) => (
                  <option key={g.code} value={g.code}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Section</span>
              <input value={form.section} onChange={set("section")} list="ns-sections" placeholder={sections[0] ? `e.g. ${sections[0]}` : "e.g. A"} maxLength={30} />
              <datalist id="ns-sections">
                {sections.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </label>
            {streams.length > 0 && (
              <div className="field span-2">
                <span>Stream</span>
                <div className="choice-row">
                  {streams.map((s) => (
                    <button type="button" key={s} className={`choice${form.stream === s ? " on" : ""}`} onClick={() => setForm((f) => ({ ...f, stream: f.stream === s ? "" : s }))}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label>
              <span>Admission no. *</span>
              <input value={form.admission_no} onChange={set("admission_no")} required maxLength={30} placeholder="e.g. KG/0882" />
              {taken ? (
                <small className="field-error">Already used by another student.</small>
              ) : (
                suggested && form.admission_no === suggested && <small className="row-sub">Next in this grade’s series</small>
              )}
            </label>
            <label>
              <span>Admission date</span>
              <input type="date" value={form.admission_date} onChange={set("admission_date")} />
            </label>
            <div className="field-block span-2">
              <span className="field-label">Documents</span>
              <p className="row-sub">A photo or scan of each. Aadhaar and birth certificate are optional.</p>
              <DocPicker label="Aadhaar card" kind="aadhaar" doc={docs.aadhaar} onPick={pickDocument} />
              <DocPicker label="Birth certificate" kind="birth_certificate" doc={docs.birth_certificate} onPick={pickDocument} />
              {needsSlc && (
                <>
                  <DocPicker label="Transfer certificate (SLC) *" kind="transfer_certificate" doc={docs.transfer_certificate} onPick={pickDocument} />
                  <label className="checkbox checkbox-inline">
                    <input
                      type="checkbox"
                      checked={slcDeferred}
                      onChange={(e) => setSlcDeferred(e.target.checked)}
                      disabled={Boolean(form.transfer_cert_path)}
                    />
                    <span>Not available yet — collect it later</span>
                  </label>
                  {slcDeferred ? (
                    <p className="row-sub">This student will be flagged on the students list until the SLC is uploaded.</p>
                  ) : (
                    !form.transfer_cert_path && (
                      <small className="field-error">Required for a student joining from another school, or mark it for later.</small>
                    )
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="ns-grid">
            <label>
              <span>Father’s name</span>
              <input value={form.parent_name} onChange={set("parent_name")} maxLength={80} autoFocus />
            </label>
            <label>
              <span>Mother’s name</span>
              <input value={form.mother_name} onChange={set("mother_name")} maxLength={80} />
            </label>
            <label>
              <span>Parent phone</span>
              <input type="tel" inputMode="numeric" value={form.parent_phone} onChange={set("parent_phone")} placeholder="10-digit mobile" maxLength={16} />
              {!tenDigits(form.parent_phone) && <small className="field-error">Enter a 10-digit mobile number.</small>}
            </label>
            <label>
              <span>Mother phone</span>
              <input type="tel" inputMode="numeric" value={form.mother_phone} onChange={set("mother_phone")} placeholder="Optional" maxLength={16} />
              {!tenDigits(form.mother_phone) && <small className="field-error">Enter a 10-digit mobile number.</small>}
            </label>
            <label className="span-2">
              <span>Email</span>
              <input type="email" value={form.email} onChange={set("email")} placeholder="Optional" maxLength={120} />
            </label>
            <p className="row-sub span-2">The parent phone is how parents sign in to the Godview app.</p>
          </div>
        )}

        {step === 3 && (
          <div className="ns-sections">
            <section>
              <h3>
                <Icon name="pin" />
                Home
              </h3>
              <p className="row-sub">Search the village, town or street and pin the home. Used for the student map and bus planning.</p>
              <PlacePicker value={home} onChange={setHome} label="Home location" />
            </section>
            <section>
              <h3>
                <Icon name="bus" />
                Transport
              </h3>
              <TransportPicker routes={routes} value={transport} onChange={setTransport} onManage={onManageRoutes} />
            </section>
          </div>
        )}
        {error && <p className="field-error">{error}</p>}
      </div>

      <footer className="modal-footer ns-foot">
        {step > 0 ? (
          <button type="button" className="btn btn-secondary" onClick={() => setStep(step - 1)}>
            <Icon name="arrowLeft" />
            Back
          </button>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        )}
        <span className="ns-foot-end">
          {!last && step > 1 && (
            <button type="button" className="link-btn" onClick={save} disabled={saving || !canSave}>
              Skip and save
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={saving || !stepOk[step]}>
            {last ? (saving ? "Adding…" : "Add student") : "Next"}
            {!last && <Icon name="arrowRight" />}
          </button>
        </span>
      </footer>
    </form>
  );
}

// One document upload slot (Aadhaar, birth certificate, transfer
// certificate): a photo or PDF, uploaded as soon as it's picked.
function DocPicker({ label, kind, doc, onPick }) {
  const saved = Boolean(doc?.name) && !doc?.busy && !doc?.error;
  return (
    <label className="field-block doc-pick">
      <span>{label}</span>
      <span className={`doc-pick-box${saved ? " is-set" : ""}`}>
        <Icon name={saved ? "check" : "upload"} size={16} />
        {doc?.busy ? "Uploading…" : saved ? doc.name : "Choose a photo or PDF"}
      </span>
      <input type="file" accept="image/*,application/pdf" onChange={(e) => onPick(kind, e)} hidden />
      {doc?.error && <span className="field-error">{doc.error}</span>}
    </label>
  );
}

// Two short steps: who they are, then how to reach them.
const EMPLOYEE_STEP_FIELDS = [["name", "designation", "department", "employee_no"], ["phone", "email"]];

function AddEmployee({ onClose, onSave }) {
  const [form, setForm] = useState(Object.fromEntries(EMPLOYEE_FIELDS.map(([k]) => [k, ""])));
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const firstOk = Boolean(form.name.trim() && form.designation.trim());

  async function submit(e) {
    e.preventDefault();
    if (step === 0) {
      if (firstOk) setStep(1);
      return;
    }
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
    <form className="modal add" onClick={(e) => e.stopPropagation()} onSubmit={submit} aria-label="Add employee">
      <header className="ns-head">
        <div className="ns-title">
          <span className="ns-avatar" style={{ background: tintFor({ id: form.name }) }}>
            {form.name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || <Icon name="plus" size={20} />}
          </span>
          <div>
            <h2>{form.name.trim() || "New employee"}</h2>
            <p className="row-sub">{form.designation || "Teaching or office staff"}</p>
          </div>
          <button type="button" className="btn-icon ns-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>
        <StepBar steps={EMPLOYEE_STEPS} step={step} onPick={setStep} canPick={(i) => i === 0 || firstOk} />
      </header>
      <div className="modal-body ns-body">
        <div className="ns-grid">
          {EMPLOYEE_FIELDS.filter(([key]) => EMPLOYEE_STEP_FIELDS[step].includes(key)).map(([key, label, type, required]) => (
            <label key={key} className={key === "name" ? "span-2" : ""}>
              <span>
                {label}
                {required ? " *" : ""}
              </span>
              <input type={type} required={required} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} autoFocus={key === EMPLOYEE_STEP_FIELDS[step][0]} />
            </label>
          ))}
        </div>
        {error && <p className="field-error">{error}</p>}
      </div>
      <footer className="modal-footer ns-foot">
        {step === 0 ? (
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={() => setStep(0)}>
            <Icon name="arrowLeft" />
            Back
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={saving || !firstOk}>
          {step === 0 ? (
            <>
              Next <Icon name="arrowRight" />
            </>
          ) : saving ? (
            "Adding…"
          ) : (
            "Add staff"
          )}
        </button>
      </footer>
    </form>
  );
}
