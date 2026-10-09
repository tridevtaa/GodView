import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cancelParentRequest,
  createParentRequest,
  listGrades,
  listResults,
  logoUrl,
  markParentSeen,
  parentFamily,
  parentFees,
  parentNotes,
  parentRequests,
  parentUnread,
} from "../data/api.js";
import { METHODS, rupees } from "../data/money.js";
import { logOut } from "./AuthGate.jsx";
import { LogoMark } from "./Logo.jsx";
import { Photo, gradeLabel, setGradeLabels, tintFor } from "./PersonCard.jsx";
import Receipt from "./Receipt.jsx";
import Icon from "./Icon.jsx";
import "./parent.css";

const TABS = [
  ["fees", "Fees"],
  ["results", "Results"],
  ["notes", "Notes"],
  ["requests", "Requests"],
];
const today = () => new Date().toISOString().slice(0, 10);
const dateText = (d, opts = { day: "numeric", month: "short", year: "numeric" }) =>
  d ? new Date(d).toLocaleDateString("en-IN", opts) : "";
const showPhone = (p = "") => p.replace(/^\+?91(\d{5})(\d{5})$/, "+91 $1 $2");

// Home for a signed-in parent: their children, and for each one the fees,
// results, notes the school shared, and requests to the school.
export default function ParentApp({ phone }) {
  const [children, setChildren] = useState(null);
  const [error, setError] = useState("");
  const [childId, setChildId] = useState(null);
  const [tab, setTab] = useState("fees");
  // "<child>:<section>" -> { unread, seen_at }, from the database.
  const [unread, setUnread] = useState(new Map());
  // When the open section was last seen before this visit, to mark items New.
  const [since, setSince] = useState(null);

  const loadUnread = useCallback(
    () =>
      parentUnread().then(
        (rows) => setUnread(new Map(rows.map((r) => [`${r.student_id}:${r.section}`, { unread: Number(r.unread), seen_at: r.seen_at }]))),
        () => {}
      ),
    []
  );

  // Refresh the dots when the parent comes back to the app, and every minute.
  useEffect(() => {
    loadUnread();
    const onShow = () => document.visibilityState === "visible" && loadUnread();
    document.addEventListener("visibilitychange", onShow);
    const t = setInterval(loadUnread, 60000);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      clearInterval(t);
    };
  }, [loadUnread]);

  useEffect(() => {
    parentFamily()
      .then(async (kids) => {
        // The school's own grade names ("KG 1", "Class 5"…), best effort.
        if (kids[0]) await listGrades(kids[0].school_id).then(setGradeLabels, () => {});
        setChildren(kids);
        setChildId(kids[0]?.id ?? null);
      })
      .catch(() => setError("Couldn’t load your children’s details. Check your connection and reload."));
  }, []);

  const child = children?.find((c) => c.id === childId);
  const school = child?.school ?? children?.[0]?.school;
  // New-item counts, shown like the Owner page's red number badges.
  const count = (id, section) => unread.get(`${id}:${section}`)?.unread ?? 0;
  const childCount = (id) => TABS.reduce((t, [v]) => t + count(id, v), 0);
  const badge = (n, label) =>
    n > 0 && (
      <span className="seg-count" aria-label={`${n} new ${label}`}>
        {n > 99 ? "99+" : n}
      </span>
    );

  // Opening a section marks it seen; keep the previous time to show "New".
  useEffect(() => {
    if (!childId) return;
    const key = `${childId}:${tab}`;
    setSince(unread.get(key)?.seen_at ?? null);
    if (!unread.has(key)) return; // dots not loaded yet
    if (unread.get(key).unread === 0 && unread.get(key).seen_at) return;
    markParentSeen(childId, tab).then(
      () => setUnread((m) => new Map(m).set(key, { unread: 0, seen_at: new Date().toISOString() })),
      () => {}
    );
  }, [childId, tab, unread.size]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="pa">
      <header className="pa-top">
        <div className="pa-top-inner">
          <span className="pa-brand">
            <LogoMark size={24} />
            {school && (
              <>
                <span className="logo-x" aria-hidden="true">×</span>
                {school.logo_path ? (
                  <img className="pa-school-logo" src={logoUrl(school.logo_path)} alt={school.short_name || school.name} />
                ) : (
                  <span className="pa-school-name">{school.short_name || school.name}</span>
                )}
              </>
            )}
          </span>
          <span className="pa-me">
            <span className="row-sub">{showPhone(phone)}</span>
            <button className="btn btn-secondary btn-sm" onClick={logOut}>
              Log out
            </button>
          </span>
        </div>
      </header>

      <main className="pa-main">
        {error && <p className="notice notice-error">{error}</p>}
        {!children && !error && <div className="pa-hero pa-skeleton" aria-busy="true" />}
        {children && !children.length && <NotLinked phone={phone} />}

        {children?.length > 1 && (
          <nav className="pa-kids" aria-label="Your children">
            {children.map((c) => (
              <button key={c.id} className={c.id === childId ? "is-on" : ""} onClick={() => setChildId(c.id)}>
                <Photo person={c} className="pa-kid-photo" />
                <span>{c.name.split(" ")[0]}</span>
                {c.id !== childId && badge(childCount(c.id), "updates")}
              </button>
            ))}
          </nav>
        )}

        {child && (
          <>
            <section className="pa-hero" style={{ "--tint": tintFor(child) }}>
              <Photo person={child} className="pa-hero-photo" />
              <div className="pa-hero-text">
                <h1>{child.name}</h1>
                <div className="pa-chips">
                  {child.class && <span className="is-tag">{gradeLabel(child.class)}</span>}
                  {child.section && <span>Section {child.section}</span>}
                  {child.admission_no && <span>#{child.admission_no}</span>}
                </div>
                <p className="row-sub">
                  {child.school?.name}
                  {child.session ? ` · Session ${child.session.name}` : ""}
                </p>
              </div>
            </section>

            <nav className="segmented pa-tabs" aria-label="Sections">
              {TABS.map(([v, l]) => (
                <button key={v} className={tab === v ? "active" : ""} onClick={() => setTab(v)}>
                  {l}
                  {tab !== v && badge(count(child.id, v), l.toLowerCase())}
                </button>
              ))}
            </nav>

            {tab === "fees" && <FeesTab key={child.id} child={child} since={since} />}
            {tab === "results" && <ResultsTab key={child.id} child={child} since={since} />}
            {tab === "notes" && <NotesTab key={child.id} child={child} since={since} />}
            {tab === "requests" && <RequestsTab key={child.id} child={child} since={since} />}
          </>
        )}
      </main>
    </div>
  );
}

