import { useCallback, useEffect, useState } from "react";
import { cancelPayment, listFeeHeads, recordPayment, setConcession, studentLedger } from "../data/api.js";
import { METHODS, rupees } from "../data/money.js";
import Receipt from "./Receipt.jsx";
import Icon from "./Icon.jsx";

const today = () => new Date().toISOString().slice(0, 10);
const shortDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");

// A student's dues, payments and receipts (owners/admins), with recording.
export default function FeeLedger({ school, person, canEdit, onChanged }) {
  const [ledger, setLedger] = useState(null);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [showPaid, setShowPaid] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ dues, payments }, heads] = await Promise.all([studentLedger(person.id), listFeeHeads(school.id)]);
      const headName = new Map(heads.map((h) => [h.id, h.name]));
      setLedger({ dues: dues.map((d) => ({ ...d, head_name: headName.get(d.head_id) })), payments });
      setError("");
    } catch {
      setError("Couldn’t load fees.");
    }
  }, [person.id, school.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function changed() {
    await load();
    onChanged?.();
  }

  if (error) return <p className="field-error">{error}</p>;
  if (!ledger) return <p className="row-sub">Loading…</p>;

  const { dues, payments } = ledger;
  const todayStr = today();
  const open = dues.filter((d) => Number(d.balance) > 0);
  const dueNow = open.filter((d) => !d.due_date || d.due_date <= todayStr).reduce((s, d) => s + Number(d.balance), 0);
  const upcoming = open.filter((d) => d.due_date && d.due_date > todayStr).reduce((s, d) => s + Number(d.balance), 0);
  const paidTotal = payments.filter((p) => p.status === "success").reduce((s, p) => s + Number(p.amount), 0);
  const shown = showPaid ? dues : open;

  if (!dues.length && !payments.length) {
    return (
      <p className="row-sub">
        No dues yet. Set up the fee structure in the <strong>Fees</strong> tab and generate dues for the session.
      </p>
    );
  }

  const paidDues = dues.length - open.length;
  const extra = [upcoming > 0 && `${rupees(upcoming)} later`, paidTotal > 0 && `${rupees(paidTotal)} paid`].filter(Boolean).join(" · ");

  return (
    <div className="ledger-view">
      {/* One line: what's due now, the rest in small print, and collect. */}
      <div className="ledger-summary">
        <div>
          <strong className={dueNow > 0 ? "is-due" : "is-paid"}>{dueNow > 0 ? rupees(dueNow) : "Nothing due"}</strong>
          <span className="row-sub">{dueNow > 0 ? `due now${extra ? ` · ${extra}` : ""}` : extra}</span>
        </div>
        {canEdit && !paying && (
          <button className="btn btn-primary btn-sm" onClick={() => setPaying(true)}>
            <Icon name="rupee" />
            Collect
          </button>
        )}
      </div>

      {paying && (
        <PaymentForm
          suggested={dueNow || open.reduce((s, d) => s + Number(d.balance), 0)}
          onCancel={() => setPaying(false)}
          onSave={async (form) => {
            const saved = await recordPayment(person.id, form);
            setPaying(false);
            await changed();
            setReceipt(saved?.receipt_no);
          }}
        />
      )}

      {shown.length === 0 ? (
        <p className="row-sub ledger-empty">Nothing outstanding.</p>
      ) : (
        <ul className="due-list">
          {shown.map((d) => (
            <DueRow key={d.id} due={d} todayStr={todayStr} canEdit={canEdit} onChanged={changed} />
          ))}
        </ul>
      )}
      {paidDues > 0 && (
        <button className="link-btn ledger-toggle" onClick={() => setShowPaid((v) => !v)}>
          {showPaid ? "Hide paid" : `Show ${paidDues} paid`}
        </button>
      )}

      {payments.length > 0 && (
        <>
          <h3 className="ledger-h">Payments</h3>
          <ul className="payment-list">
            {payments.map((p) => (
              <li key={p.id} className={p.status !== "success" ? "is-void" : ""}>
                <div>
                  <strong>{rupees(p.amount)}</strong>
                  <span className="row-sub">
                    {[shortDate(p.paid_on), METHODS[p.method], p.reference, p.receipt_no].filter(Boolean).join(" · ")}
                  </span>
                </div>
                <div className="payment-actions">
                  {p.status !== "success" && <span className="badge badge-danger">Cancelled</span>}
                  <button className="icon-btn-sm" onClick={() => setReceipt(p.receipt_no)} aria-label="Receipt" title="Receipt">
                    <Icon name="file" size={16} />
                  </button>
                  {canEdit && p.status === "success" && (
                    <CancelPayment
                      onConfirm={async () => {
                        await cancelPayment(p.id);
                        await changed();
                      }}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {receipt && ledger.payments.find((p) => p.receipt_no === receipt) && (
        <Receipt
          school={school}
          person={person}
          payment={ledger.payments.find((p) => p.receipt_no === receipt)}
          dues={ledger.dues}
          onClose={() => setReceipt(null)}
        />
      )}
    </div>
  );
}

// One due: what it is, when, how much is paid; the balance on the right.
function DueRow({ due, todayStr, canEdit, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(due.concession ?? 0));
  const [error, setError] = useState("");
  const overdue = Number(due.balance) > 0 && due.due_date && due.due_date < todayStr;
  const settled = Number(due.balance) <= 0;

  async function save() {
    setError("");
    try {
      await setConcession(due.id, value, due.note);
      setEditing(false);
      onChanged();
    } catch {
      setError("Can’t be more than the amount.");
    }
  }

  const sub = [
    due.due_date && `Due ${shortDate(due.due_date)}`,
    Number(due.paid) > 0 && `${rupees(due.paid)} of ${rupees(due.amount)} paid`,
    Number(due.concession) > 0 && `${rupees(due.concession)} off`,
  ].filter(Boolean);

  return (
    <li className={`due-row${overdue ? " is-overdue" : ""}${settled ? " is-settled" : ""}`}>
      <div className="due-main">
        <strong>{[due.head_name ?? "Fee", due.label].filter(Boolean).join(" · ")}</strong>
        <span className="row-sub">{sub.join(" · ")}</span>
        {editing && (
          <div className="concession-edit">
            <span className="row-sub">Concession ₹</span>
            <input className="input input-num" type="number" min="0" max={due.amount} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
            <button className="btn btn-primary btn-sm" onClick={save}>
              Save
            </button>
            <button className="icon-btn-sm" onClick={() => setEditing(false)} aria-label="Cancel">
              <Icon name="x" size={15} />
            </button>
            {error && <span className="field-error">{error}</span>}
          </div>
        )}
      </div>
      <div className="due-side">
        <strong>{settled ? "Paid" : rupees(due.balance)}</strong>
        {overdue && <span className="due-flag">Overdue</span>}
      </div>
      {canEdit && Number(due.paid) === 0 && !editing && !settled && (
        <button className="icon-btn-sm" onClick={() => setEditing(true)} aria-label="Concession" title={Number(due.concession) > 0 ? "Change concession" : "Give a concession"}>
          <Icon name="tag" size={16} />
        </button>
      )}
    </li>
  );
}

const PAY_METHODS = ["cash", "upi", "cheque", "card", "bank_transfer"];

// Amount and how it was paid; reference only when the method has one; date
// and note tucked away (today, no note) until asked for.
function PaymentForm({ suggested, onSave, onCancel }) {
  const [form, setForm] = useState({ amount: suggested ? String(suggested) : "", method: "cash", reference: "", paid_on: today(), note: "" });
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const needsRef = ["cheque", "upi", "card", "netbanking", "bank_transfer"].includes(form.method);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave(form);
    } catch {
      setError("Couldn’t record the payment. Check the amount and try again.");
      setBusy(false);
    }
  }

  return (
    <form className="payment-form" onSubmit={submit}>
      <label className="pay-amount">
        <span className="sr-only">Amount</span>
        <span className="pay-rupee">₹</span>
        <input type="number" inputMode="decimal" min="1" step="0.01" required value={form.amount} onChange={set("amount")} autoFocus />
      </label>
      <div className="choice-row pay-methods" role="radiogroup" aria-label="Paid by">
        {PAY_METHODS.map((m) => (
          <button type="button" key={m} role="radio" aria-checked={form.method === m} className={`choice${form.method === m ? " on" : ""}`} onClick={() => setForm({ ...form, method: m })}>
            {METHODS[m]}
          </button>
        ))}
      </div>
      {needsRef && (
        <input className="input" value={form.reference} onChange={set("reference")} required maxLength={80} placeholder={form.method === "cheque" ? "Cheque no." : "Reference / UTR"} />
      )}
      {more ? (
        <div className="pay-more">
          <input className="input" type="date" value={form.paid_on} max={today()} onChange={set("paid_on")} required aria-label="Paid on" />
          <input className="input" value={form.note} onChange={set("note")} maxLength={300} placeholder="Note (optional)" />
        </div>
      ) : (
        <button type="button" className="link-btn" onClick={() => setMore(true)}>
          Paid today. Change date or add a note
        </button>
      )}
      {error && <p className="field-error">{error}</p>}
      <div className="payment-form-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary btn-sm" disabled={busy || !(Number(form.amount) > 0)} title="Oldest dues are paid first; anything extra stays as credit">
          {busy ? "Saving…" : "Save & receipt"}
        </button>
      </div>
    </form>
  );
}

function CancelPayment({ onConfirm }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button className="icon-btn-sm" onClick={() => setAsking(true)} aria-label="Cancel payment" title="Cancel payment">
        <Icon name="trash" size={16} />
      </button>
    );
  }
  return (
    <span className="cancel-confirm">
      <span className="row-sub">Cancel this payment?</span>
      <button className="link-btn link-danger" onClick={onConfirm}>
        Yes, cancel
      </button>
      <button className="link-btn" onClick={() => setAsking(false)}>
        No
      </button>
    </span>
  );
}
