import { useEffect, useMemo, useState } from "react";
import {
  addEnquiry,
  addStudent,
  admissionStudentExists,
  deleteAdmission,
  ensureSession,
  finishAdmission,
  listAdmissions,
  registerAdmission,
  saveAdmissionSettings,
  saveGradeSeats,
  seatsTaken,
  studentDocumentUrl,
  updateAdmission,
  uploadStudentDocument,
} from "../data/api.js";
import { peek, remember, swr } from "../data/cache.js";
import { METHODS, rupees } from "../data/money.js";
import AddModal, { DocPicker } from "./AddModal.jsx";
import { gradeLabel } from "./PersonCard.jsx";
import Icon from "./Icon.jsx";
import Receipt from "./Receipt.jsx";
import { StepBar } from "./Steps.jsx";

// Admissions: a child goes from Enquiry to Registered to Admitted here, and
// only becomes a student at the end (the same id, so documents stay in place).
// Applicants are kept apart from students: nothing here reaches attendance,
// fees or parent logins until they're admitted.
// Owners and admins do everything; the principal can only look (readOnly).
// view: which stage shows. Computers pick it here; phones from the row above
// the tab bar. addAt: open a new enquiry (from the +).

export const STAGES = [
  ["enquiry", "Enquiries"],
  ["registered", "Registered"],
  ["admitted", "Admitted"],
  ["lost", "Not joining"],
];
const SOURCES = ["Walk-in", "Phone", "Website", "Referral", "Social media", "Other"];
const LOST_REASONS = ["Chose another school", "Fees too high", "Moved away", "No seat", "Not selected", "No response", "Other"];
const PAY_MODES = ["cash", "upi", "cheque", "card", "bank_transfer"];
const DOC_FIELD = { aadhaar: "aadhaar_doc_path", birth_certificate: "birth_cert_path", transfer_certificate: "transfer_cert_path" };
const DOC_NAME = { aadhaar: "Aadhaar card", birth_certificate: "Birth certificate", transfer_certificate: "Transfer certificate" };

// A day as the school sees it, "YYYY-MM-DD"
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shortDate = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
const tenDigits = (v) => !String(v ?? "").trim() || String(v).replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "").length === 10;
const blank = (fields) => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typeof v === "string" && !v.trim() ? null : v]));
const nextSessionName = (name) => {
  const y = Number(String(name).slice(0, 4)) + 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
};
const yearSessionName = (d = new Date()) => {
  const y = d.getMonth() < 3 ? d.getFullYear() - 1 : d.getFullYear();
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
};

// When someone enquires: this session until September, then next year's intake.
function sessionChoices(sessions, current) {
  const now = current?.name ?? yearSessionName();
  const next = nextSessionName(now);
  const names = [...new Set([now, next, ...sessions.map((s) => s.name)])].sort().reverse();
  const m = new Date().getMonth();
  return { names, standard: m >= 9 || m < 3 ? next : now };
}

function classText(grades, code) {
  if (!code) return "";
  return grades.find((g) => g.code === code)?.label ?? gradeLabel(code);
}

// The shell every form here shares: a title, its steps, and Back and Next.
function StepForm({ title, sub, steps, step, setStep, stepOk, onClose, onDone, doneLabel, busy, error, children }) {
  const last = step === steps.length - 1;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal modal-lg add"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!stepOk[step]) return;
          if (last) onDone();
          else setStep(step + 1);
        }}
        aria-label={title}
      >
        <header className="ns-head">
          <div className="ns-title">
            <div>
              <h2>{title}</h2>
              {sub && <p className="row-sub">{sub}</p>}
            </div>
            <button type="button" className="btn-icon ns-close" onClick={onClose} aria-label="Close">
              <Icon name="x" size={18} />
            </button>
          </div>
          {steps.length > 1 && <StepBar steps={steps} step={step} onPick={setStep} canPick={(i) => i < step || stepOk.slice(0, i).every(Boolean)} />}
        </header>
        <div className="modal-body ns-body">
          {error && <p className="notice notice-error">{error}</p>}
          {children}
        </div>
        <footer className="modal-footer ns-foot">
          {step > 0 ? (
            <button type="button" className="btn btn-secondary" onClick={() => setStep(step - 1)}>
              <Icon name="arrowLeft" /> Back
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy || !stepOk[step]}>
            {last ? (busy ? "Saving…" : doneLabel) : "Next"}
            {!last && <Icon name="arrowRight" />}
          </button>
        </footer>
      </form>
    </div>
  );
}

