import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { attendanceTotals, cancelCertificate, issueCertificate, listCertificates, listFeeHeads, listSchoolCertificates, listSessions, logoUrl, markStudentLeft, studentLedger } from "../data/api.js";
import { amountInWords, rupees } from "../data/money.js";
import { gradeLabel } from "./PersonCard.jsx";
import Icon from "./Icon.jsx";
import { StepBar } from "./Steps.jsx";
import { CERT_KINDS } from "../data/certKinds.js";

// A student's certificates: issue one, and see or reprint what was issued. Each
// is previewed first, gets its serial number when issued, and keeps what it said
// then, so a reprint matches the original. Owners and admins only.

const KINDS = CERT_KINDS;
const TITLE = {
  bonafide: "Bona Fide Certificate",
  slc: "School Leaving Certificate",
  no_dues: "No Dues Certificate",
  character: "Character Certificate",
  fee_paid: "Fee Paid Certificate",
  dob: "Date of Birth Certificate",
};
const PURPOSES = ["School records", "Bank account", "Passport", "Scholarship", "Government scheme"];
const CONDUCT = ["Good", "Very good", "Excellent", "Satisfactory"];
const REASONS = ["Parent’s request", "Moving to another city", "Completed the highest class", "Joining another school", "Other"];
const PROMOTION = ["Yes", "No", "As per result", "Not applicable"];

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shortDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "");

