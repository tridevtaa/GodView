import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { sendBulkMessage } from "../data/api.js";
import StudentPicker, { describePicked } from "./StudentPicker.jsx";
import Icon, { WhatsAppLogo } from "./Icon.jsx";

// Owners and admins: one message to many parents. First who, then what and
// how: in the app (it lands in each child's conversation, with a notification)
// and on WhatsApp. WhatsApp is one tap per parent, from this person's own
// WhatsApp, with the words ready; automatic sending needs a WhatsApp Business
// account. The list is kept on this device, since going to WhatsApp and back
// can reload the page on a phone.
const KEEP_MS = 24 * 36e5;
const tenDigits = (n) => {
  const d = String(n ?? "").replace(/\D/g, "").slice(-10);
  return d.length === 10 ? d : null;
};

// One row per phone: a parent of two children is messaged once.
function byPhone(list) {
  const rows = new Map();
  let missing = 0;
  for (const p of list) {
    const phone = tenDigits(p.parent_phone) ?? tenDigits(p.father_phone) ?? tenDigits(p.mother_phone) ?? tenDigits(p.phone);
    if (!phone) {
      missing++;
      continue;
    }
    if (!rows.has(phone)) rows.set(phone, { phone, names: [] });
    rows.get(phone).names.push(p.name);
  }
  return { rows: [...rows.values()], missing };
}

const read = (key) => {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v && Date.now() - v.at < KEEP_MS && v.done.length < v.rows.length ? v : null;
  } catch {
    return null;
  }
};
const write = (key, v) => {
  try {
    if (v) localStorage.setItem(key, JSON.stringify(v));
    else localStorage.removeItem(key);
  } catch {
    // Private mode: the list just isn't kept
  }
};

export default function BulkMessage({ school, students, onSent, onClose }) {
  const key = `gv-bulk-wa:${school.id}`;
  // Inactive students' parents don't get the school's everyday messages
  const people = students.filter((s) => s.status !== "left" && s.status !== "inactive");
  const [tap, setTap] = useState(() => read(key)); // { body, rows, missing, sentApp, done, at }
  const [step, setStep] = useState(tap ? "whatsapp" : "who");
  const [picked, setPicked] = useState(() => new Set());
  const [body, setBody] = useState("");
  const [inApp, setInApp] = useState(true);
  const [onWhatsApp, setOnWhatsApp] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const count = picked.size;
  const parents = `${count.toLocaleString("en-IN")} ${count === 1 ? "student’s parents" : "students’ parents"}`;
  const overdue = people.filter((p) => p.fee_status === "overdue").map((p) => p.id);

  async function send() {
    setBusy(true);
    setError("");
    try {
      const list = people.filter((p) => picked.has(p.id));
      if (inApp) {
        await sendBulkMessage(school.id, [...picked], body.trim());
        onSent?.();
      }
      if (!onWhatsApp) return onClose();
      const next = { body: body.trim(), ...byPhone(list), sentApp: inApp ? count : 0, done: [], at: Date.now() };
      write(key, next);
      setTap(next);
      setStep("whatsapp");
    } catch {
      setError("Couldn’t send that. Nothing went out. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function opened(phone) {
    setTap((t) => {
      const next = { ...t, done: t.done.includes(phone) ? t.done : [...t.done, phone] };
      write(key, next);
      return next;
    });
  }
  function finish() {
    write(key, null);
    onClose();
  }
  const link = (row) => `https://wa.me/91${row.phone}?text=${encodeURIComponent(tap.body)}`;
  const next = tap?.rows.find((r) => !tap.done.includes(r.phone));

  return createPortal(
    <div className="filter-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="filter-sheet bulk-sheet" role="dialog" aria-modal="true" aria-label="Message parents">
        <header className="filter-head">
          <h2>{step === "whatsapp" ? "Send on WhatsApp" : "Message parents"}</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close" title="Close">
            <Icon name="x" size={18} />
          </button>
        </header>

        {step === "who" && (
          <>
            <div className="filter-body">
              <StudentPicker people={people} picked={picked} onChange={setPicked} presets={[{ label: "Fees overdue", ids: overdue }]} />
            </div>
            <footer className="filter-foot">
              <button type="button" className="link-btn" onClick={() => setPicked(new Set())} disabled={!count}>
                Clear all
              </button>
              <button type="button" className="btn btn-primary" disabled={!count} onClick={() => setStep("write")}>
                Next: {count.toLocaleString("en-IN")} {count === 1 ? "student" : "students"}
              </button>
            </footer>
          </>
        )}

        {step === "write" && (
          <>
            <div className="filter-body">
              <p className="bulk-to">To the parents of {describePicked(people, picked)}</p>
              <textarea className="textarea bulk-text" rows={6} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your message" aria-label="Message" autoFocus />
              <h3>Send by</h3>
              <div className="filter-chips">
                <button type="button" className={`chip-btn${inApp ? " is-on" : ""}`} onClick={() => setInApp((v) => !v)} aria-pressed={inApp}>
                  In the app
                </button>
                <button type="button" className={`chip-btn${onWhatsApp ? " is-on" : ""}`} onClick={() => setOnWhatsApp((v) => !v)} aria-pressed={onWhatsApp}>
                  WhatsApp
                </button>
              </div>
              {error && <p className="field-error">{error}</p>}
            </div>
            <footer className="filter-foot">
              <button type="button" className="link-btn" onClick={() => setStep("who")}>
                Back
              </button>
              <button type="button" className="btn btn-primary" disabled={!body.trim() || busy || (!inApp && !onWhatsApp)} onClick={send}>
                {busy ? "Sending…" : `Send to ${parents}`}
              </button>
            </footer>
          </>
        )}

        {step === "whatsapp" && tap && (
          <>
            <div className="filter-body">
              <p className="bulk-to">
                {tap.sentApp > 0 && `Sent in the app to ${tap.sentApp.toLocaleString("en-IN")} ${tap.sentApp === 1 ? "student’s" : "students’"} parents. `}
                Now tap each parent: WhatsApp opens with your message ready to send.
              </p>
              <p className="bulk-progress">
                <strong>
                  {tap.done.length.toLocaleString("en-IN")} of {tap.rows.length.toLocaleString("en-IN")}
                </strong>{" "}
                opened
                {tap.missing > 0 && ` · ${tap.missing.toLocaleString("en-IN")} without a phone number`}
              </p>
              <ul className="bulk-list">
                {tap.rows.map((r) => {
                  const done = tap.done.includes(r.phone);
                  return (
                    <li key={r.phone} className={done ? "is-done" : ""}>
                      <span>{r.names.join(", ")}</span>
                      <a className="chip-btn" href={link(r)} target="_blank" rel="noreferrer" onClick={() => opened(r.phone)}>
                        {done ? <Icon name="check" size={14} /> : <WhatsAppLogo size={16} />}
                        {done ? "Opened" : "Send"}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
            <footer className="filter-foot">
              <button type="button" className="link-btn" onClick={finish}>
                {next ? "Stop here" : "Done"}
              </button>
              {next && (
                <a className="btn btn-primary" href={link(next)} target="_blank" rel="noreferrer" onClick={() => opened(next.phone)}>
                  <WhatsAppLogo size={18} /> Send next
                </a>
              )}
            </footer>
          </>
        )}
      </section>
    </div>,
    document.body
  );
}