// Stage 1: who, for which class, and when to follow up. Also edits one.
function EnquiryForm({ school, grades, sessions, current, me, record, onClose, onSaved }) {
  const { names, standard } = sessionChoices(sessions, current);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: record?.name ?? "",
    class_wanted: record?.class_wanted ?? "",
    session_name: record?.session_name ?? standard,
    parent_phone: record?.parent_phone ?? "",
    source: record?.source ?? "",
    follow_up: record?.follow_up ?? "",
    note: record?.note ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const stepOk = [Boolean(form.name.trim()), tenDigits(form.parent_phone) && Boolean(form.parent_phone.trim())];

  async function save() {
    setBusy(true);
    setError("");
    try {
      const fields = { ...blank(form), name: form.name.trim() };
      onSaved(record ? await updateAdmission(record.id, fields) : await addEnquiry(school.id, { ...fields, created_by: me }));
      onClose();
    } catch {
      setError("Couldn’t save. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <StepForm title={record ? "Edit enquiry" : "New enquiry"} steps={["Child", "Follow-up"]} step={step} setStep={setStep} stepOk={stepOk} onClose={onClose} onDone={save} doneLabel="Save" busy={busy} error={error}>
      {step === 0 ? (
        <div className="ns-grid">
          <label className="span-2">
            <span>Child’s name *</span>
            <input value={form.name} onChange={set("name")} maxLength={80} autoFocus required />
          </label>
          <label>
            <span>Class wanted</span>
            <select value={form.class_wanted} onChange={set("class_wanted")}>
              <option value="">Not sure yet</option>
              {grades.map((g) => (
                <option key={g.code} value={g.code}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>For session</span>
            <select value={form.session_name} onChange={set("session_name")}>
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <div className="ns-grid">
          <label>
            <span>Parent’s phone *</span>
            <input type="tel" inputMode="tel" value={form.parent_phone} onChange={set("parent_phone")} maxLength={15} autoFocus required />
            {!tenDigits(form.parent_phone) && <small className="field-error">Enter a 10-digit mobile number.</small>}
          </label>
          <label>
            <span>Follow up on</span>
            <input type="date" value={form.follow_up} onChange={set("follow_up")} />
          </label>
          <div className="field span-2">
            <span>How they heard of the school</span>
            <div className="choice-row">
              {SOURCES.map((s) => (
                <button type="button" key={s} className={`choice${form.source === s ? " on" : ""}`} onClick={() => setForm((f) => ({ ...f, source: f.source === s ? "" : s }))}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <label className="span-2">
            <span>Note</span>
            <input value={form.note} onChange={set("note")} maxLength={1000} />
          </label>
        </div>
      )}
    </StepForm>
  );
}

// Stage 2: the fuller details, documents and the registration fee.
function RegisterForm({ school, grades, record, onClose, onSaved }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: record.name ?? "",
    gender: record.gender ?? "",
    dob: record.dob ?? "",
    class_wanted: record.class_wanted ?? "",
    parent_name: record.parent_name ?? "",
    parent_phone: record.parent_phone ?? "",
    mother_name: record.mother_name ?? "",
    mother_phone: record.mother_phone ?? "",
    email: record.email ?? "",
    address: record.address ?? "",
    aadhaar_doc_path: record.aadhaar_doc_path ?? null,
    birth_cert_path: record.birth_cert_path ?? null,
    transfer_cert_path: record.transfer_cert_path ?? null,
  });
  const standardFee = Number(school.admission_fee) || 0;
  const [fee, setFee] = useState({ amount: standardFee ? String(standardFee) : "", method: "cash", reference: "", paid_on: dayKey() });
  const [docs, setDocs] = useState(() => Object.fromEntries(Object.entries(DOC_FIELD).filter(([, f]) => record[f]).map(([k]) => [k, { name: "Uploaded" }])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setPay = (k) => (e) => setFee((f) => ({ ...f, [k]: e.target.value }));
  const amount = Number(fee.amount) || 0;
  const stepOk = [Boolean(form.name.trim() && form.class_wanted), tenDigits(form.parent_phone) && tenDigits(form.mother_phone) && Boolean(form.parent_phone.trim()), true, amount >= 0 && (!amount || Boolean(fee.method))];

  async function pickDocument(kind, e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setDocs((d) => ({ ...d, [kind]: { name: file.name, busy: true } }));
    try {
      const path = await uploadStudentDocument(school.id, record.id, kind, file);
      setForm((f) => ({ ...f, [DOC_FIELD[kind]]: path }));
      setDocs((d) => ({ ...d, [kind]: { name: file.name } }));
    } catch {
      setDocs((d) => ({ ...d, [kind]: { name: file.name, error: "Couldn’t upload. Try a smaller photo or PDF." } }));
    }
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      await updateAdmission(record.id, { ...blank(form), name: form.name.trim(), gender: form.gender });
      onSaved(await registerAdmission(record.id, amount > 0 ? { fee: amount, method: fee.method, reference: fee.reference, paid_on: fee.paid_on } : { fee: 0 }));
      onClose();
    } catch {
      setError("Couldn’t register. Check your connection and try again.");
      setBusy(false);
    }
  }

  const uploading = Object.values(docs).some((d) => d.busy);
  return (
    <StepForm title={form.name.trim() || "Register"} sub="Registration" steps={["Child", "Family", "Documents", "Fee"]} step={step} setStep={setStep} stepOk={stepOk} onClose={onClose} onDone={save} doneLabel="Register" busy={busy || uploading} error={error}>
      {step === 0 && (
        <div className="ns-grid">
          <label className="span-2">
            <span>Child’s name *</span>
            <input value={form.name} onChange={set("name")} maxLength={80} required />
          </label>
          <label>
            <span>Class *</span>
            <select value={form.class_wanted} onChange={set("class_wanted")} required>
              <option value="">Pick a class</option>
              {grades.map((g) => (
                <option key={g.code} value={g.code}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Date of birth</span>
            <input type="date" value={form.dob} onChange={set("dob")} max={dayKey()} />
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
            <span>Father’s name</span>
            <input value={form.parent_name} onChange={set("parent_name")} maxLength={80} />
          </label>
          <label>
            <span>Father’s phone *</span>
            <input type="tel" inputMode="tel" value={form.parent_phone} onChange={set("parent_phone")} maxLength={15} required />
            {!tenDigits(form.parent_phone) && <small className="field-error">Enter a 10-digit mobile number.</small>}
          </label>
          <label>
            <span>Mother’s name</span>
            <input value={form.mother_name} onChange={set("mother_name")} maxLength={80} />
          </label>
          <label>
            <span>Mother’s phone</span>
            <input type="tel" inputMode="tel" value={form.mother_phone} onChange={set("mother_phone")} maxLength={15} />
            {!tenDigits(form.mother_phone) && <small className="field-error">Enter a 10-digit mobile number.</small>}
          </label>
          <label className="span-2">
            <span>Email</span>
            <input type="email" value={form.email} onChange={set("email")} maxLength={200} />
          </label>
        </div>
      )}
      {step === 2 && (
        <div className="ns-grid">
          <label className="span-2">
            <span>Home address</span>
            <input value={form.address} onChange={set("address")} maxLength={300} />
          </label>
          <div className="field-block span-2">
            <span className="field-label">Documents</span>
            <p className="row-sub">A photo or scan of each. All optional for now, and they carry over when the child is admitted.</p>
            <DocPicker label={DOC_NAME.birth_certificate} kind="birth_certificate" doc={docs.birth_certificate} onPick={pickDocument} />
            <DocPicker label={DOC_NAME.transfer_certificate} kind="transfer_certificate" doc={docs.transfer_certificate} onPick={pickDocument} />
            <DocPicker label={DOC_NAME.aadhaar} kind="aadhaar" doc={docs.aadhaar} onPick={pickDocument} />
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="ns-grid">
          <label>
            <span>Registration fee</span>
            <input type="number" inputMode="decimal" min="0" value={fee.amount} onChange={setPay("amount")} placeholder="0" autoFocus />
          </label>
          <label>
            <span>Paid on</span>
            <input type="date" value={fee.paid_on} onChange={setPay("paid_on")} max={dayKey()} disabled={!amount} />
          </label>
          <div className="field span-2">
            <span>Paid by</span>
            <div className="choice-row">
              {PAY_MODES.map((m) => (
                <button type="button" key={m} className={`choice${fee.method === m ? " on" : ""}`} disabled={!amount} onClick={() => setFee((f) => ({ ...f, method: m }))}>
                  {METHODS[m]}
                </button>
              ))}
            </div>
          </div>
          <label className="span-2">
            <span>Reference</span>
            <input value={fee.reference} onChange={setPay("reference")} maxLength={80} disabled={!amount} placeholder="UPI or cheque number" />
          </label>
          <p className="row-sub span-2">{amount ? (school.admission_fee_mode === "adjust" ? "This counts towards the child’s fees once admitted." : "This is kept separate from the child’s fees.") : "No fee: the child is registered without a receipt."}</p>
        </div>
      )}
    </StepForm>
  );
}

// The school's choices: the registration fee, the optional test, and seats.
function SettingsForm({ school, grades, onClose, onSchoolSaved, onGradesSaved }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ mode: school.admission_fee_mode ?? "separate", fee: school.admission_fee ?? "", test: Boolean(school.admission_test) });
  const [seats, setSeats] = useState(() => Object.fromEntries(grades.map((g) => [g.code, g.seats ?? ""])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    try {
      const saved = await saveAdmissionSettings(school.id, { mode: form.mode, fee: form.fee === "" ? null : Number(form.fee), test: form.test });
      await saveGradeSeats(school.id, seats);
      onSchoolSaved?.(saved);
      onGradesSaved?.();
      onClose();
    } catch {
      setError("Couldn’t save. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <StepForm title="Admission settings" steps={["Registration", "Seats"]} step={step} setStep={setStep} stepOk={[Number(form.fee || 0) >= 0, true]} onClose={onClose} onDone={save} doneLabel="Save" busy={busy} error={error}>
      {step === 0 ? (
        <div className="ns-grid">
          <label className="span-2">
            <span>Usual registration fee</span>
            <input type="number" inputMode="decimal" min="0" value={form.fee} onChange={(e) => setForm((f) => ({ ...f, fee: e.target.value }))} placeholder="0" />
          </label>
          <div className="field span-2">
            <span>The registration fee is</span>
            <div className="choice-row">
              {[
                ["separate", "Kept separate"],
                ["adjust", "Counted towards fees"],
              ].map(([v, l]) => (
                <button type="button" key={v} className={`choice${form.mode === v ? " on" : ""}`} onClick={() => setForm((f) => ({ ...f, mode: v }))}>
                  {l}
                </button>
              ))}
            </div>
            <small className="row-sub">{form.mode === "adjust" ? "Once admitted, it reduces what the child owes, under the same receipt." : "It stays apart from the child’s fees and reports."} Registrations already taken don’t change.</small>
          </div>
          <label className="adm-check span-2">
            <input type="checkbox" checked={form.test} onChange={(e) => setForm((f) => ({ ...f, test: e.target.checked }))} />
            <span>We hold a test or interview before admission</span>
          </label>
        </div>
      ) : (
        <div className="ns-grid">
          <p className="row-sub span-2">Seats per class. You’ll see a warning when a class is full, and can still admit. Leave blank if you don’t track seats.</p>
          {grades.map((g) => (
            <label key={g.code}>
              <span>{g.label}</span>
              <input type="number" inputMode="numeric" min="1" max="5000" value={seats[g.code]} onChange={(e) => setSeats((s) => ({ ...s, [g.code]: e.target.value }))} />
            </label>
          ))}
        </div>
      )}
    </StepForm>
  );
}

// One child: what's known, and the next step.
function Details({ record: a, school, grades, sessions, current, readOnly, onClose, onChanged, onEdit, onRegister, onAdmit, onDeleted, onOpenStudent }) {
  const [losing, setLosing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [receipt, setReceipt] = useState(false);
  const [error, setError] = useState("");
  const [left, setLeft] = useState(null); // seats note when admitting
  const klass = classText(grades, a.class_wanted);
  const seats = grades.find((g) => g.code === a.class_wanted)?.seats;
  // Next year's intake may have no session yet: then nobody has taken a seat
  const sessionId = a.session_name ? sessions.find((s) => s.name === a.session_name)?.id : current?.id;

  useEffect(() => {
    if (a.stage !== "registered" || !seats) return setLeft(null);
    if (!sessionId) return setLeft(seats);
    let live = true;
    seatsTaken(sessionId).then(
      (taken) => live && setLeft(seats - (taken.get(a.class_wanted) ?? 0)),
      () => live && setLeft(null)
    );
    return () => {
      live = false;
    };
  }, [a.stage, a.class_wanted, seats, sessionId]);

  const change = async (fields) => {
    setError("");
    try {
      onChanged(await updateAdmission(a.id, fields));
    } catch {
      setError("Couldn’t save that. Check your connection.");
    }
  };
  const openDoc = async (path) => {
    try {
      window.open(await studentDocumentUrl(path), "_blank", "noopener");
    } catch {
      setError("Couldn’t open that document.");
    }
  };

  const facts = [
    ["Class", klass],
    ["Session", a.session_name],
    ["Registration no.", a.registration_no],
    ["Date of birth", shortDate(a.dob)],
    ["Father", a.parent_name],
    ["Mother", a.mother_name],
    ["Mother’s phone", a.mother_phone],
    ["Email", a.email],
    ["Address", a.address],
    ["Heard through", a.source],
    ["Registered", shortDate(a.registered_on)],
    ["Admitted", shortDate(a.admitted_on)],
    ["Why not joining", a.lost_reason],
  ].filter(([, v]) => v);
  const docs = Object.entries(DOC_FIELD).filter(([, f]) => a[f]);
  const canAct = !readOnly;
  const inPlay = a.stage === "enquiry" || a.stage === "registered";

  return (
    <>
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal adm-sheet" role="dialog" aria-modal="true" aria-label={a.name} onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>{a.name}</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="modal-body adm-body">
          {error && <p className="notice notice-error">{error}</p>}
          {a.parent_phone && (
            <a className="adm-call" href={`tel:${a.parent_phone}`}>
              <Icon name="phone" size={16} /> {a.parent_phone}
            </a>
          )}
          <dl className="adm-facts">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>

          {a.fee > 0 && (
            <p className="adm-fee">
              <strong>{rupees(a.fee)}</strong> registration fee · {METHODS[a.fee_method]} · {a.fee_mode === "adjust" ? "counts towards fees" : "kept separate"}
            </p>
          )}

          {docs.length > 0 && (
            <div className="adm-docs">
              {docs.map(([kind, field]) =>
                canAct ? (
                  <button type="button" key={kind} className="link-btn" onClick={() => openDoc(a[field])}>
                    <Icon name="file" size={14} /> {DOC_NAME[kind]}
                  </button>
                ) : (
                  <span key={kind} className="row-sub">
                    {DOC_NAME[kind]}
                  </span>
                )
              )}
            </div>
          )}

          {inPlay && canAct && (
            <div className="ns-grid adm-fields">
              <label>
                <span>Follow up on</span>
                <input type="date" value={a.follow_up ?? ""} onChange={(e) => change({ follow_up: e.target.value || null })} />
              </label>
              {a.stage === "registered" && school.admission_test && (
                <>
                  <label>
                    <span>Test or interview on</span>
                    <input type="date" value={a.test_on ?? ""} onChange={(e) => change({ test_on: e.target.value || null })} />
                  </label>
                  <label>
                    <span>Result</span>
                    <select value={a.test_result ?? ""} onChange={(e) => change({ test_result: e.target.value || null })}>
                      <option value="">Not yet</option>
                      <option value="passed">Passed</option>
                      <option value="not_selected">Not selected</option>
                    </select>
                  </label>
                </>
              )}
              <label className="span-2">
                <span>Note</span>
                <input defaultValue={a.note ?? ""} maxLength={1000} onBlur={(e) => e.target.value !== (a.note ?? "") && change({ note: e.target.value || null })} />
              </label>
            </div>
          )}
          {readOnly && a.note && <p className="row-sub">{a.note}</p>}

          {a.stage === "registered" && left !== null && canAct && <p className={`adm-seats${left <= 0 ? " is-full" : ""}`}>{left <= 0 ? `${klass} is full (${seats} seats). You can still admit.` : `${left} of ${seats} seats left in ${klass}.`}</p>}

          {losing && (
            <div className="adm-lost">
              <strong>Why isn’t the child joining?</strong>
              <div className="choice-row">
                {LOST_REASONS.map((r) => (
                  <button type="button" key={r} className="choice" onClick={() => (setLosing(false), change({ stage: "lost", lost_reason: r, lost_from: a.stage, follow_up: null }))}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {(canAct || a.fee > 0) && (
          <footer className="modal-footer adm-foot">
            {canAct && inPlay && !losing && (
              <button type="button" className="link-btn adm-foot-start" onClick={() => setLosing(true)}>
                Not joining
              </button>
            )}
            {canAct && a.stage === "lost" &&
              (asking ? (
                <span className="ft-confirm adm-foot-start">
                  <span>Delete for good?</span>
                  <button type="button" className="link-btn link-danger" onClick={() => onDeleted(a)}>
                    Delete
                  </button>
                  <button type="button" className="link-btn" onClick={() => setAsking(false)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" className="link-btn adm-foot-start" onClick={() => setAsking(true)}>
                  Delete
                </button>
              ))}
            {a.fee > 0 && (
              <button type="button" className="btn btn-secondary" onClick={() => setReceipt(true)}>
                Receipt
              </button>
            )}
            {canAct && a.stage === "enquiry" && (
              <>
                <button type="button" className="btn btn-secondary" onClick={onEdit}>
                  Edit
                </button>
                <button type="button" className="btn btn-primary" onClick={onRegister}>
                  Register <Icon name="arrowRight" />
                </button>
              </>
            )}
            {canAct && a.stage === "registered" && (
              <button type="button" className="btn btn-primary" onClick={onAdmit}>
                Admit <Icon name="arrowRight" />
              </button>
            )}
            {canAct && a.stage === "lost" && (
              <button type="button" className="btn btn-primary" onClick={() => change({ stage: a.lost_from ?? "enquiry", lost_reason: null, lost_from: null })}>
                Reopen
              </button>
            )}
            {a.stage === "admitted" && a.session_name === current?.name && (
              <button type="button" className="btn btn-primary" onClick={() => onOpenStudent(a.id)}>
                Open student <Icon name="arrowRight" />
              </button>
            )}
          </footer>
        )}
      </section>
    </div>
      {/* Outside the backdrop, or closing the receipt would close this too */}
      {receipt && (
        <Receipt
          school={school}
          person={{ name: a.name, admission_no: a.registration_no, class: a.class_wanted, section: "" }}
          idLabel="Registration no."
          payment={{ receipt_no: a.fee_receipt_no, paid_on: a.fee_paid_on, method: a.fee_method, reference: a.fee_reference, amount: a.fee, status: "success", allocations: [{ invoice_id: "registration", amount: a.fee }] }}
          dues={[{ id: "registration", head_name: "Registration fee", label: a.session_name ?? "" }]}
          onClose={() => setReceipt(false)}
        />
      )}
    </>
  );
}

export default function AdmissionsPage({ school, grades, sessions, current, students, routes, me, readOnly = false, view, onView, addAt = 0, onSchoolSaved, onGradesSaved, onSessionsChanged, onAdmitted, onOpenStudent }) {
  const key = `admissions:${school.id}`;
  const [rows, setRows] = useState(() => peek(key) ?? null);
  const [loadError, setLoadError] = useState(false);
  const [find, setFind] = useState("");
  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState(null); // "enquiry", "edit", "register", "admit" or "settings"
  const [error, setError] = useState("");

  useEffect(() => {
    swr(key, () => listAdmissions(school.id), (r) => (setRows(r), setLoadError(false))).catch(() => setLoadError(true));
  }, [key, school.id]);
  useEffect(() => {
    if (addAt && !readOnly) setForm("enquiry");
  }, [addAt, readOnly]);

  const put = (saved) =>
    setRows((list) => {
      const next = (list ?? []).some((x) => x.id === saved.id) ? list.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...(list ?? [])];
      remember(key, next);
      return next;
    });

  const today = dayKey();
  const counts = useMemo(() => Object.fromEntries(STAGES.map(([k]) => [k, (rows ?? []).filter((r) => r.stage === k).length])), [rows]);
  const q = find.trim().toLowerCase();
  const shown = useMemo(() => {
    const list = (rows ?? []).filter((r) => r.stage === view && (!q || `${r.name} ${r.parent_phone ?? ""} ${r.registration_no ?? ""} ${r.parent_name ?? ""}`.toLowerCase().includes(q)));
    if (view === "admitted" || view === "lost") return list;
    // What needs doing first: the oldest follow-up, then those with none
    return [...list].sort((a, b) => (a.follow_up ?? "9999").localeCompare(b.follow_up ?? "9999"));
  }, [rows, view, q]);
  const open = (rows ?? []).find((r) => r.id === openId) ?? null;

  async function remove(a) {
    setError("");
    try {
      await deleteAdmission(a);
      setRows((list) => {
        const next = (list ?? []).filter((x) => x.id !== a.id);
        remember(key, next);
        return next;
      });
      setOpenId(null);
    } catch {
      setError("Couldn’t delete that. Check your connection.");
    }
  }

  // The student is created first, then this is marked admitted. If that second
  // step fails, trying again finds the student and just finishes.
  async function admit(a, record) {
    const name = a.session_name ?? current?.name ?? yearSessionName();
    const sessionId = await ensureSession(school.id, name);
    onSessionsChanged?.();
    if (!(await admissionStudentExists(a.id))) await addStudent(school.id, sessionId, record);
    put(await finishAdmission(a.id));
    onAdmitted?.();
    setOpenId(null);
    onView("admitted");
  }

  const title = STAGES.find(([k]) => k === view)?.[1] ?? "Admissions";
  return (
    <div className="adm">
      <div className="page-header">
        <h1 className="page-title">{title}</h1>
        {!readOnly && (
          <div className="page-actions">
            <button className="btn btn-secondary" onClick={() => setForm("settings")} aria-label="Admission settings" title="Admission settings">
              <Icon name="settings" />
            </button>
            <button className="btn btn-primary" onClick={() => setForm("enquiry")}>
              <Icon name="plus" /> New enquiry
            </button>
          </div>
        )}
      </div>

      <div className="adm-tools">
        <div className="segmented segmented-sm adm-filter" role="group" aria-label="Stage">
          {STAGES.map(([k, label]) => (
            <button key={k} type="button" className={view === k ? "active" : ""} aria-pressed={view === k} onClick={() => onView(k)}>
              {label}
              {counts[k] > 0 && <span className="adm-count">{counts[k]}</span>}
            </button>
          ))}
        </div>
        <label className="search adm-search">
          <Icon name="search" />
          <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Name, phone or registration no." aria-label="Search admissions" />
        </label>
      </div>

      {error && <p className="notice notice-error">{error}</p>}
      {loadError && rows === null && <p className="notice notice-error">Couldn’t load admissions. Reload to try again.</p>}
      {rows === null && !loadError && <div className="card card-skeleton" aria-busy="true" />}

      {rows !== null && shown.length === 0 && <p className="row-sub adm-empty">{q ? `Nothing matches “${find}”.` : view === "enquiry" ? "No enquiries yet. Add one when a parent calls or walks in." : `Nobody in ${title.toLowerCase()} yet.`}</p>}

      {shown.length > 0 && (
        <ul className="adm-list">
          {shown.map((a) => {
            const late = a.follow_up && a.follow_up < today;
            const due = a.follow_up === today;
            return (
              <li key={a.id}>
                <button type="button" onClick={() => setOpenId(a.id)}>
                  <span className="inbox-main">
                    <strong>{a.name}</strong>
                    <span className="row-sub">{[classText(grades, a.class_wanted), a.session_name, a.registration_no, a.parent_phone].filter(Boolean).join(" · ")}</span>
                  </span>
                  {a.stage === "lost" && a.lost_reason && <span className="badge badge-neutral">{a.lost_reason}</span>}
                  {a.stage === "registered" && a.test_result && <span className={`badge ${a.test_result === "passed" ? "badge-success" : "badge-warning"}`}>{a.test_result === "passed" ? "Passed" : "Not selected"}</span>}
                  {a.follow_up && <span className={`badge ${late ? "badge-danger" : due ? "badge-warning" : "badge-neutral"}`}>{late ? `Follow up was ${shortDate(a.follow_up)}` : due ? "Follow up today" : `Follow up ${shortDate(a.follow_up)}`}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {open && !["register", "edit", "admit"].includes(form) && (
        <Details
          record={open}
          school={school}
          grades={grades}
          sessions={sessions}
          current={current}
          readOnly={readOnly}
          onClose={() => setOpenId(null)}
          onChanged={put}
          onEdit={() => setForm("edit")}
          onRegister={() => setForm("register")}
          onAdmit={() => setForm("admit")}
          onDeleted={remove}
          onOpenStudent={onOpenStudent}
        />
      )}
      {form === "enquiry" && <EnquiryForm school={school} grades={grades} sessions={sessions} current={current} me={me} onClose={() => setForm(null)} onSaved={(saved) => (put(saved), onView("enquiry"))} />}
      {form === "edit" && open && <EnquiryForm school={school} grades={grades} sessions={sessions} current={current} me={me} record={open} onClose={() => setForm(null)} onSaved={put} />}
      {form === "register" && open && <RegisterForm school={school} grades={grades} record={open} onClose={() => setForm(null)} onSaved={(saved) => (put(saved), setOpenId(null), onView("registered"))} />}
      {form === "settings" && <SettingsForm school={school} grades={grades} onClose={() => setForm(null)} onSchoolSaved={onSchoolSaved} onGradesSaved={onGradesSaved} />}
      {form === "admit" && open && (
        <AddModal
          mode="students"
          schoolId={school.id}
          grades={grades}
          routes={routes}
          students={students}
          saveLabel="Admit"
          initial={{
            id: open.id,
            form: {
              name: open.name,
              gender: open.gender || "",
              ...(open.dob ? { dob: open.dob } : {}),
              class: open.class_wanted ?? "",
              parent_name: open.parent_name ?? "",
              mother_name: open.mother_name ?? "",
              parent_phone: open.parent_phone ?? "",
              mother_phone: open.mother_phone ?? "",
              email: open.email ?? "",
              aadhaar_doc_path: open.aadhaar_doc_path ?? undefined,
              birth_cert_path: open.birth_cert_path ?? undefined,
              transfer_cert_path: open.transfer_cert_path ?? undefined,
            },
            home: open.address ? { address: open.address } : null,
            docs: Object.fromEntries(Object.entries(DOC_FIELD).filter(([, f]) => open[f]).map(([k]) => [k, { name: "Uploaded" }])),
          }}
          onClose={() => setForm(null)}
          onSave={(record) => admit(open, record)}
        />
      )}
    </div>
  );
}
