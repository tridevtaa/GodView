import { useEffect, useMemo, useState } from "react";
import { listFeeHeads, recordPayment, studentLedger } from "../data/api.js";
import { rupees } from "../data/money.js";
import { PaymentForm } from "./FeeLedger.jsx";
import { Photo, gradeLabel } from "./PersonCard.jsx";
import Receipt from "./Receipt.jsx";
import Icon from "./Icon.jsx";
import { haptic } from "../pwa/haptics.js";

const todayStr = () => new Date().toISOString().slice(0, 10);

// Collect a fee without leaving the page: pick the student (skipped when
// one is given), take the payment, then the receipt. Owners and admins.
export default function CollectFee({ school, students, student: given = null, onClose, onPaid }) {
  const [student, setStudent] = useState(given);
  const [ledger, setLedger] = useState(null);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState(null); // { payment, dues }

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !receipt && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, receipt]);

  // The picked student's dues, to suggest the amount and name what's paid.
  useEffect(() => {
    if (!student) return;
    let live = true;
    setLedger(null);
    setError("");
    Promise.all([studentLedger(student.id), listFeeHeads(school.id)]).then(
      ([{ dues, payments }, heads]) => {
        if (!live) return;
        const name = new Map(heads.map((h) => [h.id, h.name]));
        setLedger({ dues: dues.map((d) => ({ ...d, head_name: name.get(d.head_id) })), payments });
      },
      () => live && setError("Couldn’t load this student’s fees. Check your connection.")
    );
    return () => {
      live = false;
    };
  }, [student, school.id]);

  const open = (ledger?.dues ?? []).filter((d) => Number(d.balance) > 0);
  const now = todayStr();
  const dueNow = open.filter((d) => !d.due_date || d.due_date <= now).reduce((t, d) => t + Number(d.balance), 0);
  const later = open.reduce((t, d) => t + Number(d.balance), 0) - dueNow;

  async function save(form) {
    const saved = await recordPayment(student.id, form);
    haptic("success");
    onPaid?.();
    // Fresh dues so the receipt names exactly what this paid.
    const { dues, payments } = await studentLedger(student.id);
    const heads = new Map((await listFeeHeads(school.id)).map((h) => [h.id, h.name]));
    const payment = payments.find((p) => p.receipt_no === saved?.receipt_no) ?? payments[0];
    if (payment) setReceipt({ payment, dues: dues.map((d) => ({ ...d, head_name: heads.get(d.head_id) })) });
    else onClose();
  }

  if (receipt) return <Receipt school={school} person={student} payment={receipt.payment} dues={receipt.dues} onClose={onClose} />;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal collect" role="dialog" aria-modal="true" aria-label="Collect fee" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          {student && !given ? (
            <button className="back-btn" onClick={() => setStudent(null)} aria-label="Pick another student" title="Back">
              <Icon name="chevronLeft" size={20} />
            </button>
          ) : null}
          <h2>
            <Icon name="rupee" /> Collect fee
          </h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body">
          {!student ? (
            <StudentPicker students={students} onPick={setStudent} />
          ) : (
            <>
              <div className="collect-who navy-card">
                <Photo person={student} className="inbox-photo" />
                <span className="collect-name">
                  <strong>{student.name}</strong>
                  <span className="row-sub">
                    {[gradeLabel(student.class), student.section, student.admission_no].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {ledger && (
                  <span className="collect-due">
                    <strong className={dueNow > 0 ? "is-due" : "is-paid"}>{dueNow > 0 ? rupees(dueNow) : "Nothing due"}</strong>
                    <span className="row-sub">{dueNow > 0 ? `due now${later > 0 ? ` · ${rupees(later)} later` : ""}` : later > 0 ? `${rupees(later)} later` : "all clear"}</span>
                  </span>
                )}
              </div>
              {error && <p className="field-error">{error}</p>}
              {!ledger && !error && <p className="row-sub">Loading…</p>}
              {ledger && <PaymentForm key={student.id} suggested={dueNow || later} onCancel={onClose} onSave={save} />}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

// Search by name, admission no. or parent's phone; before typing, the
// students who owe the most.
function StudentPicker({ students, onPick }) {
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    const live = students.filter((s) => s.status !== "left");
    if (!t) return live.filter((s) => Number(s.fee_due) > 0).sort((a, b) => Number(b.fee_due) - Number(a.fee_due)).slice(0, 6);
    const digits = t.replace(/\D/g, "");
    return live
      .filter((s) => `${s.name} ${s.admission_no ?? ""} ${s.parent_name ?? ""}`.toLowerCase().includes(t) || (digits.length >= 4 && String(s.parent_phone ?? "").replace(/\D/g, "").includes(digits)))
      .slice(0, 8);
  }, [students, q]);
  return (
    <div className="picker">
      <label className="search">
        <Icon name="search" />
        <input autoFocus placeholder="Student name, admission no. or parent’s phone" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {!q && matches.length > 0 && <p className="row-sub collect-hint">Owe the most</p>}
      <ul className="picker-list">
        {matches.map((s) => (
          <li key={s.id}>
            <button onClick={() => onPick(s)}>
              <Photo person={s} className="inbox-photo collect-photo" />
              <span>
                <strong>{s.name}</strong>
                <span className="row-sub">
                  {[s.admission_no, gradeLabel(s.class), s.section].filter(Boolean).join(" · ")}
                </span>
              </span>
              {Number(s.fee_due) > 0 ? <span className="badge badge-warning">{rupees(s.fee_due)}</span> : <span className="badge badge-success">Nothing due</span>}
            </button>
          </li>
        ))}
        {q && matches.length === 0 && <li className="row-sub picker-empty">No student found.</li>}
      </ul>
    </div>
  );
}
