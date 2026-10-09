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

  return (
    <div className="ledger-view">
      <div className="ledger-stats">
        <div>
          <span>Due now</span>
          <strong className={dueNow > 0 ? "is-due" : ""}>{rupees(dueNow)}</strong>
        </div>
        <div>
          <span>Upcoming</span>
          <strong>{rupees(upcoming)}</strong>
        </div>
        <div>
          <span>Paid</span>
          <strong className="is-paid">{rupees(paidTotal)}</strong>
        </div>
        {canEdit && (
          <button className="btn btn-primary btn-sm" onClick={() => setPaying(true)}>
            <Icon name="plus" />
            Record payment
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

      <div className="ledger-section-head">
        <h3>Dues</h3>
        <label className="checkbox checkbox-inline">
          <input type="checkbox" checked={showPaid} onChange={(e) => setShowPaid(e.target.checked)} />
          <span>Show paid</span>
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="row-sub">Nothing outstanding.</p>
      ) : (
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Fee</th>
              <th>Due</th>
              <th className="num">Amount</th>
              <th className="num">Paid</th>
              <th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((d) => (
              <DueRow key={d.id} due={d} todayStr={todayStr} canEdit={canEdit} onChanged={changed} />
            ))}
          </tbody>
        </table>
      )}

      <div className="ledger-section-head">
        <h3>Payments</h3>
      </div>
      {payments.length === 0 ? (
        <p className="row-sub">No payments yet.</p>
      ) : (
        <ul className="payment-list">
          {payments.map((p) => (
            <li key={p.id} className={p.status !== "success" ? "is-void" : ""}>
              <div>
                <strong>{rupees(p.amount)}</strong>
                <span className="row-sub">
                  {shortDate(p.paid_on)} · {METHODS[p.method]}
                  {p.reference ? ` · ${p.reference}` : ""} · {p.receipt_no}
                </span>
              </div>
              <div className="payment-actions">
                {p.status !== "success" && <span className="badge badge-danger">Cancelled</span>}
                <button className="link-btn" onClick={() => setReceipt(p.receipt_no)}>
                  Receipt
                </button>
                {canEdit && p.status === "success" && (
                  <CancelPayment onConfirm={async () => {
                    await cancelPayment(p.id);
                    await changed();
                  }} />
                )}
              </div>
            </li>
          ))}
        </ul>
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

function DueRow({ due, todayStr, canEdit, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(due.concession ?? 0));
  const [error, setError] = useState("");
  const overdue = Number(due.balance) > 0 && due.due_date && due.due_date < todayStr;

  async function save() {
    setError("");
    try {
      await setConcession(due.id, value, due.note);
      setEditing(false);
      onChanged();
    } catch {
      setError("Concession can’t be more than the amount.");
    }
  }

  return (
    <tr className={overdue ? "is-overdue" : ""}>
      <td>
        <div className="due-name">{due.head_name ?? "Fee"}</div>
        <div className="row-sub">{due.label}</div>
      </td>
      <td>{due.due_date ? shortDate(due.due_date) : ""}</td>
      <td className="num">
        {rupees(due.amount)}
        {Number(due.concession) > 0 && !editing && (
          <div className="row-sub">−{rupees(due.concession)} concession</div>
        )}
        {editing ? (
          <div className="concession-edit">
            <input className="input input-num" type="number" min="0" max={due.amount} value={value} onChange={(e) => setValue(e.target.value)} />
            <button className="link-btn" onClick={save}>Save</button>
            <button className="link-btn" onClick={() => setEditing(false)}>Cancel</button>
            {error && <span className="field-error">{error}</span>}
          </div>
        ) : (
          canEdit &&
          Number(due.paid) === 0 && (
            <div>
              <button className="link-btn" onClick={() => setEditing(true)}>
                {Number(due.concession) > 0 ? "Change concession" : "Concession"}
              </button>
            </div>
          )
        )}
      </td>
      <td className="num">{rupees(due.paid)}</td>
      <td className="num">
        <strong>{rupees(due.balance)}</strong>
        {overdue && <div className="row-sub is-due">Overdue</div>}
      </td>
    </tr>
  );
}

function PaymentForm({ suggested, onSave, onCancel }) {
  const [form, setForm] = useState({ amount: suggested ? String(suggested) : "", method: "cash", reference: "", paid_on: today(), note: "" });
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
      <div className="form-grid">
        <label>
          <span>Amount (₹)</span>
          <input type="number" min="1" step="0.01" required value={form.amount} onChange={set("amount")} autoFocus />
        </label>
        <label>
          <span>Paid by</span>
          <select value={form.method} onChange={set("method")}>
            {Object.entries(METHODS)
              .filter(([k]) => k !== "online")
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </select>
        </label>
        <label>
          <span>{form.method === "cheque" ? "Cheque no." : "Reference / UTR"}</span>
          <input value={form.reference} onChange={set("reference")} required={needsRef} maxLength={80} />
        </label>
        <label>
          <span>Date</span>
          <input type="date" value={form.paid_on} max={today()} onChange={set("paid_on")} required />
        </label>
        <label className="span-2">
          <span>Note (optional)</span>
          <input value={form.note} onChange={set("note")} maxLength={300} />
        </label>
      </div>
      <p className="row-sub">Applied to the oldest dues first; anything extra is kept as credit.</p>
      {error && <p className="field-error">{error}</p>}
      <div className="payment-form-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary btn-sm" disabled={busy || !(Number(form.amount) > 0)}>
          {busy ? "Saving…" : "Save and show receipt"}
        </button>
      </div>
    </form>
  );
}

function CancelPayment({ onConfirm }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button className="link-btn link-danger" onClick={() => setAsking(true)}>
        Cancel
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
