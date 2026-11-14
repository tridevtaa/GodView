import { useCallback, useEffect, useMemo, useState } from "react";
import { cancelPayment, listFeeHeads, recordPayment, setConcession, studentLedger } from "../data/api.js";
import { METHODS, rupees } from "../data/money.js";
import PaymentHistory from "./PaymentHistory.jsx";
import Receipt from "./Receipt.jsx";
import Icon from "./Icon.jsx";
import { haptic } from "../pwa/haptics.js";

const today = () => new Date().toISOString().slice(0, 10);
const shortDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
const dayMonth = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const n = (v) => Number(v) || 0;
// "Monthly fee" -> "Monthly", for lists of several fees
const shortHead = (h) => (h ?? "Fee").replace(/\s*fees?$/i, "") || h;
const isMonth = (p) => /^\d{4}-\d{2}$/.test(p ?? "");
const nextMonth = (p) => {
  const [y, m] = p.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
// The order record_payment() pays dues in: oldest due date first
const payOrder = (a, b) => String(a.due_date ?? "").localeCompare(String(b.due_date ?? "")) || String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));

// Dues as words, months run together: "Apr – Jul 2026, Aug 2026 (part)".
// items: [{ due, part, rest }] (rest: the remainder of a part-paid due). Several fees: "Monthly Apr – Jul 2026 · Transport Dec 2026".
function describeDues(items) {
  const byHead = new Map();
  for (const it of items) {
    const k = it.due.head_name ?? "Fee";
    if (!byHead.has(k)) byHead.set(k, []);
    byHead.get(k).push(it);
  }
  const parts = [...byHead].map(([head, list]) => {
    list.sort((a, b) => String(a.due.period).localeCompare(String(b.due.period)));
    const runs = [];
    for (const it of list) {
      const run = runs.at(-1);
      const last = run?.at(-1);
      if (last && !last.part && !it.part && !last.rest && !it.rest && isMonth(last.due.period) && it.due.period === nextMonth(last.due.period)) run.push(it);
      else runs.push([it]);
    }
    const text = runs
      .map((r) =>
        r.length === 1
          ? `${r[0].due.label}${r[0].part ? " (part)" : r[0].rest ? " (rest)" : ""}`
          : `${r[0].due.label.split(" ")[0]} – ${r.at(-1).due.label}`
      )
      .join(", ");
    return byHead.size > 1 ? `${shortHead(head)} ${text}` : text;
  });
  return parts.join(" · ");
}

// What a payment of `amount` would clear, the way record_payment() does it.
function coverage(amount, open) {
  let left = n(amount);
  const items = [];
  for (const d of [...open].sort(payOrder)) {
    if (left <= 0) break;
    const take = Math.min(left, n(d.balance));
    items.push({ due: d, part: take < n(d.balance), rest: take >= n(d.balance) && n(d.paid) > 0 });
    left -= take;
  }
  return { items, credit: Math.max(0, left) };
}