const ORDINAL = ["", "First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth", "Eleventh", "Twelfth", "Thirteenth", "Fourteenth", "Fifteenth", "Sixteenth", "Seventeenth", "Eighteenth", "Nineteenth", "Twentieth", "Twenty First", "Twenty Second", "Twenty Third", "Twenty Fourth", "Twenty Fifth", "Twenty Sixth", "Twenty Seventh", "Twenty Eighth", "Twenty Ninth", "Thirtieth", "Thirty First"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const under100 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`);
const yearWords = (y) => (y >= 2000 ? `Two Thousand${y % 100 ? ` ${under100(y % 100)}` : ""}` : `${under100(Math.floor(y / 100))} ${y % 100 ? under100(y % 100) : "Hundred"}`);
// "2015-03-12": "Twelfth March Two Thousand Fifteen"
export function dateInWords(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return `${ORDINAL[d]} ${MONTHS[m - 1]} ${yearWords(y)}`;
}

const relation = (gender) => (gender === "M" ? "son" : gender === "F" ? "daughter" : "ward");
const parents = (d) => [d.father && `Mr. ${d.father}`, d.mother && `Mrs. ${d.mother}`].filter(Boolean).join(" and ");

// What the student's record says now, frozen into the certificate.
const snapshot = (p, sessionName) => ({
  name: p.name,
  father: p.parent_name || "",
  mother: p.mother_name || "",
  gender: p.gender || "",
  dob: p.dob || "",
  admission_no: p.admission_no || "",
  srn: p.srn || "",
  category: p.category || "",
  admission_date: p.admission_date || "",
  class_label: gradeLabel(p.class) || "",
  section: p.section || "",
  session: sessionName || "",
});

function Sentence({ kind, d, issuedOn }) {
  const who = (
    <>
      <strong>{d.name}</strong>
      {parents(d) ? `, ${relation(d.gender)} of ${parents(d)},` : ""}
    </>
  );
  const klass = [d.class_label, d.section].filter(Boolean).join(" ");
  const adm = d.admission_no ? ` (Admission no. ${d.admission_no})` : "";
  const dob = d.dob ? `${shortDate(d.dob)} (${dateInWords(d.dob)})` : "";
  if (kind === "bonafide")
    return (
      <>
        <p>
          This is to certify that {who} is a bona fide student of this school{adm}, studying in {klass || "this school"}
          {d.session ? ` during the academic session ${d.session}` : ""}.
        </p>
        {dob && <p>According to the school’s records, the date of birth of the student is {dob}.</p>}
        {d.purpose && <p>This certificate is issued for the purpose of: {d.purpose}.</p>}
      </>
    );
  if (kind === "no_dues")
    return (
      <>
        <p>
          This is to certify that {who} a student of this school{adm}
          {klass ? ` in ${klass}` : ""}, has no fees outstanding to the school as on {shortDate(issuedOn)}.
        </p>
        {d.purpose && <p>This certificate is issued for the purpose of: {d.purpose}.</p>}
      </>
    );
  if (kind === "character")
    return (
      <>
        <p>
          This is to certify that {who} {d.left ? "was" : "is"} a student of this school{adm}
          {d.from ? ` from ${shortDate(d.from)}` : ""}
          {d.to ? ` to ${shortDate(d.to)}` : ""}
          {klass ? `, ${d.left ? "last studying" : "studying"} in ${klass}` : ""}.
        </p>
        <p>
          To the best of our knowledge, the student’s conduct and character have been <strong>{String(d.conduct || "Good").toLowerCase()}</strong> during this time.
        </p>
      </>
    );
  if (kind === "dob")
    return (
      <>
        <p>
          This is to certify that according to the school’s admission records, the date of birth of {who} a student of this school{adm}, is <strong>{dob}</strong>.
        </p>
        {d.purpose && <p>This certificate is issued for the purpose of: {d.purpose}.</p>}
      </>
    );
  if (kind === "fee_paid")
    return (
      <>
        <p>
          This is to certify that {who} a student of this school{adm}
          {klass ? ` in ${klass}` : ""}, has paid the following fees for the academic session {d.session}.
        </p>
        <table className="receipt-lines">
          <thead>
            <tr>
              <th>Fee</th>
              <th>Amount paid</th>
            </tr>
          </thead>
          <tbody>
            {(d.lines ?? []).map(([label, amount]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{rupees(amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>Total</th>
              <th>{rupees(d.total)}</th>
            </tr>
          </tfoot>
        </table>
        <p className="row-sub">{amountInWords(d.total)}</p>
        {d.purpose && <p>This certificate is issued for the purpose of: {d.purpose}.</p>}
      </>
    );
  return null;
}

// The numbered form most boards use. Anything not recorded prints as a line to
// fill in by hand.
function LeavingRows({ d, issuedOn }) {
  const rows = [
    ["Name of the student", d.name],
    ["Mother’s name", d.mother],
    ["Father’s name", d.father],
    ["Admission no.", d.admission_no],
    ["Student registration no.", d.srn],
    ["Nationality", d.nationality],
    ["Category", d.category],
    ["Date of birth", d.dob && `${shortDate(d.dob)} (${dateInWords(d.dob)})`],
    ["Date of admission", shortDate(d.admission_date)],
    ["Class last studied", [d.class_label, d.section].filter(Boolean).join(" ")],
    ["Subjects studied", d.subjects],
    ["Qualified for promotion", d.promotion],
    ["Working days in the session", d.working_days],
    ["Days present", d.days_present],
    ["School dues", d.dues],
    ["General conduct", d.conduct],
    ["Date of leaving", shortDate(d.left_on)],
    ["Reason for leaving", d.reason],
    ["Remarks", d.remarks],
    ["Date of issue", shortDate(issuedOn)],
  ];
  return (
    <ol className="cert-rows">
      {rows.map(([k, v]) => (
        <li key={k}>
          <span>{k}</span>
          <strong className={v === "" || v == null ? "is-blank" : ""}>{v === "" || v == null ? " " : v}</strong>
        </li>
      ))}
    </ol>
  );
}

function CertificatePage({ school, kind, serial, duplicate, details, issuedOn, cancelled, preview }) {
  const address = [school.address, school.city, school.state, school.pincode].filter(Boolean).join(", ");
  const ids = [school.board, school.affiliation_no && `Affiliation no. ${school.affiliation_no}`, school.udise_code && `UDISE ${school.udise_code}`].filter(Boolean).join(" · ");
  const mark = cancelled ? "CANCELLED" : preview ? "PREVIEW" : null;
  return (
    <article className={`receipt cert${mark ? " has-mark" : ""}`} data-mark={mark ?? undefined}>
      <header className="receipt-head cert-head">
        {school.logo_path && <img src={logoUrl(school.logo_path)} alt="" />}
        <div>
          <h2>{school.name}</h2>
          {address && <p>{address}</p>}
          {(school.phone || school.email) && <p>{[school.phone, school.email].filter(Boolean).join(" · ")}</p>}
          {ids && <p>{ids}</p>}
        </div>
      </header>
      <h3 className="cert-title">
        {TITLE[kind]}
        {duplicate ? " (Duplicate)" : ""}
      </h3>
      <p className="cert-meta">
        <span>No. {serial || "given when issued"}</span>
        <span>Date: {shortDate(issuedOn)}</span>
      </p>
      <div className="cert-body">{kind === "slc" ? <LeavingRows d={details} issuedOn={issuedOn} /> : <Sentence kind={kind} d={details} issuedOn={issuedOn} />}</div>
      <footer className="cert-sign">
        <span>Prepared by</span>
        <span>School seal</span>
        <span>
          {school.principal_name && <strong>{school.principal_name}</strong>}
          Principal
        </span>
      </footer>
    </article>
  );
}

// Issued: print it, or cancel it. Rendered into <body> so printing drops the rest.
export function CertificateView({ school, cert, onClose, onCancelled, onReissued, canCancel }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // The same details again, with a new number, marked as a duplicate
  const reissue = async () => {
    setError("");
    try {
      onReissued(await issueCertificate(cert.student_id, cert.kind, cert.details, dayKey()));
    } catch {
      setError("Couldn’t issue a duplicate. Check your connection.");
    }
  };
  const cancel = async () => {
    setError("");
    try {
      onCancelled(await cancelCertificate(cert.id, reason));
      setAsking(false);
    } catch {
      setError("Couldn’t cancel it. Check your connection.");
    }
  };
  return createPortal(
    <div className="modal-backdrop receipt-backdrop" onClick={(e) => (e.stopPropagation(), onClose())}>
      <section className="modal receipt-modal cert-modal" onClick={(e) => e.stopPropagation()} aria-label={TITLE[cert.kind]}>
        <div className="receipt-tools no-print">
          {canCancel && !cert.cancelled_at && !asking && (
            <button className="link-btn cert-cancel" onClick={() => setAsking(true)}>
              Cancel this certificate
            </button>
          )}
          {canCancel && cert.kind === "slc" && !cert.cancelled_at && !asking && onReissued && (
            <button className="btn btn-secondary btn-sm" onClick={reissue}>
              Issue a duplicate
            </button>
          )}
          {!cert.cancelled_at && (
            <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
              <Icon name="file" /> Print / Save PDF
            </button>
          )}
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>
        {error && <p className="notice notice-error no-print">{error}</p>}
        {asking && (
          <div className="cert-asking no-print">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Why is it being cancelled?" aria-label="Reason" autoFocus />
            <button className="btn btn-danger btn-sm" disabled={!reason.trim()} onClick={cancel}>
              Cancel it
            </button>
            <button className="link-btn" onClick={() => setAsking(false)}>
              Keep it
            </button>
          </div>
        )}
        {cert.cancelled_at && <p className="notice notice-error no-print">Cancelled{cert.cancel_reason ? `: ${cert.cancel_reason}` : ""}. It stays in the register and can’t be printed.</p>}
        <CertificatePage school={school} kind={cert.kind} serial={cert.serial_no} duplicate={cert.is_duplicate} details={cert.details} issuedOn={cert.issued_on} cancelled={Boolean(cert.cancelled_at)} />
      </section>
    </div>,
    document.body
  );
}

function Purpose({ value, onChange }) {
  const custom = value && !PURPOSES.includes(value);
  return (
    <div className="field span-2">
      <span>Purpose</span>
      <div className="choice-row">
        {PURPOSES.map((p) => (
          <button type="button" key={p} className={`choice${value === p ? " on" : ""}`} onClick={() => onChange(value === p ? "" : p)}>
            {p}
          </button>
        ))}
      </div>
      <input value={custom ? value : ""} onChange={(e) => onChange(e.target.value)} maxLength={120} placeholder="Or type another purpose" aria-label="Another purpose" />
    </div>
  );
}

// Fill in, preview, issue.
function IssueForm({ kind, school, person, sessions, sessionId, onClose, onIssued }) {
  const session = sessions.find((s) => s.id === sessionId) ?? sessions[0];
  const isLeft = person.status === "left";
  const [step, setStep] = useState(0);
  const [issuedOn, setIssuedOn] = useState(dayKey());
  const [extra, setExtra] = useState({
    purpose: "",
    conduct: "Good",
    from: person.admission_date || "",
    to: person.left_as_of || "",
    left: isLeft,
    session_id: session?.id ?? "",
    nationality: "Indian",
    subjects: "",
    promotion: "As per result",
    working_days: "",
    days_present: "",
    left_on: person.left_as_of || dayKey(),
    reason: "",
    remarks: "",
    mark_left: !isLeft,
  });
  const [money, setMoney] = useState(null); // { due, later, lines, total }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setExtra((f) => ({ ...f, [k]: e.target.value }));
  const put = (k, v) => setExtra((f) => ({ ...f, [k]: v }));
  const pickedSession = sessions.find((s) => s.id === extra.session_id);

  // What's owed, and what was paid in the chosen session
  useEffect(() => {
    if (!["no_dues", "slc", "fee_paid"].includes(kind)) return;
    let live = true;
    Promise.all([studentLedger(person.id), listFeeHeads(school.id)]).then(
      ([{ dues, payments }, heads]) => {
        if (!live) return;
        const headName = new Map(heads.map((h) => [h.id, h.name]));
        const today = dayKey();
        const open = dues.filter((d) => Number(d.balance) > 0);
        const due = open.filter((d) => (d.due_date ?? today) <= today).reduce((t, d) => t + Number(d.balance), 0);
        const later = open.filter((d) => (d.due_date ?? today) > today).reduce((t, d) => t + Number(d.balance), 0);
        const inSession = new Map(dues.filter((d) => d.session_id === extra.session_id).map((d) => [d.id, d]));
        const byHead = new Map();
        for (const p of payments) {
          if (p.status !== "success") continue;
          for (const a of p.allocations ?? []) {
            const d = inSession.get(a.invoice_id);
            if (!d) continue;
            const name = headName.get(d.head_id) ?? "Fee";
            byHead.set(name, (byHead.get(name) ?? 0) + Number(a.amount));
          }
        }
        const lines = [...byHead.entries()];
        setMoney({ due, later, lines, total: lines.reduce((t, [, v]) => t + v, 0) });
      },
      () => live && setMoney({ failed: true })
    );
    return () => {
      live = false;
    };
  }, [kind, person.id, school.id, extra.session_id]);

  // The leaving certificate fills in attendance from the register
  useEffect(() => {
    if (kind !== "slc" || !sessionId) return;
    let live = true;
    attendanceTotals(person.id, sessionId).then(
      ({ working, present }) => live && working > 0 && setExtra((f) => ({ ...f, working_days: f.working_days || String(working), days_present: f.days_present || String(present) })),
      () => {}
    );
    return () => {
      live = false;
    };
  }, [kind, person.id, sessionId]);

  const steps = kind === "slc" ? ["School record", "Leaving", "Preview"] : ["Details", "Preview"];
  const previewing = step === steps.length - 1;
  const blocked = kind === "no_dues" && money && (money.failed || money.due > 0);
  const stepOk = kind === "slc" ? [true, Boolean(extra.left_on && extra.reason), true] : [kind === "fee_paid" ? Boolean(money && !money.failed && money.total > 0) : kind === "no_dues" ? Boolean(money && !blocked) : true, true];

  const details = useMemo(() => {
    const base = snapshot(person, kind === "fee_paid" ? pickedSession?.name : session?.name);
    if (kind === "bonafide" || kind === "no_dues" || kind === "dob") return { ...base, purpose: extra.purpose };
    if (kind === "character") return { ...base, conduct: extra.conduct, from: extra.from, to: extra.left ? extra.to : "", left: extra.left };
    if (kind === "fee_paid") return { ...base, purpose: extra.purpose, lines: money?.lines ?? [], total: money?.total ?? 0 };
    const dues = !money || money.failed ? "" : money.due > 0 ? `${rupees(money.due)} due as on ${shortDate(issuedOn)}` : "All dues paid";
    return {
      ...base,
      nationality: extra.nationality,
      subjects: extra.subjects,
      promotion: extra.promotion,
      working_days: extra.working_days,
      days_present: extra.days_present,
      dues,
      conduct: extra.conduct,
      left_on: extra.left_on,
      reason: extra.reason,
      remarks: extra.remarks,
    };
  }, [kind, person, session, pickedSession, extra, money, issuedOn]);

  async function issue() {
    setBusy(true);
    setError("");
    try {
      const saved = await issueCertificate(person.id, kind, details, kind === "no_dues" ? dayKey() : issuedOn);
      let leftChanges = null;
      if (kind === "slc" && extra.mark_left && !isLeft) {
        try {
          leftChanges = await markStudentLeft(person.id, sessionId, extra.left_on);
        } catch {
          setError("The certificate was issued, but the student couldn’t be marked as left. Do that from their page.");
        }
      }
      onIssued(saved, leftChanges);
    } catch (err) {
      setError(/dues pending/.test(err?.message ?? "") ? "This student has dues pending, so a no dues certificate can’t be issued." : "Couldn’t issue it. Check your connection and try again.");
      setBusy(false);
    }
  }

  const date = (
    <label>
      <span>Date of issue</span>
      <input type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} max={dayKey()} />
    </label>
  );

  return createPortal(
    <div className="modal-backdrop" onClick={(e) => (e.stopPropagation(), onClose())}>
      <form
        className={`modal modal-lg add${previewing ? " cert-previewing" : ""}`}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!stepOk[step]) return;
          if (previewing) issue();
          else setStep(step + 1);
        }}
        aria-label={TITLE[kind]}
      >
        <header className="ns-head">
          <div className="ns-title">
            <div>
              <h2>{TITLE[kind]}</h2>
              <p className="row-sub">{person.name}</p>
            </div>
            <button type="button" className="btn-icon ns-close" onClick={onClose} aria-label="Close">
              <Icon name="x" size={18} />
            </button>
          </div>
          <StepBar steps={steps} step={step} onPick={setStep} canPick={(i) => i < step || stepOk.slice(0, i).every(Boolean)} />
        </header>
        <div className="modal-body ns-body">
          {error && <p className="notice notice-error">{error}</p>}

          {previewing && <CertificatePage school={school} kind={kind} duplicate={false} details={details} issuedOn={kind === "no_dues" ? dayKey() : issuedOn} preview />}

          {!previewing && kind === "bonafide" && (
            <div className="ns-grid">
              {date}
              <Purpose value={extra.purpose} onChange={(v) => put("purpose", v)} />
            </div>
          )}
          {!previewing && kind === "dob" && (
            <div className="ns-grid">
              {date}
              <Purpose value={extra.purpose} onChange={(v) => put("purpose", v)} />
            </div>
          )}
          {!previewing && kind === "no_dues" && (
            <div className="ns-grid">
              {money === null && <p className="row-sub span-2">Checking fees…</p>}
              {money?.failed && <p className="notice notice-error span-2">Couldn’t check this student’s fees. Check your connection and try again.</p>}
              {money && !money.failed && money.due > 0 && <p className="notice notice-error span-2">{rupees(money.due)} is due, so a no dues certificate can’t be issued yet.</p>}
              {money && !money.failed && money.due === 0 && <p className="adm-fee span-2">Nothing is due as of today.{money.later > 0 ? ` ${rupees(money.later)} falls due later in the year and isn’t covered by this certificate.` : ""}</p>}
              <Purpose value={extra.purpose} onChange={(v) => put("purpose", v)} />
            </div>
          )}
          {!previewing && kind === "character" && (
            <div className="ns-grid">
              {date}
              <label>
                <span>Student from</span>
                <input type="date" value={extra.from} onChange={set("from")} />
              </label>
              <div className="field span-2">
                <span>Conduct</span>
                <div className="choice-row">
                  {CONDUCT.map((c) => (
                    <button type="button" key={c} className={`choice${extra.conduct === c ? " on" : ""}`} onClick={() => put("conduct", c)}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <label className="adm-check span-2">
                <input type="checkbox" checked={extra.left} onChange={(e) => put("left", e.target.checked)} />
                <span>Has left the school</span>
              </label>
              {extra.left && (
                <label>
                  <span>Student until</span>
                  <input type="date" value={extra.to} onChange={set("to")} />
                </label>
              )}
            </div>
          )}
          {!previewing && kind === "fee_paid" && (
            <div className="ns-grid">
              <label>
                <span>Session</span>
                <select value={extra.session_id} onChange={set("session_id")}>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              {date}
              {money === null && <p className="row-sub span-2">Adding up payments…</p>}
              {money?.failed && <p className="notice notice-error span-2">Couldn’t read this student’s payments. Check your connection and try again.</p>}
              {money && !money.failed && <p className="adm-fee span-2">{money.total > 0 ? `${rupees(money.total)} paid towards ${pickedSession?.name ?? "this session"}.` : `No fees paid towards ${pickedSession?.name ?? "this session"}.`}</p>}
              <Purpose value={extra.purpose} onChange={(v) => put("purpose", v)} />
            </div>
          )}
          {!previewing && kind === "slc" && step === 0 && (
            <div className="ns-grid">
              <label>
                <span>Working days in the session</span>
                <input inputMode="numeric" value={extra.working_days} onChange={set("working_days")} maxLength={4} />
              </label>
              <label>
                <span>Days present</span>
                <input inputMode="numeric" value={extra.days_present} onChange={set("days_present")} maxLength={4} />
              </label>
              <div className="field span-2">
                <span>Qualified for promotion</span>
                <div className="choice-row">
                  {PROMOTION.map((c) => (
                    <button type="button" key={c} className={`choice${extra.promotion === c ? " on" : ""}`} onClick={() => put("promotion", c)}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <label>
                <span>Nationality</span>
                <input value={extra.nationality} onChange={set("nationality")} maxLength={40} />
              </label>
              <label>
                <span>Subjects studied</span>
                <input value={extra.subjects} onChange={set("subjects")} maxLength={200} />
              </label>
            </div>
          )}
          {!previewing && kind === "slc" && step === 1 && (
            <div className="ns-grid">
              <label>
                <span>Date of leaving *</span>
                <input type="date" value={extra.left_on} onChange={set("left_on")} max={dayKey()} required />
              </label>
              {date}
              <div className="field span-2">
                <span>Reason for leaving *</span>
                <div className="choice-row">
                  {REASONS.map((r) => (
                    <button type="button" key={r} className={`choice${extra.reason === r ? " on" : ""}`} onClick={() => put("reason", r)}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field span-2">
                <span>General conduct</span>
                <div className="choice-row">
                  {CONDUCT.map((c) => (
                    <button type="button" key={c} className={`choice${extra.conduct === c ? " on" : ""}`} onClick={() => put("conduct", c)}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <label className="span-2">
                <span>Remarks</span>
                <input value={extra.remarks} onChange={set("remarks")} maxLength={200} />
              </label>
              {money && !money.failed && money.due > 0 && <p className="adm-fee span-2">{rupees(money.due)} is due. The certificate will say so.</p>}
              {!isLeft && (
                <label className="adm-check span-2">
                  <input type="checkbox" checked={extra.mark_left} onChange={(e) => put("mark_left", e.target.checked)} />
                  <span>Also mark this student as left</span>
                </label>
              )}
            </div>
          )}
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
            {previewing ? (busy ? "Issuing…" : "Issue certificate") : step === steps.length - 2 ? "Preview" : "Next"}
            {!previewing && <Icon name="arrowRight" />}
          </button>
        </footer>
      </form>
    </div>,
    document.body
  );
}

// Every certificate the school has issued: the register. Students who have left
// aren't on the lists any more, so this is how to find and reprint theirs.
// Issue certificate, from the register: pick the student, then the kind,
// then the same form as on the student's Certificates tab.
function PickForCertificate({ students, onClose, onPick }) {
  const [find, setFind] = useState("");
  const [person, setPerson] = useState(null);
  const q = find.trim().toLowerCase();
  const matches = q ? students.filter((p) => `${p.name} ${p.admission_no ?? ""} ${p.roll_no ?? ""}`.toLowerCase().includes(q)).slice(0, 8) : students.slice(0, 8);
  const missing = (kind) => (kind === "dob" && !person?.dob ? "No date of birth on record" : "");

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal add cert-pick" onClick={(e) => e.stopPropagation()} aria-label="Issue a certificate">
        <header className="ns-head">
          <div className="ns-title">
            <div>
              <h2>Issue a certificate</h2>
              <p className="row-sub">{person ? person.name : "Who is it for?"}</p>
            </div>
            <button type="button" className="btn-icon ns-close" onClick={onClose} aria-label="Close">
              <Icon name="x" size={18} />
            </button>
          </div>
          <StepBar steps={["Student", "Certificate"]} step={person ? 1 : 0} onPick={(i) => i === 0 && setPerson(null)} canPick={(i) => i === 0} />
        </header>
        <div className="modal-body ns-body">
          {!person ? (
            <>
              <label className="search">
                <Icon name="search" />
                <input type="search" autoFocus value={find} onChange={(e) => setFind(e.target.value)} placeholder="Student's name or admission no." aria-label="Find the student" />
              </label>
              <ul className="adm-list cert-pick-list">
                {matches.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => setPerson(p)}>
                      <span className="inbox-main">
                        <strong>{p.name}</strong>
                        <span className="row-sub">{[p.class ? gradeLabel(p.class) + (p.section ? ` ${p.section}` : "") : "", p.admission_no].filter(Boolean).join(" · ")}</span>
                      </span>
                      <Icon name="chevronRight" size={16} />
                    </button>
                  </li>
                ))}
                {matches.length === 0 && <p className="row-sub">No student matches.</p>}
              </ul>
            </>
          ) : (
            <section className="cert-kinds" aria-label="Certificate">
              {KINDS.map(([kind, label, line]) => {
                const why = missing(kind);
                return (
                  <button key={kind} type="button" className="cert-kind" disabled={Boolean(why)} onClick={() => onPick(person, kind)}>
                    <strong>{label}</strong>
                    <span className="row-sub">{why || line}</span>
                  </button>
                );
              })}
            </section>
          )}
        </div>
        <footer className="modal-footer ns-foot">
          {person ? (
            <button type="button" className="btn btn-secondary" onClick={() => setPerson(null)}>
              <Icon name="arrowLeft" /> Back
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
          )}
        </footer>
      </section>
    </div>,
    document.body
  );
}

// kind / onKind: which certificates to list ("" for all), from the phone's
// row of kinds (App.jsx), else the row of pills here.
// students / sessionId / onUpdate: for issuing one from here.
export function CertificatesRegister({ school, kind: kindProp, onKind, students = [], sessionId, onUpdate }) {
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);
  const [find, setFind] = useState("");
  const [kindOwn, setKindOwn] = useState("");
  const kind = kindProp ?? kindOwn;
  const setKind = onKind ?? setKindOwn;
  const [viewing, setViewing] = useState(null);
  const [picking, setPicking] = useState(false);
  const [issuing, setIssuing] = useState(null); // { person, kind }
  const [sessions, setSessions] = useState([]);
  const [leftChanges, setLeftChanges] = useState(null);

  useEffect(() => {
    if ((picking || issuing) && !sessions.length) listSessions(school.id).then(setSessions, () => {});
  }, [picking, issuing, school.id, sessions.length]);

  useEffect(() => {
    let live = true;
    listSchoolCertificates(school.id).then(
      (r) => live && setRows(r),
      () => live && setFailed(true)
    );
    return () => {
      live = false;
    };
  }, [school.id]);

  const q = find.trim().toLowerCase();
  const shown = (rows ?? []).filter((c) => (!kind || c.kind === kind) && (!q || `${c.serial_no} ${c.details?.name ?? ""} ${c.details?.admission_no ?? ""}`.toLowerCase().includes(q)));

  return (
    <div className="certs">
      <div className="page-header">
        <h1 className="page-title">Certificates</h1>
        <div className="page-actions">
          <button className="btn btn-primary adm-new" onClick={() => setPicking(true)}>
            <Icon name="plus" /> Issue certificate
          </button>
        </div>
      </div>
      <div className="adm-tools">
        <div className="segmented segmented-sm adm-filter" role="group" aria-label="Certificate">
          {[["", "All"], ...KINDS].map(([k, label]) => {
            const n = k ? (rows ?? []).filter((c) => c.kind === k).length : 0;
            return (
              <button key={k || "all"} type="button" className={kind === k ? "active" : ""} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {label.replace(" (SLC / TC)", "")}
                {n > 0 && <span className="adm-count">{n}</span>}
              </button>
            );
          })}
        </div>
        <label className="search adm-search">
          <Icon name="search" />
          <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Name, admission or certificate no." aria-label="Search certificates" />
        </label>
      </div>
      {failed && <p className="notice notice-error">Couldn’t load the certificates. Reload to try again.</p>}
      {rows === null && !failed && <div className="card card-skeleton" aria-busy="true" />}
      {rows !== null && shown.length === 0 && <p className="row-sub adm-empty">{rows.length ? "Nothing matches." : "Nothing issued yet. Open a student and use their Certificates tab."}</p>}
      {shown.length > 0 && (
        <ul className="adm-list">
          {shown.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setViewing(c)}>
                <span className="inbox-main">
                  <strong>{c.details?.name ?? "Student"}</strong>
                  <span className="row-sub">{[TITLE[c.kind], c.serial_no, shortDate(c.issued_on)].join(" · ")}</span>
                </span>
                {c.is_duplicate && <span className="badge badge-neutral">Duplicate</span>}
                {c.cancelled_at && <span className="badge badge-danger">Cancelled</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {picking && (
        <PickForCertificate
          students={students}
          onClose={() => setPicking(false)}
          onPick={(person, k) => {
            setPicking(false);
            setIssuing({ person, kind: k });
          }}
        />
      )}
      {issuing && sessions.length > 0 && (
        <IssueForm
          kind={issuing.kind}
          school={school}
          person={issuing.person}
          sessions={sessions}
          sessionId={sessionId}
          onClose={() => setIssuing(null)}
          onIssued={(saved, changes) => {
            setRows((list) => [{ ...saved, details: saved.details ?? { name: issuing.person.name } }, ...(list ?? [])]);
            if (changes) setLeftChanges({ id: issuing.person.id, changes });
            setIssuing(null);
            setViewing(saved);
          }}
        />
      )}
      {viewing && (
        <CertificateView
          school={school}
          cert={viewing}
          canCancel
          onClose={() => {
            setViewing(null);
            if (leftChanges) onUpdate?.(leftChanges.id, leftChanges.changes);
            setLeftChanges(null);
          }}
          onCancelled={(saved) => {
            setRows((list) => (list ?? []).map((c) => (c.id === saved.id ? saved : c)));
            setViewing(saved);
          }}
          onReissued={(saved) => {
            setRows((list) => [saved, ...(list ?? [])]);
            setViewing(saved);
          }}
        />
      )}
    </div>
  );
}

export default function CertificatesTab({ school, person, sessionId, onUpdate }) {
  // Marked as left: applied once the certificate is closed, because a student
  // who has left drops off the list, which would close this page mid-print.
  const [leftChanges, setLeftChanges] = useState(null);
  const [rows, setRows] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [issuing, setIssuing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    listCertificates(person.id).then(
      (r) => live && setRows(r),
      () => live && setFailed(true)
    );
    listSessions(school.id).then((s) => live && setSessions(s), () => {});
    return () => {
      live = false;
    };
  }, [person.id, school.id]);

  const missing = (kind) => (kind === "dob" && !person.dob ? "No date of birth on record" : "");
  const replace = (saved) => {
    setRows((list) => (list ?? []).map((c) => (c.id === saved.id ? saved : c)));
    setViewing(saved);
  };

  return (
    <div className="certs">
      <section className="cert-kinds" aria-label="Issue a certificate">
        {KINDS.map(([kind, label, line]) => {
          const why = missing(kind);
          return (
            <button key={kind} type="button" className="cert-kind" disabled={Boolean(why)} onClick={() => setIssuing(kind)}>
              <strong>{label}</strong>
              <span className="row-sub">{why || line}</span>
            </button>
          );
        })}
      </section>

      <section className="cert-register">
        <h3 className="facts-title">Issued</h3>
        {failed && <p className="notice notice-error">Couldn’t load the certificates. Reload to try again.</p>}
        {rows !== null && rows.length === 0 && <p className="row-sub">Nothing issued yet.</p>}
        {rows?.length > 0 && (
          <ul className="adm-list">
            {rows.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setViewing(c)}>
                  <span className="inbox-main">
                    <strong>{TITLE[c.kind]}</strong>
                    <span className="row-sub">{[c.serial_no, shortDate(c.issued_on)].join(" · ")}</span>
                  </span>
                  {c.is_duplicate && <span className="badge badge-neutral">Duplicate</span>}
                  {c.cancelled_at && <span className="badge badge-danger">Cancelled</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {issuing && (
        <IssueForm
          kind={issuing}
          school={school}
          person={person}
          sessions={sessions}
          sessionId={sessionId}
          onClose={() => setIssuing(null)}
          onIssued={(saved, changes) => {
            setRows((list) => [saved, ...(list ?? [])]);
            setLeftChanges(changes);
            setIssuing(null);
            setViewing(saved);
          }}
        />
      )}
      {viewing && (
        <CertificateView
          school={school}
          cert={viewing}
          canCancel
          onClose={() => {
            setViewing(null);
            if (leftChanges) onUpdate?.(person.id, leftChanges);
          }}
          onCancelled={replace}
          onReissued={(saved) => {
            setRows((list) => [saved, ...(list ?? [])]);
            setViewing(saved);
          }}
        />
      )}
    </div>
  );
}