// Newer than the parent's last visit to this section (never on a first visit,
// when everything would be "new").
const isNew = (when, since) => Boolean(when && since && when > since);
const NewTag = () => <span className="pa-new-tag">New</span>;

function NotLinked({ phone }) {
  return (
    <section className="pa-card pa-empty">
      <span className="pa-empty-icon">
        <Icon name="phone" size={22} />
      </span>
      <h1>We couldn’t find your child</h1>
      <p className="row-sub">
        {showPhone(phone)} isn’t linked to a student yet. Ask the school office to add this number as a parent in your
        child’s profile, then log in again.
      </p>
      <button className="btn btn-secondary" onClick={logOut}>
        Use a different number
      </button>
    </section>
  );
}

function useLoad(load) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const run = useCallback(() => {
    load().then(
      (d) => (setData(d), setError("")),
      () => setError("Couldn’t load this. Check your connection and try again.")
    );
  }, [load]);
  useEffect(run, [run]);
  return { data, error, reload: run };
}

// ----------------------------------------------------------------- fees ---

function FeesTab({ child, since }) {
  const load = useCallback(() => parentFees(child.id, child.school_id), [child.id, child.school_id]);
  const { data, error } = useLoad(load);
  const [receipt, setReceipt] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const view = useMemo(() => {
    if (!data) return null;
    const now = today();
    const open = data.dues.filter((d) => Number(d.balance) > 0.009);
    const dueNow = open.filter((d) => !d.due_date || d.due_date <= now);
    const upcoming = open.filter((d) => d.due_date && d.due_date > now);
    const paid = data.payments.filter((p) => p.status === "success");
    const session = child.session;
    const inSession = (d) => !session || ((!session.starts_on || d >= session.starts_on) && (!session.ends_on || d <= session.ends_on));
    return {
      dueNow,
      upcoming,
      payments: data.payments,
      dueTotal: dueNow.reduce((t, d) => t + Number(d.balance), 0),
      paidTotal: paid.filter((p) => inSession(p.paid_on)).reduce((t, p) => t + Number(p.amount), 0),
      next: upcoming[0],
    };
  }, [data, child.session]);

  if (error) return <p className="notice notice-error">{error}</p>;
  if (!view) return <div className="pa-card pa-skeleton" aria-busy="true" />;

  const later = showAll ? view.upcoming : view.upcoming.slice(0, 3);
  return (
    <>
      <section className="pa-stats">
        <div className={view.dueTotal > 0 ? "is-due" : "is-clear"}>
          <span>Due now</span>
          <strong>{rupees(view.dueTotal)}</strong>
          <small>{view.dueTotal > 0 ? `${view.dueNow.length} item${view.dueNow.length === 1 ? "" : "s"}` : "All clear"}</small>
        </div>
        <div>
          <span>Paid this session</span>
          <strong>{rupees(view.paidTotal)}</strong>
          <small>{view.payments.filter((p) => p.status === "success").length} payments</small>
        </div>
        <div>
          <span>Next due</span>
          <strong>{view.next ? rupees(view.next.balance) : "Nothing"}</strong>
          <small>{view.next ? dateText(view.next.due_date, { day: "numeric", month: "short" }) : "No upcoming dues"}</small>
        </div>
      </section>

      {view.dueNow.length > 0 && (
        <section className="pa-card">
          <h2 className="pa-h2">Due now</h2>
          <ul className="pa-list">
            {view.dueNow.map((d) => (
              <DueRow key={d.id} due={d} overdue={d.due_date && d.due_date < today()} fresh={isNew(d.created_at, since)} />
            ))}
          </ul>
          <p className="pa-hint">
            <Icon name="check" size={14} /> Pay at the school office for now. Paying online in the app is coming soon.
          </p>
        </section>
      )}

      {view.upcoming.length > 0 && (
        <section className="pa-card">
          <h2 className="pa-h2">Coming up</h2>
          <ul className="pa-list">
            {later.map((d) => (
              <DueRow key={d.id} due={d} fresh={isNew(d.created_at, since)} />
            ))}
          </ul>
          {view.upcoming.length > 3 && (
            <button className="link-btn pa-more" onClick={() => setShowAll((s) => !s)}>
              {showAll ? "Show fewer" : `Show all ${view.upcoming.length}`}
            </button>
          )}
        </section>
      )}

      <section className="pa-card">
        <h2 className="pa-h2">Payments and receipts</h2>
        {view.payments.length ? (
          <ul className="pa-list">
            {view.payments.map((p) => (
              <li key={p.id} className="pa-row">
                <span className="pa-row-icon is-paid">
                  <Icon name="check" size={14} />
                </span>
                <span className="pa-row-main">
                  <strong>
                    {rupees(p.amount)} {isNew(p.created_at, since) && <NewTag />}
                  </strong>
                  <span className="row-sub">
                    {dateText(p.paid_on)} · {METHODS[p.method] ?? p.method} · <span className="pa-nowrap">{p.receipt_no}</span>
                    {p.status === "cancelled" && " · Cancelled"}
                  </span>
                </span>
                <button className="btn btn-secondary btn-sm" onClick={() => setReceipt(p)}>
                  <Icon name="file" /> Receipt
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="row-sub">No payments recorded yet.</p>
        )}
      </section>

      {receipt && <Receipt school={child.school} person={child} payment={receipt} dues={data.dues} onClose={() => setReceipt(null)} />}
    </>
  );
}

function DueRow({ due, overdue, fresh }) {
  return (
    <li className="pa-row">
      <span className={`pa-row-icon${overdue ? " is-overdue" : " is-due"}`}>₹</span>
      <span className="pa-row-main">
        <strong>
          {due.head_name ?? "Fee"} · {due.label} {fresh && <NewTag />}
        </strong>
        <span className="row-sub">
          {due.due_date ? `Due ${dateText(due.due_date)}` : "Due now"}
          {Number(due.paid) > 0 && ` · ${rupees(due.paid)} paid`}
        </span>
      </span>
      <span className="pa-row-amount">
        {rupees(due.balance)}
        {overdue && <span className="badge badge-danger">Overdue</span>}
      </span>
    </li>
  );
}

// -------------------------------------------------------------- results ---

function ResultsTab({ child, since }) {
  const load = useCallback(() => (child.session ? listResults(child.id, child.session.id) : Promise.resolve([])), [child.id, child.session]);
  const { data, error } = useLoad(load);

  const exams = useMemo(() => {
    const m = new Map();
    for (const r of data ?? []) m.set(r.exam, [...(m.get(r.exam) ?? []), r]);
    return [...m];
  }, [data]);

  if (error) return <p className="notice notice-error">{error}</p>;
  if (!data) return <div className="pa-card pa-skeleton" aria-busy="true" />;
  if (!exams.length) return <Empty icon="edit" title="No results yet" text="Marks appear here once the school enters them." />;

  return exams.map(([exam, rows]) => {
    const scored = rows.filter((r) => r.marks != null && r.max_marks);
    const got = scored.reduce((t, r) => t + Number(r.marks), 0);
    const max = scored.reduce((t, r) => t + Number(r.max_marks), 0);
    const pct = max ? Math.round((got / max) * 1000) / 10 : null;
    return (
      <section key={exam} className="pa-card">
        <div className="pa-exam-head">
          <h2 className="pa-h2">{exam}</h2>
          {pct != null && <span className="pa-pct">{pct}%</span>}
        </div>
        <table className="pa-table">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Marks</th>
              <th>Grade</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.subject} {isNew(r.updated_at, since) && <NewTag />}
                  {r.remarks && <span className="row-sub pa-remark">{r.remarks}</span>}
                </td>
                <td className="pa-num">
                  {r.marks ?? "–"}
                  {r.max_marks ? <span className="row-sub"> / {Number(r.max_marks)}</span> : null}
                </td>
                <td>{r.grade || ""}</td>
              </tr>
            ))}
          </tbody>
          {max > 0 && (
            <tfoot>
              <tr>
                <th>Total</th>
                <th className="pa-num">
                  {got} <span className="row-sub">/ {max}</span>
                </th>
                <th />
              </tr>
            </tfoot>
          )}
        </table>
      </section>
    );
  });
}

