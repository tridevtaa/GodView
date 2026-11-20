import { useCallback, useEffect, useMemo, useState } from "react";
import { cancelPayment, listFeeHeads, listSessions, recordPayment, setConcession, setEarlierPending, studentLedger } from "../data/api.js";
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
// Each fee type keeps one colour everywhere on the page (dot, card, month
// lines), so Monthly and Transport are told apart at a glance.
const TONES = ["indigo", "amber", "teal", "pink", "slate"];
const isTransport = (name) => /transport|\bbus\b|\bvan\b|conveyance/i.test(name ?? "");
// Dues from before this session: the old system's balances, or last year
const isEarlier = (d, sid) => d.period === "opening" || d.session_id !== sid;

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

// What a payment of `amount` would clear, the way record_payment() does it:
// the ticked dues first (`first`, ids), then the rest, each oldest first.
function coverage(amount, open, first = null) {
  let left = n(amount);
  const items = [];
  const ahead = (d) => (first?.has(d.id) ? 0 : 1);
  for (const d of [...open].sort((a, b) => ahead(a) - ahead(b) || payOrder(a, b))) {
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
  const [paying, setPaying] = useState(false); // true: due now; "picked": the ticked dues
  const [receipt, setReceipt] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const pick = (id) =>
    setPicked((p) => {
      const next = new Set(p);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const load = useCallback(async () => {
    try {
      const [{ dues, payments }, heads, sessions] = await Promise.all([studentLedger(person.id), listFeeHeads(school.id), listSessions(school.id).catch(() => [])]);
      const headName = new Map(heads.map((h) => [h.id, h.name]));
      setLedger({ dues: dues.map((d) => ({ ...d, head_name: headName.get(d.head_id) })), payments, heads, sessions });
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

  const { dues, payments, heads, sessions } = ledger;
  const todayStr = today();
  // The year shown: the session picked at the top, else the latest with dues
  const sid = dues.some((d) => d.session_id === sessionId) ? sessionId : [...dues].sort(payOrder).at(-1)?.session_id ?? sessionId;
  const yearDues = dues.filter((d) => !isEarlier(d, sid));
  const earlierDues = dues.filter((d) => isEarlier(d, sid) && (n(d.balance) > 0 || d.session_id === sid));
  // Colours in the order the fee types appear this year; earlier-only ones after
  const tone = new Map();
  for (const d of [...yearDues, ...earlierDues].sort(payOrder)) {
    const k = d.head_name ?? "Fee";
    if (!tone.has(k)) tone.set(k, isTransport(k) ? "amber" : TONES.filter((t) => t !== "amber" && ![...tone.values()].includes(t))[0] ?? "slate");
  }
  const toneOf = (name) => tone.get(name ?? "Fee") ?? "slate";
  const ordered = [...sessions].sort((a, b) => a.name.localeCompare(b.name));
  const prevSession = ordered[ordered.findIndex((x) => x.id === sid) - 1];
  const open = dues.filter((d) => n(d.balance) > 0);
  const late = open.filter((d) => d.due_date && d.due_date < todayStr);
  const dueNow = open.filter((d) => !d.due_date || d.due_date <= todayStr).reduce((t, d) => t + n(d.balance), 0);
  const later = open.filter((d) => d.due_date && d.due_date > todayStr).reduce((t, d) => t + n(d.balance), 0);
  const pickedDues = open.filter((d) => picked.has(d.id));
  const pickedTotal = pickedDues.reduce((t, d) => t + n(d.balance), 0);

  return (
    <div className="ledger-view fees2">
      <Summary
        yearDues={yearDues}
        sid={sid}
        toneOf={toneOf}
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
          picked={paying === "picked" ? pickedDues : []}
          onClose={() => setPaying(false)}
          onSave={async (form) => {
            const saved = await recordPayment(person.id, form);
            haptic("success");
            setPaying(false);
            setPicked(new Set());
            await changed();
            setReceipt(saved?.receipt_no);
          }}
        />
      )}

      {canEdit && open.length > 0 && picked.size === 0 && <p className="row-sub fees2-hint">Tick the circles to collect particular months.</p>}

      {(earlierDues.length > 0 || canEdit) && (
        <EarlierYears
          dues={earlierDues}
          heads={heads}
          toneOf={toneOf}
          todayStr={todayStr}
          picked={picked}
          onPick={pick}
          canEdit={canEdit && Boolean(sid)}
          label={prevSession ? `Pending from ${prevSession.name}` : "Pending from earlier years"}
          onSave={async (headId, amount, label) => {
            await setEarlierPending(school.id, sid, person.id, headId, amount, label, sessions.find((x) => x.id === sid)?.starts_on);
            await changed();
          }}
          onChanged={changed}
        />
      )}

      {yearDues.length > 0 ? (
        <FeeTypes yearDues={yearDues} toneOf={toneOf} todayStr={todayStr} person={person} canEdit={canEdit} picked={picked} onPick={pick} onChanged={changed} />
      ) : (
        <p className="row-sub fees2-empty">No dues yet. Set up the fee structure in Fees and create the dues for the session.</p>
      )}

      {canEdit && pickedDues.length > 0 && !paying && (
        <div className="fees2-pickbar" role="region" aria-label="Ticked fees">
          <span className="fees2-pickbar-main">
            <strong>{rupees(pickedTotal)}</strong>
            <span className="row-sub">{describeDues(pickedDues.map((d) => ({ due: d, rest: n(d.paid) > 0 })))}</span>
          </span>
          <button className="link-btn" onClick={() => setPicked(new Set())}>
            Clear
          </button>
          <button className="btn btn-primary" onClick={() => setPaying("picked")}>
            <Icon name="rupee" /> Collect
          </button>
        </div>
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
function Summary({ yearDues, sid, toneOf, open, late, dueNow, later, canEdit, paying, onCollect }) {
  // What "due now" is made of, by fee type (and earlier years)
  const parts = new Map();
  for (const d of open.filter((x) => !x.due_date || x.due_date <= today())) {
    const k = isEarlier(d, sid) ? "Earlier years" : d.head_name ?? "Fee";
    parts.set(k, (parts.get(k) ?? 0) + n(d.balance));
  }
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
          {!clear && parts.size > 1 && (
            <span className="fees2-parts">
              {[...parts].map(([k, v]) => (
                <span key={k} className={`fees2-part tone-${k === "Earlier years" ? "red" : toneOf(k)}`}>
                  <i aria-hidden="true" />
                  {shortHead(k)} {rupees(v)}
                </span>
              ))}
            </span>
          )}
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
// picked: the dues ticked on the page; they're paid first.
function CollectPanel({ open, dueNow, picked = [], onClose, onSave }) {
  const all = open.reduce((t, d) => t + n(d.balance), 0);
  const first = picked.length ? new Set(picked.map((d) => d.id)) : null;
  const ticked = picked.reduce((t, d) => t + n(d.balance), 0);
  const options = [
    first && { label: "Ticked", amount: ticked },
    dueNow > 0 && (!first || dueNow !== ticked) && { label: "Due now", amount: dueNow },
    all > dueNow && { label: "Everything", amount: all },
  ].filter(Boolean);
  const preview = (amount) => {
    if (!(n(amount) > 0)) return "";
    if (!open.length) return "Nothing is due; this stays as credit";
    const { items, credit } = coverage(amount, open, first);
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
        <PaymentForm suggested={first ? ticked : dueNow || all} options={options} preview={preview} onCancel={onClose} onSave={(form) => onSave(first ? { ...form, dues: [...first] } : form)} />
      </section>
    </>
  );
}

// 2. Each fee type on its own card: its rate, the year's total and what's
// paid, then its months (paid ones folded at the start, a line at today).
// Owners and admins tick dues to collect just those.
const byPeriod = (a, b) => String(a.period ?? "").localeCompare(String(b.period ?? "")) || payOrder(a, b);
const dueStatus = (d, todayStr) => (n(d.balance) <= 0 ? "paid" : d.due_date && d.due_date < todayStr ? "late" : "ahead");

function FeeTypes({ yearDues, toneOf, todayStr, person, canEdit, picked, onPick, onChanged }) {
  const heads = [];
  for (const d of [...yearDues].sort(byPeriod)) {
    let h = heads.find((x) => x.id === d.head_id);
    if (!h) heads.push((h = { id: d.head_id, name: d.head_name ?? "Fee", dues: [] }));
    h.dues.push(d);
  }
  // School fees first, transport after
  heads.sort((x, y) => isTransport(x.name) - isTransport(y.name));
  const months = new Set(yearDues.map((d) => d.period)).size;
  const stop = person.pickup_point || person.transport_route;
  // Takes the bus, but nothing is charged for it this year
  const noTransport = person.uses_bus && !heads.some((h) => isTransport(h.name) && h.dues.some((d) => n(d.amount) > 0));
  return (
    <>
      {heads.map((h) => (
        <FeeType
          key={h.id}
          head={h}
          months={months}
          tone={toneOf(h.name)}
          stop={isTransport(h.name) ? stop : ""}
          todayStr={todayStr}
          canEdit={canEdit}
          picked={picked}
          onPick={onPick}
          onChanged={onChanged}
        />
      ))}
      {noTransport && (
        <section className="fees2-block">
          <div className="fees2-card fees2-type tone-amber">
            <div className="fees2-type-head">
              <i className="fees2-tone" aria-hidden="true" />
              <div className="fees2-head-main">
                <strong>Transport fee</strong>
                <span className="row-sub">Takes the bus{stop ? ` from ${stop}` : ""}, but no transport fee is charged this year.</span>
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function FeeType({ head: h, months, tone, stop, todayStr, canEdit, picked, onPick, onChanged }) {
  const [openId, setOpenId] = useState(null);
  const [showPaid, setShowPaid] = useState(false);
  const billed = h.dues.reduce((t, d) => t + n(d.amount) - n(d.concession), 0);
  const paid = h.dues.reduce((t, d) => t + n(d.paid), 0);
  const off = h.dues.reduce((t, d) => t + n(d.concession), 0);
  const real = h.dues.filter((d) => n(d.amount) > 0);
  const same = real.length && real.every((d) => n(d.amount) === n(real[0].amount));
  const rate = !real.length ? "" : same ? (real.length > 1 ? `${rupees(real[0].amount)} × ${real.length}` : rupees(real[0].amount)) : `${real.length} instalments`;
  // Charged in only some months (e.g. transport each quarter): say which
  const which = real.length > 1 && real.length < months ? real.map((d) => d.label.split(" ")[0]).join(", ") : "";
  const dueNow = h.dues.filter((d) => n(d.balance) > 0 && (!d.due_date || d.due_date <= todayStr)).reduce((t, d) => t + n(d.balance), 0);
  const pct = billed > 0 ? Math.round((paid / billed) * 100) : 100;

  const rows = h.dues;
  let run = 0;
  while (run < rows.length && n(rows[run].balance) <= 0) run++;
  const fold = run >= 2 && !showPaid;
  const firstAhead = rows.findIndex((d) => n(d.balance) > 0 && d.due_date && d.due_date > todayStr);

  return (
    <section className="fees2-block">
      <div className={`fees2-card fees2-type tone-${tone}`}>
        <div className="fees2-type-head">
          <i className="fees2-tone" aria-hidden="true" />
          <div className="fees2-head-main">
            <strong>
              {h.name}
              {stop ? <span className="fees2-head-stop"> · {stop}</span> : null}
            </strong>
            <span className="row-sub">{[rate, which, off > 0 && `${rupees(off)} off`].filter(Boolean).join(" · ")}</span>
            {dueNow > 0 && <span className="fees2-head-due">{rupees(dueNow)} due now</span>}
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
        </div>
        <ul className="fees2-months">
          {fold && (
            <li>
              <button type="button" className="fees2-month is-paid" onClick={() => setShowPaid(true)}>
                <StatusDot status="paid" />
                <span className="fees2-month-main">
                  <strong>
                    {rows[0].label.split(" ")[0]} – {rows[run - 1].label}
                  </strong>
                  <span className="row-sub">All paid</span>
                </span>
                <span className="fees2-month-amount is-paid">{rupees(rows.slice(0, run).reduce((t, d) => t + n(d.amount) - n(d.concession), 0))}</span>
                <Icon name="chevronDown" size={16} />
              </button>
            </li>
          )}
          {rows.map((d, i) =>
            fold && i < run
              ? null
              : [
                  i === firstAhead && firstAhead > 0 && (
                    <li key="today" className="fees2-today" aria-label="Today">
                      <span>Today, {dayMonth(todayStr)}</span>
                    </li>
                  ),
                  <DueRow
                    key={d.id}
                    due={d}
                    title={d.label}
                    tone={tone}
                    todayStr={todayStr}
                    canEdit={canEdit}
                    picked={picked.has(d.id)}
                    onPick={() => onPick(d.id)}
                    open={openId === d.id}
                    onToggle={() => setOpenId(openId === d.id ? null : d.id)}
                    onChanged={onChanged}
                  />,
                ]
          )}
        </ul>
      </div>
    </section>
  );
}

// One due as a row: tick it to collect (owners and admins), tap it for the
// details and a concession.
function DueRow({ due: d, title, tone, todayStr, canEdit, picked, onPick, open, onToggle, onChanged }) {
  const status = dueStatus(d, todayStr);
  const part = n(d.paid) > 0 && n(d.balance) > 0;
  const zero = n(d.amount) === 0;
  const early = d.due_date && isMonth(d.period) && Number(d.due_date.slice(5, 7)) !== Number(d.period.slice(5, 7));
  const sub = zero
    ? d.note || "Nothing to pay"
    : [
        n(d.concession) > 0 && `${rupees(d.concession)} off`,
        status === "paid" ? "paid" : part && `${rupees(d.paid)} of ${rupees(n(d.amount) - n(d.concession))} paid`,
        status !== "paid" && early && `due ${dayMonth(d.due_date)}`,
      ]
        .filter(Boolean)
        .join(" · ");
  const canPick = canEdit && n(d.balance) > 0;
  return (
    <li className={open ? "is-open" : ""}>
      <div className={`fees2-month fees2-due is-${zero ? "paid" : status}${picked ? " is-picked" : ""}`}>
        {canPick ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={picked}
            className={`fees2-pick is-${status}${part ? " is-part" : ""}${picked ? " is-on" : ""}`}
            onClick={onPick}
            aria-label={`Collect ${title}`}
            title="Tick to collect"
          >
            {picked && <Icon name="check" size={12} />}
          </button>
        ) : (
          <StatusDot status={zero ? "paid" : status} part={part} />
        )}
        <button type="button" className="fees2-due-open" onClick={onToggle} aria-expanded={open}>
          <span className="fees2-month-main">
            <strong>{title}</strong>
            {sub && <span className="row-sub">{sub}</span>}
          </span>
          <span className={`fees2-month-amount is-${status}`}>{zero ? "" : status === "paid" ? rupees(n(d.amount) - n(d.concession)) : rupees(d.balance)}</span>
          <Icon name="chevronDown" size={16} />
        </button>
      </div>
      {open && (
        <ul className="fees2-fees">
          <FeeLine due={d} tone={tone} canEdit={canEdit} onChanged={onChanged} />
        </ul>
      )}
    </li>
  );
}


// 2b. What was still owed from before this session (last year, or the old
// fee system), kept apart from this year's months. Owners and admins can
// add it per fee type; it's due now and Collect takes it first.
function EarlierYears({ dues, heads, toneOf, todayStr, picked, onPick, canEdit, label, onSave, onChanged }) {
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [headId, setHeadId] = useState(heads[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = dues.reduce((t, d) => t + n(d.balance), 0);
  if (!dues.length && !canEdit) return null;

  async function save(e) {
    e.preventDefault();
    if (!(n(amount) > 0) || !headId) return;
    setBusy(true);
    setError("");
    try {
      await onSave(headId, n(amount), label);
      setAdding(false);
      setAmount("");
    } catch {
      setError("Couldn’t save. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  const existing = dues.find((d) => d.head_id === headId && d.period === "opening");
  return (
    <section className="fees2-block">
      <h3 className="fees2-title">
        From earlier years
        {open > 0 && <span className="fees2-title-amount">{rupees(open)} pending</span>}
      </h3>
      {dues.length > 0 && (
        <ul className="fees2-card fees2-months">
          {dues.map((d) => (
            <DueRow
              key={d.id}
              due={d}
              title={`${d.head_name ?? "Fee"} · ${d.label}`}
              tone={toneOf(d.head_name)}
              todayStr={todayStr}
              canEdit={canEdit}
              picked={picked.has(d.id)}
              onPick={() => onPick(d.id)}
              open={openId === d.id}
              onToggle={() => setOpenId(openId === d.id ? null : d.id)}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
      {canEdit &&
        (adding ? (
          <form className="fees2-earlier-form" onSubmit={save}>
            <select className="input" value={headId} onChange={(e) => setHeadId(e.target.value)} aria-label="Fee type">
              {heads.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
            <input className="input input-num" type="number" inputMode="decimal" min="1" step="1" placeholder="Amount ₹" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount pending" autoFocus />
            <button className="btn btn-primary btn-sm" disabled={busy || !(n(amount) > 0) || !headId}>
              {busy ? "Saving…" : existing ? "Replace" : "Add"}
            </button>
            <button type="button" className="link-btn" onClick={() => setAdding(false)}>
              Cancel
            </button>
            {existing && <span className="row-sub fees2-earlier-hint">Replaces the {rupees(existing.amount)} already added for {existing.head_name}.</span>}
            {error && <span className="field-error">{error}</span>}
          </form>
        ) : (
          <button className="link-btn fees2-earlier-add" onClick={() => setAdding(true)}>
            <Icon name="plus" size={13} /> {dues.length ? "Add more pending" : "Add pending from last year"}
          </button>
        ))}
    </section>
  );
}

function StatusDot({ status, part }) {
  return (
    <span className={`fees2-dot is-${status}${part ? " is-part" : ""}`} aria-hidden="true">
      {status === "paid" && <Icon name="check" size={12} />}
    </span>
  );
}

// One fee inside an open month: amount, what's paid or off, and a concession.
function FeeLine({ due, tone, showLabel = false, canEdit, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(due.concession ?? 0));
  const [reason, setReason] = useState(due.concession_reason ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const settled = n(due.balance) <= 0;
  // A concession needs a remark; taking it back to 0 doesn't
  const needsReason = n(value) > 0 && !reason.trim();
  const tooMuch = n(value) > n(due.amount);

  async function save(e) {
    e.preventDefault();
    if (needsReason || tooMuch) return;
    setBusy(true);
    setError("");
    try {
      await setConcession(due.id, value, n(value) > 0 ? reason : "");
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err?.message === "concession-reason" ? "Add a remark saying why." : "Couldn’t save the concession. Try again.");
    } finally {
      setBusy(false);
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
    <li className={`fees2-fee${tone ? ` tone-${tone}` : ""}`}>
      <div className="fees2-fee-main">
        <strong>{showLabel ? `${due.head_name ?? "Fee"} · ${due.label}` : due.head_name ?? "Fee"}</strong>
        <span className="row-sub">{sub.join(" · ")}</span>
        {n(due.concession) > 0 && !editing && (
          <span className="fees2-remark">
            <Icon name="note" size={13} />
            {due.concession_reason || "No remark (given before remarks were needed)"}
          </span>
        )}
        {editing && (
          <form className="concession-edit concession-form" onSubmit={save}>
            <label className="concession-amount">
              <span className="row-sub">Concession ₹</span>
              <input className="input input-num" type="number" inputMode="decimal" min="0" max={due.amount} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
            </label>
            <input
              className="input concession-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              placeholder="Remark (required), e.g. Sibling discount"
              aria-label="Why the concession is given"
              required={n(value) > 0}
            />
            <span className="concession-actions">
              <button className="btn btn-primary btn-sm" disabled={busy || needsReason || tooMuch}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" className="link-btn" onClick={() => (setEditing(false), setValue(String(due.concession ?? 0)), setReason(due.concession_reason ?? ""), setError(""))}>
                Cancel
              </button>
            </span>
            {tooMuch && <span className="field-error">Can’t be more than {rupees(due.amount)}.</span>}
            {error && <span className="field-error">{error}</span>}
          </form>
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