// A student's fees on one scroll (owners and admins): what's due now, what
// they pay this year, the year month by month, and the payments received.
export default function FeeLedger({ school, person, sessionId, canEdit, onChanged }) {
  const [ledger, setLedger] = useState(null);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState(null);

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
  // The year shown: the session picked at the top, else the latest with dues
  const sid = dues.some((d) => d.session_id === sessionId) ? sessionId : [...dues].sort(payOrder).at(-1)?.session_id;
  const yearDues = dues.filter((d) => d.session_id === sid);
  const open = dues.filter((d) => n(d.balance) > 0);
  const late = open.filter((d) => d.due_date && d.due_date < todayStr);
  const dueNow = open.filter((d) => !d.due_date || d.due_date <= todayStr).reduce((t, d) => t + n(d.balance), 0);
  const later = open.filter((d) => d.due_date && d.due_date > todayStr).reduce((t, d) => t + n(d.balance), 0);

  return (
    <div className="ledger-view fees2">
      <Summary
        yearDues={yearDues}
        open={open}
        late={late}
        dueNow={dueNow}
        later={later}
        canEdit={canEdit}
        paying={paying}
        onCollect={() => setPaying(true)}
      />

      {paying && (
        <CollectPanel
          open={open}
          dueNow={dueNow}
          onClose={() => setPaying(false)}
          onSave={async (form) => {
            const saved = await recordPayment(person.id, form);
            haptic("success");
            setPaying(false);
            await changed();
            setReceipt(saved?.receipt_no);
          }}
        />
      )}

      <FeesThisYear yearDues={yearDues} />

      {yearDues.length > 0 || open.length > 0 ? (
        <YearMonths
          yearDues={yearDues}
          earlier={open.filter((d) => d.session_id !== sid)}
          todayStr={todayStr}
          canEdit={canEdit}
          onChanged={changed}
        />
      ) : (
        <p className="row-sub fees2-empty">No dues yet. Set up the fee structure in Fees and create the dues for the session.</p>
      )}

      <section className="fees2-block">
        <h3 className="fees2-title">Payments</h3>
        {payments.length === 0 ? (
          <p className="row-sub fees2-empty">No payments yet.</p>
        ) : (
          <PaymentHistory
            schoolId={school.id}
            payments={payments}
            listClass="fees2-payments"
            row={(p) => <PaymentRow key={p.id} payment={p} dues={dues} onOpen={() => setReceipt(p.receipt_no)} />}
          />
        )}
      </section>

      {receipt && payments.find((p) => p.receipt_no === receipt) && (
        <Receipt
          school={school}
          person={person}
          payment={payments.find((p) => p.receipt_no === receipt)}
          dues={dues}
          onClose={() => setReceipt(null)}
          actions={
            canEdit &&
            payments.find((p) => p.receipt_no === receipt).status === "success" && (
              <CancelPayment
                onConfirm={async () => {
                  await cancelPayment(payments.find((p) => p.receipt_no === receipt).id);
                  setReceipt(null);
                  await changed();
                }}
              />
            )
          }
        />
      )}
    </div>
  );
}

// 1. What's due now and how late, the year's progress, and Collect.
function Summary({ yearDues, open, late, dueNow, later, canEdit, paying, onCollect }) {
  const billed = yearDues.reduce((t, d) => t + n(d.amount) - n(d.concession), 0);
  const paid = yearDues.reduce((t, d) => t + n(d.paid), 0);
  const pct = billed > 0 ? Math.min(100, Math.round((paid / billed) * 100)) : 0;
  const lateMonths = new Set(late.map((d) => d.period ?? d.label)).size;
  const since = late.length ? [...late].sort(payOrder)[0].due_date : null;
  const next = [...open].filter((d) => d.due_date && d.due_date > today()).sort(payOrder)[0];
  const nextAmount = next ? open.filter((d) => d.due_date === next.due_date).reduce((t, d) => t + n(d.balance), 0) : 0;
  const clear = dueNow <= 0;

  return (
    <section className={`fees2-summary navy-card${clear ? " is-clear" : ""}`}>
      <div className="fees2-summary-top">
        <div className="fees2-summary-main">
          <strong className="fees2-due">{clear ? "All clear" : rupees(dueNow)}</strong>
          <span className="fees2-due-note">
            {clear
              ? next
                ? `Next ${rupees(nextAmount)} on ${dayMonth(next.due_date)}`
                : "Nothing left to pay"
              : since
                ? `due now · ${lateMonths} ${lateMonths === 1 ? "month" : "months"} late, since ${dayMonth(since)}`
                : "due today"}
          </span>
        </div>
        {canEdit && !paying && (open.length > 0 || clear) && (
          <button className="btn btn-primary" onClick={onCollect}>
            <Icon name="rupee" />
            {clear ? "Collect" : `Collect ${rupees(dueNow)}`}
          </button>
        )}
      </div>
      {billed > 0 && (
        <div className="fees2-progress">
          <div className="fees2-bar" role="img" aria-label={`${pct}% of this year paid`}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <span className="fees2-progress-text">
            {rupees(paid)} of {rupees(billed)} paid this year{later > 0 ? ` · ${rupees(later)} to come` : ""}
          </span>
        </div>
      )}
    </section>
  );
}