// ---------------------------------------------------------------- notes ---

function NotesTab({ child, since }) {
  const load = useCallback(() => parentNotes(child.id), [child.id]);
  const { data, error } = useLoad(load);
  if (error) return <p className="notice notice-error">{error}</p>;
  if (!data) return <div className="pa-card pa-skeleton" aria-busy="true" />;
  if (!data.length) return <Empty icon="message" title="No notes yet" text="Notes your child’s teachers share with you will appear here." />;
  return (
    <section className="pa-card">
      <ul className="pa-notes">
        {data.map((n) => (
          <li key={n.id} className={isNew(n.updated_at, since) ? "is-new" : ""}>
            <span className="row-sub">
              {dateText(n.created_at)} {isNew(n.updated_at, since) && <NewTag />}
            </span>
            <p>{n.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------- requests ---

const KINDS = [
  ["leave", "Leave"],
  ["certificate", "Certificate"],
  ["message", "Message"],
];
const STATUS = {
  open: ["Waiting", "badge-warning"],
  approved: ["Approved", "badge-success"],
  rejected: ["Not approved", "badge-danger"],
  resolved: ["Done", "badge-success"],
  cancelled: ["Withdrawn", "badge-neutral"],
};
const CERTIFICATES = ["Bonafide certificate", "Character certificate", "Transfer certificate", "Fee certificate", "Other"];

function RequestsTab({ child, since }) {
  const load = useCallback(() => parentRequests(child.id), [child.id]);
  const { data, error, reload } = useLoad(load);
  const [writing, setWriting] = useState(false);

  async function withdraw(id) {
    try {
      await cancelParentRequest(id);
      reload();
    } catch {
      // Already handled by the school; the reload shows the new status.
      reload();
    }
  }

  if (error) return <p className="notice notice-error">{error}</p>;
  if (!data) return <div className="pa-card pa-skeleton" aria-busy="true" />;

  return (
    <>
      {writing ? (
        <RequestForm child={child} onCancel={() => setWriting(false)} onSent={() => (setWriting(false), reload())} />
      ) : (
        <button className="pa-new" onClick={() => setWriting(true)}>
          <span className="pa-new-icon">
            <Icon name="plus" size={18} />
          </span>
          <span>
            <strong>New request</strong>
            <span className="row-sub">Leave, a certificate, or a message to the school</span>
          </span>
        </button>
      )}

      {data.length ? (
        <section className="pa-card">
          <ul className="pa-list">
            {data.map((r) => {
              const [label, tone] = STATUS[r.status] ?? [r.status, "badge-neutral"];
              return (
                <li key={r.id} className="pa-request">
                  <div className="pa-request-head">
                    <strong>
                      {r.subject} {isNew(r.handled_at, since) && <NewTag />}
                    </strong>
                    <span className={`badge ${tone}`}>{label}</span>
                  </div>
                  <span className="row-sub">
                    {KINDS.find(([k]) => k === r.kind)?.[1]}
                    {r.kind === "leave" && ` · ${dateText(r.leave_from, { day: "numeric", month: "short" })} to ${dateText(r.leave_to, { day: "numeric", month: "short" })}`}
                    {r.certificate_type && ` · ${r.certificate_type}`} · sent {dateText(r.created_at)}
                  </span>
                  {r.body && <p className="pa-request-body">{r.body}</p>}
                  {r.response && (
                    <p className="pa-reply">
                      <strong>School:</strong> {r.response}
                    </p>
                  )}
                  {r.status === "open" && (
                    <button className="link-btn" onClick={() => withdraw(r.id)}>
                      Withdraw
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        !writing && <Empty icon="file" title="No requests yet" text="Requests you send to the school, and their replies, appear here." />
      )}
    </>
  );
}

function RequestForm({ child, onCancel, onSent }) {
  const [form, setForm] = useState({ kind: "leave", subject: "", body: "", leave_from: today(), leave_to: today(), certificate_type: CERTIFICATES[0] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const first = child.name.split(" ")[0];

  function subjectFor(f) {
    if (f.subject.trim()) return f.subject.trim();
    if (f.kind === "leave") return `Leave for ${first}`;
    if (f.kind === "certificate") return `${f.certificate_type} for ${first}`;
    return "";
  }

  async function submit(e) {
    e.preventDefault();
    const subject = subjectFor(form);
    if (!subject) return setError("Add a subject for your message.");
    if (form.kind === "leave" && form.leave_to < form.leave_from) return setError("The last day can’t be before the first day.");
    setBusy(true);
    setError("");
    try {
      await createParentRequest(child.id, {
        kind: form.kind,
        subject,
        body: form.body.trim(),
        leave_from: form.kind === "leave" ? form.leave_from : null,
        leave_to: form.kind === "leave" ? form.leave_to : null,
        certificate_type: form.kind === "certificate" ? form.certificate_type : null,
      });
      onSent();
    } catch {
      setError("Couldn’t send the request. Please try again.");
      setBusy(false);
    }
  }

  return (
    <form className="pa-card pa-form" onSubmit={submit}>
      <h2 className="pa-h2">New request for {first}</h2>
      <nav className="segmented pa-kind" aria-label="Request type">
        {KINDS.map(([k, l]) => (
          <button type="button" key={k} className={form.kind === k ? "active" : ""} onClick={() => setForm({ ...form, kind: k })}>
            {l}
          </button>
        ))}
      </nav>
      {form.kind === "leave" && (
        <div className="pa-dates">
          <label>
            <span>From</span>
            <input type="date" className="input" value={form.leave_from} onChange={set("leave_from")} required />
          </label>
          <label>
            <span>To</span>
            <input type="date" className="input" value={form.leave_to} min={form.leave_from} onChange={set("leave_to")} required />
          </label>
        </div>
      )}
      {form.kind === "certificate" && (
        <label>
          <span>Certificate</span>
          <select className="select" value={form.certificate_type} onChange={set("certificate_type")}>
            {CERTIFICATES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      )}
      <label>
        <span>Subject{form.kind === "message" ? "" : " (optional)"}</span>
        <input className="input" value={form.subject} onChange={set("subject")} maxLength={150} placeholder={subjectFor({ ...form, subject: "" }) || "What is it about?"} />
      </label>
      <label>
        <span>{form.kind === "leave" ? "Reason" : "Details"}</span>
        <textarea className="textarea" rows={3} value={form.body} onChange={set("body")} maxLength={2000} />
      </label>
      {error && <p className="field-error">{error}</p>}
      <div className="pa-form-foot">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Sending…" : "Send to school"}
        </button>
      </div>
    </form>
  );
}

function Empty({ icon, title, text }) {
  return (
    <section className="pa-card pa-empty">
      <span className="pa-empty-icon">
        <Icon name={icon} size={20} />
      </span>
      <strong>{title}</strong>
      <p className="row-sub">{text}</p>
    </section>
  );
}
