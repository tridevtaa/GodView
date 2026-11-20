import { useMemo, useState } from "react";
import { METHODS, rupees } from "../data/money.js";
import { coverage, describeDues, isEarlier, n, payOrder, shortHead } from "../data/feeDues.js";
import Icon from "./Icon.jsx";

const today = () => new Date().toISOString().slice(0, 10);
const PAY_METHODS = ["cash", "upi", "cheque", "card", "bank_transfer"];
const byPeriod = (a, b) => String(a.period ?? "").localeCompare(String(b.period ?? "")) || payOrder(a, b);

// Names that collected fees on this device, newest first. The last one is
// filled in, so most payments need no typing.
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

// Collect a payment in three answers: what it's for (fee type, then how
// far: due now, the whole year, or chosen months), how it was paid, and who
// took it. The amount follows the choice and can be changed: less pays part,
// oldest first within the choice; more goes to other dues, then stays as
// credit. The chosen dues go to the database so they're paid first.
//   dues: all the student's dues (with head_name); sid: this session's id
//   picked: due ids ticked on the student's page, to start from
//   onSave({ amount, method, reference, paid_on, note, collected_by, dues })
export default function CollectForm({ dues, sid, picked = [], onSave, onCancel }) {
  const todayStr = today();
  const open = useMemo(() => dues.filter((d) => n(d.balance) > 0).sort(byPeriod), [dues]);
  const earlier = open.filter((d) => isEarlier(d, sid));
  const year = open.filter((d) => !isEarlier(d, sid));
  // Fee types with something to pay this year, school fees before transport
  const types = useMemo(() => {
    const names = [...new Set(year.map((d) => d.head_name ?? "Fee"))];
    return names.sort((a, b) => /transport|bus|van|conveyance/i.test(a) - /transport|bus|van|conveyance/i.test(b));
  }, [year]);

  const startPicked = picked.filter((id) => open.some((d) => d.id === id));
  const [fee, setFee] = useState("all"); // all | a fee type | earlier
  const [range, setRange] = useState(startPicked.length ? "pick" : open.some((d) => !d.due_date || d.due_date <= todayStr) ? "now" : "year");
  const [chosen, setChosen] = useState(() => new Set(startPicked));
  const [typed, setTyped] = useState(null); // an amount typed over the suggestion
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [recent] = useState(recentCollectors);
  const [collector, setCollector] = useState(() => recent[0] ?? "");
  const [more, setMore] = useState(false);
  const [paidOn, setPaidOn] = useState(todayStr);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ofFee = (list) => (fee === "all" ? list : fee === "earlier" ? earlier : list.filter((d) => (d.head_name ?? "Fee") === fee));
  const pool = fee === "earlier" ? earlier : ofFee(fee === "all" ? open : year);
  const isNow = (d) => !d.due_date || d.due_date <= todayStr;
  const sum = (list) => list.reduce((t, d) => t + n(d.balance), 0);
  const nowTotal = sum(pool.filter(isNow));
  const yearTotal = sum(pool);
  // A choice that adds nothing for this fee falls to the one that does:
  // nothing due now means the whole year; nothing later means due now
  const eff = range === "now" && nowTotal === 0 ? "year" : range === "year" && yearTotal <= nowTotal && nowTotal > 0 ? "now" : range;
  // What the parent is paying for
  const scope = fee === "earlier" ? earlier : eff === "pick" ? pool.filter((d) => chosen.has(d.id)) : eff === "now" ? pool.filter(isNow) : pool;
  const suggested = sum(scope);
  const amount = typed ?? (suggested ? String(suggested) : "");

  const pickFee = (f) => {
    setFee(f);
    setTyped(null);
  };
  const pickRange = (r) => {
    setRange(r);
    setTyped(null);
  };
  const toggle = (id) => {
    setTyped(null);
    setChosen((c) => {
      const next = new Set(c);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  // What this amount will pay, the way the database pays it
  const covers = (() => {
    if (!(n(amount) > 0)) return "";
    if (!open.length) return "Nothing is due, so this stays as credit.";
    const first = new Set(scope.map((d) => d.id));
    const { items, credit } = coverage(amount, open, first);
    const part = n(amount) < suggested && suggested > 0;
    return `${part ? "Part payment. " : ""}Covers ${describeDues(items, true)}${credit > 0 ? `, and ${rupees(credit)} stays as credit` : ""}`;
  })();

  const needsRef = method !== "cash";
  const ready = n(amount) > 0 && collector.trim() && (!needsRef || reference.trim()) && (eff !== "pick" || fee === "earlier" || scope.length > 0 || typed);

  async function submit(e) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError("");
    const who = collector.trim();
    try {
      await onSave({ amount, method, reference: needsRef ? reference : "", paid_on: paidOn, note, collected_by: who, dues: scope.map((d) => d.id) });
      rememberCollector(who);
    } catch (err) {
      setError(err?.message === "not allowed" ? "You can’t collect fees. The owner can change this in App access." : "Couldn’t record the payment. Check the amount and try again.");
      setBusy(false);
    }
  }

  const chip = (on, onClick, label, sub) => (
    <button type="button" className={`cf2-chip${on ? " on" : ""}`} onClick={onClick} aria-pressed={on}>
      <span>{label}</span>
      {sub != null && <strong>{sub}</strong>}
    </button>
  );

  return (
    <form className="cf2" onSubmit={submit}>
      {open.length > 0 && (
        <section className="cf2-step">
          <h4>Paying for</h4>
          {(types.length > 1 || earlier.length > 0) && (
            <div className="cf2-chips" role="group" aria-label="Fee">
              {chip(fee === "all", () => pickFee("all"), "All fees")}
              {types.map((t) => chip(fee === t, () => pickFee(t), shortHead(t)))}
              {earlier.length > 0 && chip(fee === "earlier", () => pickFee("earlier"), "Last year", rupees(sum(earlier)))}
            </div>
          )}
          {fee !== "earlier" && (
            <div className="cf2-chips" role="group" aria-label="How much">
              {nowTotal > 0 && chip(eff === "now", () => pickRange("now"), "Due now", rupees(nowTotal))}
              {yearTotal > nowTotal && chip(eff === "year", () => pickRange("year"), fee === "all" ? "Everything" : "Whole year", rupees(yearTotal))}
              {(pool.length > 1 || eff === "pick") && chip(eff === "pick", () => pickRange("pick"), "Choose months", eff === "pick" && chosen.size ? `${chosen.size} picked` : null)}
            </div>
          )}
          {fee !== "earlier" && eff === "pick" && (
            <div className="cf2-months" role="group" aria-label="Months">
              {pool.map((d) => (
                <button type="button" key={d.id} className={`cf2-month${chosen.has(d.id) ? " on" : ""}${isNow(d) ? " is-due" : ""}`} onClick={() => toggle(d.id)} aria-pressed={chosen.has(d.id)}>
                  {chosen.has(d.id) && <Icon name="check" size={12} />}
                  <span>
                    {fee === "all" && types.length > 1 ? `${shortHead(d.head_name)} ` : ""}
                    {d.label.replace(/ 20(\d\d)$/, " ’$1")}
                  </span>
                  <small>{rupees(d.balance)}</small>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="cf2-step">
        <label className="cf2-amount">
          <span className="cf2-rupee">₹</span>
          <input type="number" inputMode="decimal" min="1" step="0.01" value={amount} onChange={(e) => setTyped(e.target.value)} placeholder="0" aria-label="Amount" />
          {typed !== null && suggested > 0 && n(typed) !== suggested && (
            <button type="button" className="link-btn" onClick={() => setTyped(null)}>
              Use {rupees(suggested)}
            </button>
          )}
        </label>
        {covers && <p className="cf2-covers">{covers}</p>}
      </section>

      <section className="cf2-step">
        <div className="cf2-chips cf2-methods" role="radiogroup" aria-label="Paid by">
          {PAY_METHODS.map((m) => (
            <button type="button" key={m} role="radio" aria-checked={method === m} className={`cf2-chip is-small${method === m ? " on" : ""}`} onClick={() => setMethod(m)}>
              <span>{METHODS[m]}</span>
            </button>
          ))}
        </div>
        {needsRef && (
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} placeholder={method === "cheque" ? "Cheque no. (required)" : "Reference or UTR (required)"} aria-label="Reference" />
        )}
        <div className="cf2-who">
          <input className="input" value={collector} onChange={(e) => setCollector(e.target.value)} maxLength={80} placeholder="Collected by (required), e.g. Ramesh" aria-label="Collected by" autoComplete="off" />
          {recent.length > 1 && (
            <div className="cf2-recent">
              {recent.map((name) => (
                <button type="button" key={name} className={`pill pill-sm${collector.trim() === name ? " on" : ""}`} onClick={() => setCollector(name)}>
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>
        {more ? (
          <div className="cf2-more">
            <input className="input" type="date" value={paidOn} max={todayStr} onChange={(e) => setPaidOn(e.target.value || todayStr)} aria-label="Paid on" />
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Note (optional)" />
          </div>
        ) : (
          <button type="button" className="link-btn cf2-more-btn" onClick={() => setMore(true)}>
            Paid today · change date or add a note
          </button>
        )}
      </section>

      {error && <p className="field-error">{error}</p>}
      <div className="cf2-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy || !ready}>
          {busy ? "Saving…" : n(amount) > 0 ? `Collect ${rupees(amount)}` : "Collect"}
        </button>
      </div>
    </form>
  );
}