// Collect: amount shortcuts, what the payment will cover, then the usual form.
// On phones it slides up from the bottom.
function CollectPanel({ open, dueNow, onClose, onSave }) {
  const all = open.reduce((t, d) => t + n(d.balance), 0);
  const options = [
    dueNow > 0 && { label: "Due now", amount: dueNow },
    all > dueNow && { label: "Everything", amount: all },
  ].filter(Boolean);
  const preview = (amount) => {
    if (!(n(amount) > 0)) return "";
    if (!open.length) return "Nothing is due; this stays as credit";
    const { items, credit } = coverage(amount, open);
    return `Covers ${describeDues(items)}${credit > 0 ? ` · ${rupees(credit)} extra stays as credit` : ""}`;
  };
  return (
    <>
      <div className="fees2-sheet-backdrop" onClick={onClose} />
      <section className="fees2-collect" aria-label="Collect fee">
        <header className="fees2-collect-head">
          <h3>Collect fee</h3>
          <button className="icon-btn-sm" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </header>
        <PaymentForm suggested={dueNow || all} options={options} preview={preview} onCancel={onClose} onSave={onSave} />
      </section>
    </>
  );
}

// 2. Each fee this year: its rate, how many times, the year's total and how
// much of it is paid.
function FeesThisYear({ yearDues }) {
  const heads = [];
  for (const d of yearDues) {
    let h = heads.find((x) => x.id === d.head_id);
    if (!h) heads.push((h = { id: d.head_id, name: d.head_name ?? "Fee", dues: [] }));
    h.dues.push(d);
  }
  if (!heads.length) return null;
  return (
    <section className="fees2-block">
      <h3 className="fees2-title">Fees this year</h3>
      <ul className="fees2-card fees2-heads">
        {heads.map((h) => {
          const billed = h.dues.reduce((t, d) => t + n(d.amount) - n(d.concession), 0);
          const paid = h.dues.reduce((t, d) => t + n(d.paid), 0);
          const off = h.dues.reduce((t, d) => t + n(d.concession), 0);
          const real = h.dues.filter((d) => n(d.amount) > 0);
          const elsewhere = h.dues.filter((d) => n(d.amount) === 0 && d.note);
          const same = real.length && real.every((d) => n(d.amount) === n(real[0].amount));
          const rate = same ? (real.length > 1 ? `${rupees(real[0].amount)} × ${real.length}` : rupees(real[0].amount)) : `${real.length} instalments`;
          const pct = billed > 0 ? Math.round((paid / billed) * 100) : 100;
          return (
            <li key={h.id} className="fees2-head">
              <div className="fees2-head-main">
                <strong>{h.name}</strong>
                <span className="row-sub">
                  {[real.length ? rate : null, off > 0 && `${rupees(off)} off`, elsewhere.length > 0 && `${elsewhere.length} more ${elsewhere[0].note.replace(/^Paid/, "paid")}`]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <div className="fees2-head-side">
                <strong>{rupees(billed)}</strong>
                <span className="fees2-mini">
                  <span className="fees2-bar is-mini">
                    <span style={{ width: `${pct}%` }} />
                  </span>
                  <span className="row-sub">{billed > 0 && paid >= billed ? "paid" : `${rupees(paid)} paid`}</span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// 3. The year month by month: paid months folded together at the start, a
// line at today, late months in red. Tap a month for its fees.
function YearMonths({ yearDues, earlier, todayStr, canEdit, onChanged }) {
  const [openKey, setOpenKey] = useState(null);
  const [showPaidRun, setShowPaidRun] = useState(false);
  const months = useMemo(() => {
    const out = [];
    for (const d of [...yearDues].sort(payOrder)) {
      const k = d.period ?? d.label;
      let m = out.find((x) => x.key === k);
      if (!m) out.push((m = { key: k, label: d.label, dues: [] }));
      m.dues.push(d);
    }
    return out.map((m) => summarise(m, todayStr));
  }, [yearDues, todayStr]);
  const earlierMonth = earlier.length ? summarise({ key: "earlier", label: "Earlier years", dues: earlier }, todayStr) : null;

  let run = 0;
  while (run < months.length && months[run].status === "paid") run++;
  const fold = run >= 2 && !showPaidRun;
  const firstAhead = months.findIndex((m) => m.due_date && m.due_date > todayStr);

  const row = (m, i) => (
    <MonthRow
      key={m.key}
      month={m}
      firstAhead={i === firstAhead}
      open={openKey === m.key}
      onToggle={() => setOpenKey(openKey === m.key ? null : m.key)}
      canEdit={canEdit}
      onChanged={onChanged}
    />
  );

  return (
    <section className="fees2-block">
      <h3 className="fees2-title">Month by month</h3>
      <ul className="fees2-card fees2-months">
        {earlierMonth && row(earlierMonth, -1)}
        {fold && (
          <li>
            <button type="button" className="fees2-month is-paid" onClick={() => setShowPaidRun(true)}>
              <StatusDot status="paid" />
              <span className="fees2-month-main">
                <strong>
                  {months[0].label.split(" ")[0]} – {months[run - 1].label}
                </strong>
                <span className="row-sub">All paid</span>
              </span>
              <span className="fees2-month-amount is-paid">{rupees(months.slice(0, run).reduce((t, m) => t + m.billed, 0))}</span>
              <Icon name="chevronDown" size={16} />
            </button>
          </li>
        )}
        {months.map((m, i) => {
          if (fold && i < run) return null;
          return [
            i === firstAhead && firstAhead > 0 && (
              <li key="today" className="fees2-today" aria-label="Today">
                <span>Today, {dayMonth(todayStr)}</span>
              </li>
            ),
            row(m, i),
          ];
        })}
      </ul>
    </section>
  );
}

function summarise(m, todayStr) {
  const billed = m.dues.reduce((t, d) => t + n(d.amount) - n(d.concession), 0);
  const paid = m.dues.reduce((t, d) => t + n(d.paid), 0);
  const balance = m.dues.reduce((t, d) => t + n(d.balance), 0);
  const unpaid = m.dues.filter((d) => n(d.balance) > 0);
  const due_date = [...m.dues].sort(payOrder)[0]?.due_date ?? null;
  const lateNow = unpaid.some((d) => d.due_date && d.due_date < todayStr);
  const status = balance <= 0 ? "paid" : lateNow ? "late" : "ahead";
  return { ...m, billed, paid, balance, due_date, status, part: paid > 0 && balance > 0 };
}

function StatusDot({ status, part }) {
  return (
    <span className={`fees2-dot is-${status}${part ? " is-part" : ""}`} aria-hidden="true">
      {status === "paid" && <Icon name="check" size={12} />}
    </span>
  );
}

function MonthRow({ month: m, firstAhead, open, onToggle, canEdit, onChanged }) {
  const heads = [...new Set(m.dues.map((d) => d.head_name ?? "Fee"))];
  const what = heads.length === 1 ? heads[0] : heads.map(shortHead).join(" + ");
  const early = m.due_date && isMonth(m.key) && Number(m.due_date.slice(5, 7)) !== Number(m.key.slice(5, 7));
  const sub =
    m.status === "paid"
      ? `${what} · paid`
      : [m.part ? `${rupees(m.paid)} of ${rupees(m.billed)} paid` : what, (early || firstAhead || m.key === "earlier") && m.due_date && `due ${dayMonth(m.due_date)}`]
          .filter(Boolean)
          .join(" · ");
  return (
    <li className={open ? "is-open" : ""}>
      <button type="button" className={`fees2-month is-${m.status}`} onClick={onToggle} aria-expanded={open}>
        <StatusDot status={m.status} part={m.part} />
        <span className="fees2-month-main">
          <strong>{m.label}</strong>
          <span className="row-sub">{sub}</span>
        </span>
        <span className={`fees2-month-amount is-${m.status}`}>{m.status === "paid" ? rupees(m.billed) : rupees(m.balance)}</span>
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <ul className="fees2-fees">
          {m.dues.map((d) => (
            <FeeLine key={d.id} due={d} showLabel={m.key === "earlier"} canEdit={canEdit} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </li>
  );
}

// One fee inside an open month: amount, what's paid or off, and a concession.
function FeeLine({ due, showLabel, canEdit, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(due.concession ?? 0));
  const [error, setError] = useState("");
  const settled = n(due.balance) <= 0;

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
    n(due.amount) > 0 && rupees(due.amount),
    n(due.paid) > 0 && !settled && `${rupees(due.paid)} paid`,
    n(due.concession) > 0 && `${rupees(due.concession)} off`,
    n(due.amount) === 0 && due.note,
    due.due_date && `due ${shortDate(due.due_date)}`,
  ].filter(Boolean);

  return (
    <li className="fees2-fee">
      <div className="fees2-fee-main">
        <strong>{showLabel ? `${due.head_name ?? "Fee"} · ${due.label}` : due.head_name ?? "Fee"}</strong>
        <span className="row-sub">{sub.join(" · ")}</span>
        {editing && (
          <div className="concession-edit">
            <span className="row-sub">Concession ₹</span>
            <input className="input input-num" type="number" min="0" max={due.amount} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
            <button className="btn btn-primary btn-sm" onClick={save}>
              Save
            </button>
            <button className="link-btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
            {error && <span className="field-error">{error}</span>}
          </div>
        )}
      </div>
      <div className="fees2-fee-side">
        <strong className={settled ? "is-paid" : ""}>{settled ? "Paid" : rupees(due.balance)}</strong>
        {canEdit && n(due.paid) === 0 && !settled && !editing && (
          <button className="link-btn" onClick={() => setEditing(true)}>
            {n(due.concession) > 0 ? "Change concession" : "Give concession"}
          </button>
        )}
      </div>
    </li>
  );
}

// 4. One payment: when, how much, how, and which months it paid for.
function PaymentRow({ payment: p, dues, onOpen }) {
  const dueById = new Map(dues.map((d) => [d.id, d]));
  const allocs = (p.allocations ?? []).filter((a) => dueById.has(a.invoice_id));
  const items = allocs.map((a) => {
    const d = dueById.get(a.invoice_id);
    return { due: d, part: n(a.amount) < n(d.amount) - n(d.concession) };
  });
  const credit = n(p.amount) - allocs.reduce((t, a) => t + n(a.amount), 0);
  const covers =
    p.status !== "success"
      ? "Cancelled"
      : items.length
        ? `For ${describeDues(items)}${credit > 0 ? ` · ${rupees(credit)} credit` : ""}`
        : "Not set against any due";
  const d = new Date(p.paid_on);
  return (
    <li className={p.status !== "success" ? "is-void" : ""}>
      <button type="button" className="fees2-payment" onClick={onOpen}>
        <span className="fees2-date">
          <strong>{d.getDate()}</strong>
          <span>{MONTHS[d.getMonth()]}</span>
        </span>
        <span className="fees2-payment-main">
          <strong>
            {rupees(p.amount)}
            <span className="fees2-payment-how">
              {[METHODS[p.method], p.reference, p.receipt_no].filter(Boolean).join(" · ")}
            </span>
          </strong>
          <span className="row-sub">{covers}</span>
        </span>
        <Icon name="chevronRight" size={16} />
      </button>
    </li>
  );
}

const PAY_METHODS = ["cash", "upi", "cheque", "card", "bank_transfer"];

// Names that collected fees on this device, newest first, for one-tap picking.
const COLLECTORS_KEY = "godview.collectors";
function recentCollectors() {
  try {
    const list = JSON.parse(localStorage.getItem(COLLECTORS_KEY) || "[]");
    return Array.isArray(list) ? list.filter((x) => typeof x === "string").slice(0, 4) : [];
  } catch {
    return [];
  }
}
function rememberCollector(name) {
  try {
    const list = [name, ...recentCollectors().filter((x) => x.toLowerCase() !== name.toLowerCase())].slice(0, 4);
    localStorage.setItem(COLLECTORS_KEY, JSON.stringify(list));
  } catch {
    // private window or storage blocked: nothing to remember
  }
}

// Amount and how it was paid; reference only when the method has one; who
// collected it (required); date and note tucked away (today, no note) until
// asked for.
// options: amount shortcuts [{ label, amount }]; preview(amount): what it pays.
export function PaymentForm({ suggested, options = [], preview, onSave, onCancel }) {
  const [form, setForm] = useState({ amount: suggested ? String(suggested) : "", method: "cash", reference: "", paid_on: today(), note: "", collected_by: "" });
  const [recent] = useState(recentCollectors);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const needsRef = ["cheque", "upi", "card", "netbanking", "bank_transfer"].includes(form.method);
  const covers = preview?.(form.amount);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const who = form.collected_by.trim();
    if (!who) {
      setError("Say who is collecting this payment.");
      setBusy(false);
      return;
    }
    try {
      await onSave({ ...form, collected_by: who });
      rememberCollector(who);
    } catch (err) {
      setError(
        err?.code === "PGRST202"
          ? "The payment log update isn’t live yet, so payments can’t be saved. Ask the owner to apply it."
          : "Couldn’t record the payment. Check the amount and try again."
      );
      setBusy(false);
    }
  }

  return (
    <form className="payment-form" onSubmit={submit}>
      {options.length > 0 && (
        <div className="pay-options" role="group" aria-label="Amount">
          {options.map((o) => (
            <button
              type="button"
              key={o.label}
              className={`pay-option${n(form.amount) === n(o.amount) ? " on" : ""}`}
              onClick={() => setForm({ ...form, amount: String(o.amount) })}
            >
              <span>{o.label}</span>
              <strong>{rupees(o.amount)}</strong>
            </button>
          ))}
        </div>
      )}
      <label className="pay-amount">
        <span className="sr-only">Amount</span>
        <span className="pay-rupee">₹</span>
        <input type="number" inputMode="decimal" min="1" step="0.01" required value={form.amount} onChange={set("amount")} autoFocus />
      </label>
      {covers && <p className="pay-covers">{covers}</p>}
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
      <div className="pay-collector">
        <label htmlFor="pay-collected-by">
          Collected by <span className="pay-required">required</span>
        </label>
        <input
          id="pay-collected-by"
          className="input"
          value={form.collected_by}
          onChange={set("collected_by")}
          required
          maxLength={80}
          placeholder="Who is taking the money, e.g. Ramesh (office)"
          autoComplete="off"
        />
        {recent.length > 0 && (
          <div className="pay-collector-recent">
            {recent.map((name) => (
              <button
                type="button"
                key={name}
                className={`pill pill-sm${form.collected_by.trim() === name ? " on" : ""}`}
                onClick={() => setForm({ ...form, collected_by: name })}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>
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
        <button className="btn btn-primary btn-sm" disabled={busy || !(Number(form.amount) > 0) || !form.collected_by.trim()} title="Oldest dues are paid first; anything extra stays as credit">
          {busy ? "Saving…" : "Save & receipt"}
        </button>
      </div>
    </form>
  );
}

// In the receipt's toolbar: cancel the payment, after a second tap.
function CancelPayment({ onConfirm }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button className="btn btn-secondary btn-sm" onClick={() => setAsking(true)}>
        <Icon name="trash" size={16} />
        Cancel payment
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
