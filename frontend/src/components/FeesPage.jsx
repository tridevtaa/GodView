import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addFeeHead,
  addScheduleLine,
  deleteFeeHead,
  deleteScheduleLine,
  feeSessionSummary,
  generateInvoices,
  listFeeHeads,
  listSchedule,
} from "../data/api.js";
import { rupees } from "../data/money.js";
import { gradeLabel } from "./PersonCard.jsx";
import { gradeOptions } from "./GradeFilter.jsx";
import OpeningBalances from "./OpeningBalances.jsx";
import Icon from "./Icon.jsx";

// Plain-language choices, stored as the database's frequency values.
const HOW_OFTEN = [
  ["monthly", "Every month", 12],
  ["quarterly", "Every 3 months", 4],
  ["half_yearly", "Twice a year", 2],
  ["annual", "Once a year", 1],
  ["one_time", "One time", 1],
];
const PER_YEAR = Object.fromEntries(HOW_OFTEN.map(([k, , n]) => [k, n]));
const LABEL = Object.fromEntries(HOW_OFTEN.map(([k, l]) => [k, l.toLowerCase()]));
const SUGGESTED = ["Tuition fee", "Transport", "Annual charges", "Admission fee", "Exam fee", "Computer fee", "Activity fee", "Development fee"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STEPS = ["What you charge", "Amounts", "Create dues"];

// Owners/admins. First visit: a 3-step setup. After dues exist: a simple
// dashboard with Collect, Edit setup and Old balances.
export default function FeesPage({ school, session, students, onOpenStudent, onChanged }) {
  const [summary, setSummary] = useState(null);
  const [heads, setHeads] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [step, setStep] = useState(null); // null = dashboard, 0..2 = setup
  const [dialog, setDialog] = useState(null); // "collect" | "balances"

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const [s, h, sch] = await Promise.all([feeSessionSummary(session.id), listFeeHeads(school.id), listSchedule(session.id)]);
      setSummary(s);
      setHeads(h);
      setSchedule(sch);
      setError("");
      // No dues yet: go straight into setup.
      setStep((cur) => (cur === null && !(Number(s?.billed) > 0) ? 0 : cur));
    } catch (err) {
      setError(
        err?.code === "PGRST205"
          ? "Fees aren’t set up in the database yet. The latest database update needs to be applied first."
          : "Couldn’t load fees. Check your connection and try again."
      );
    }
  }, [school.id, session]);

  useEffect(() => {
    load();
  }, [load]);

  const act = (fn) => async (...args) => {
    setError("");
    try {
      await fn(...args);
      await load();
      return true;
    } catch (err) {
      setError(err?.code === "23505" ? "That already exists." : "That didn’t go through. Check the values and try again.");
      return false;
    }
  };

  if (!session) return <p className="notice">Import your students first; fees are set up per session.</p>;

  const hasDues = Number(summary?.billed) > 0;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="sr-only">Fees</h1>
          <div className="page-meta">
            <span className="page-count">Fees</span>
            <span className="badge badge-neutral">Session {session.name}</span>
          </div>
        </div>
        {step === null && (
          <div className="page-actions">
            <button className="btn btn-secondary" onClick={() => setDialog("balances")}>
              <Icon name="upload" />
              Old balances
            </button>
            <button className="btn btn-secondary" onClick={() => setStep(1)}>
              <Icon name="edit" />
              Edit fee setup
            </button>
            <button className="btn btn-primary" onClick={() => setDialog("collect")}>
              <Icon name="plus" />
              Collect a payment
            </button>
          </div>
        )}
      </div>

      {error && <p className="notice notice-error">{error}</p>}
      {notice && <p className="notice notice-success">{notice}</p>}

      {step !== null ? (
        <Setup
          step={step}
          setStep={setStep}
          session={session}
          school={school}
          heads={heads}
          schedule={schedule}
          students={students}
          hasDues={hasDues}
          act={act}
          onCreated={async (n) => {
            setNotice(n ? `Done. ${n.toLocaleString("en-IN")} dues created for ${session.name}.` : "Everything was already up to date.");
            setStep(null);
            await load();
            onChanged();
          }}
          onCancel={hasDues ? () => setStep(null) : null}
        />
      ) : (
        <Dashboard summary={summary} students={students} onCollect={(id) => onOpenStudent(id, "fees")} />
      )}

      {dialog === "collect" && (
        <Dialog title="Collect a payment" onClose={() => setDialog(null)}>
          <StudentPicker
            students={students}
            onPick={(s) => {
              setDialog(null);
              onOpenStudent(s.id, "fees");
            }}
          />
        </Dialog>
      )}
      {dialog === "balances" && (
        <Dialog title="Bring in old balances" onClose={() => setDialog(null)}>
          <OpeningBalances
            embedded
            school={school}
            session={session}
            students={students}
            onDone={async () => {
              await load();
              onChanged();
            }}
          />
        </Dialog>
      )}
    </>
  );
}

// ------------------------------------------------------------- dashboard ---

function Dashboard({ summary, students, onCollect }) {
  const [query, setQuery] = useState("");
  const owing = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students
      .filter((s) => s.fee_due > 0)
      .filter((s) => !q || `${s.name} ${s.admission_no}`.toLowerCase().includes(q))
      .sort((a, b) => b.fee_due - a.fee_due);
  }, [students, query]);
  const collectedPct = summary && Number(summary.billed) > 0 ? Math.round((summary.collected / summary.billed) * 100) : 0;

  return (
    <>
      <section className="fee-cards">
        <Stat label="Due now" value={summary?.due_now} tone="due" note={summary ? `${summary.students_due} students` : ""} />
        <Stat label="Collected" value={summary?.collected} tone="paid" note={summary ? `${collectedPct}% of the year` : ""} />
        <Stat label="Expected this year" value={summary?.billed} />
        <Stat label="Still to come" value={summary ? summary.outstanding - summary.due_now : undefined} />
      </section>

      <section className="panel">
        <div className="panel-title panel-title-row">
          <h2>Who owes now</h2>
          <input className="input" placeholder="Search name or admission no." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {owing.length === 0 ? (
          <p className="row-sub panel-empty">{query ? "No match." : "Nobody owes anything right now. 🎉"}</p>
        ) : (
          <ul className="dues-list">
            {owing.slice(0, 200).map((s) => (
              <li key={s.id}>
                <div className="dues-row">
                  <span>
                    <strong>{s.name}</strong>
                    <span className="row-sub">
                      {s.admission_no} · {gradeLabel(s.class)}
                      {s.section ? ` · ${s.section}` : ""}
                    </span>
                  </span>
                  <span className={`badge ${s.fee_status === "overdue" ? "badge-danger" : "badge-warning"}`}>{rupees(s.fee_due)}</span>
                  <button className="btn btn-secondary btn-sm" onClick={() => onCollect(s.id)}>
                    Collect
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Stat({ label, value, tone, note }) {
  return (
    <div className="fee-card">
      <span>{label}</span>
      <strong className={tone ? `is-${tone}` : ""}>{value === undefined ? "…" : rupees(value)}</strong>
      {note && <span className="row-sub">{note}</span>}
    </div>
  );
}

// ----------------------------------------------------------------- setup ---

function Setup({ step, setStep, session, school, heads, schedule, students, hasDues, act, onCreated, onCancel }) {
  const canNext = step === 0 ? heads.length > 0 : step === 1 ? heads.every((h) => schedule.some((l) => l.head_id === h.id)) : true;

  return (
    <section className="panel setup">
      <ol className="stepper">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? "is-current" : i < step ? "is-done" : ""}>
            <button onClick={() => (i <= step || canNext) && setStep(i)} disabled={i > step && !canNext}>
              <span className="stepper-num">{i < step ? <Icon name="check" size={14} /> : i + 1}</span>
              {label}
            </button>
          </li>
        ))}
      </ol>

      <div className="setup-body">
        {step === 0 && <ChooseHeads school={school} heads={heads} schedule={schedule} act={act} />}
        {step === 1 && <Amounts school={school} session={session} heads={heads} schedule={schedule} students={students} act={act} />}
        {step === 2 && <Review heads={heads} schedule={schedule} students={students} session={session} hasDues={hasDues} onCreated={onCreated} />}
      </div>

      <div className="setup-nav">
        {onCancel ? (
          <button className="btn btn-secondary" onClick={onCancel}>
            Back to fees
          </button>
        ) : (
          <span />
        )}
        <div className="setup-nav-right">
          {step > 0 && (
            <button className="btn btn-secondary" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          {step < 2 && (
            <button className="btn btn-primary" onClick={() => setStep(step + 1)} disabled={!canNext}>
              Next
              <Icon name="chevronDown" className="icon-next" />
            </button>
          )}
        </div>
      </div>
      {!canNext && step === 1 && <p className="row-sub setup-hint">Give every fee an amount to continue.</p>}
    </section>
  );
}

function ChooseHeads({ school, heads, schedule, act }) {
  const [custom, setCustom] = useState("");
  const chosen = new Map(heads.map((h) => [h.name.toLowerCase(), h]));
  const options = [...SUGGESTED, ...heads.map((h) => h.name).filter((n) => !SUGGESTED.some((s) => s.toLowerCase() === n.toLowerCase()))];

  return (
    <>
      <h2 className="setup-title">What does your school charge?</h2>
      <p className="row-sub">Tap every fee you collect. You can add your own.</p>
      <div className="head-picks">
        {options.map((name) => {
          const head = chosen.get(name.toLowerCase());
          const used = head && schedule.some((l) => l.head_id === head.id);
          return (
            <button
              key={name}
              className={`head-pick${head ? " on" : ""}`}
              aria-pressed={Boolean(head)}
              onClick={act(() => (head ? (used ? Promise.resolve() : deleteFeeHead(head.id)) : addFeeHead(school.id, name)))}
              title={used ? "Has amounts set; remove them in the next step first" : ""}
            >
              {head && <Icon name="check" size={14} />}
              {name}
            </button>
          );
        })}
      </div>
      <form
        className="add-head"
        onSubmit={async (e) => {
          e.preventDefault();
          if (custom.trim() && (await act(() => addFeeHead(school.id, custom.trim()))())) setCustom("");
        }}
      >
        <input className="input" placeholder="Another fee, e.g. Smart class" value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={60} />
        <button className="btn btn-secondary btn-sm" disabled={!custom.trim()}>
          <Icon name="plus" />
          Add
        </button>
      </form>
    </>
  );
}

function Amounts({ school, session, heads, schedule, students, act }) {
  const grades = useMemo(() => gradeOptions(students), [students]);
  return (
    <>
      <h2 className="setup-title">How much, and how often?</h2>
      <p className="row-sub">Set one amount for all classes, then add a different amount for any class that pays more or less.</p>
      <div className="amount-cards">
        {heads.map((h) => (
          <AmountCard
            key={h.id}
            head={h}
            lines={schedule.filter((l) => l.head_id === h.id)}
            grades={grades}
            onAdd={act((line) => addScheduleLine(school.id, session.id, { ...line, head_id: h.id }))}
            onRemove={act((id) => deleteScheduleLine(id))}
          />
        ))}
      </div>
    </>
  );
}

function AmountCard({ head, lines, grades, onAdd, onRemove }) {
  const general = lines.find((l) => !l.class);
  const specific = lines.filter((l) => l.class);
  const [adding, setAdding] = useState(!general);

  return (
    <article className="amount-card">
      <header>
        <h3>{head.name}</h3>
        {general && (
          <span className="amount-line">
            <strong>{rupees(general.amount)}</strong> {LABEL[general.frequency]} · all classes
            <button className="link-btn" onClick={() => onRemove(general.id)}>
              Change
            </button>
          </span>
        )}
      </header>

      {specific.length > 0 && (
        <ul className="amount-overrides">
          {specific.map((l) => (
            <li key={l.id}>
              <span>
                {gradeLabel(l.class)}: <strong>{rupees(l.amount)}</strong> {LABEL[l.frequency]}
              </span>
              <button className="link-btn link-danger" onClick={() => onRemove(l.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {!general ? (
        <AmountForm forAll grades={grades} onSave={(line) => onAdd(line)} />
      ) : adding ? (
        <AmountForm grades={grades} taken={specific.map((l) => l.class)} onSave={async (line) => (await onAdd(line)) && setAdding(false)} onCancel={() => setAdding(false)} />
      ) : (
        <button className="link-btn amount-more" onClick={() => setAdding(true)}>
          + Different amount for a class
        </button>
      )}
    </article>
  );
}

function AmountForm({ forAll = false, grades, taken = [], onSave, onCancel }) {
  const [line, setLine] = useState({ class: "", amount: "", frequency: "monthly", start_month: 4, due_day: 10 });
  const [more, setMore] = useState(false);
  const set = (k, v) => setLine({ ...line, [k]: v });
  const choices = grades.filter((g) => !taken.includes(g.value));

  return (
    <form
      className="amount-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...line, class: forAll ? "" : line.class });
      }}
    >
      <div className="amount-form-row">
        {!forAll && (
          <select className="select" value={line.class} onChange={(e) => set("class", e.target.value)} required>
            <option value="" disabled>
              Choose class
            </option>
            {choices.map((g) => (
              <option key={g.value} value={g.value}>
                {gradeLabel(g.value)}
              </option>
            ))}
          </select>
        )}
        <label className="rupee-input">
          <span>₹</span>
          <input type="number" min="1" step="1" placeholder="Amount" value={line.amount} onChange={(e) => set("amount", e.target.value)} required autoFocus={!forAll} />
        </label>
      </div>
      <div className="pill-group" role="radiogroup" aria-label="How often">
        {HOW_OFTEN.map(([value, label]) => (
          <button
            type="button"
            key={value}
            role="radio"
            aria-checked={line.frequency === value}
            className={`pill${line.frequency === value ? " on" : ""}`}
            onClick={() => set("frequency", value)}
          >
            {label}
          </button>
        ))}
      </div>
      {more ? (
        <div className="amount-form-row amount-more-opts">
          <label>
            <span className="row-sub">First due in</span>
            <select className="select" value={line.start_month} onChange={(e) => set("start_month", e.target.value)}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="row-sub">Due on day</span>
            <input className="input input-num" type="number" min="1" max="28" value={line.due_day} onChange={(e) => set("due_day", e.target.value)} />
          </label>
        </div>
      ) : (
        <button type="button" className="link-btn amount-more" onClick={() => setMore(true)}>
          More options (first month, due day)
        </button>
      )}
      <div className="amount-form-actions">
        {onCancel && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="btn btn-primary btn-sm" disabled={!(Number(line.amount) > 0) || (!forAll && !line.class)}>
          Save
          {Number(line.amount) > 0 && ` · ${rupees(line.amount * PER_YEAR[line.frequency])} a year`}
        </button>
      </div>
    </form>
  );
}

function Review({ heads, schedule, students, session, hasDues, onCreated }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const grades = useMemo(() => gradeOptions(students.filter((s) => s.status !== "left")), [students]);

  // Yearly fee per student for each class: class-specific amounts replace
  // the all-classes amount for that fee (same rule as the database).
  const rows = grades.map((g) => {
    const perStudent = heads.reduce((sum, h) => {
      const line = schedule.find((l) => l.head_id === h.id && l.class === g.value) ?? schedule.find((l) => l.head_id === h.id && !l.class);
      return sum + (line ? Number(line.amount) * PER_YEAR[line.frequency] : 0);
    }, 0);
    return { grade: g.value, students: g.count, perStudent, total: perStudent * g.count };
  });
  const total = rows.reduce((s, r) => s + r.total, 0);

  async function create() {
    setBusy(true);
    setError("");
    try {
      onCreated(await generateInvoices(session.id));
    } catch {
      setError("Couldn’t create the dues. Try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <h2 className="setup-title">Check and create dues</h2>
      <p className="row-sub">
        This is what each student will owe for {session.name}. Creating dues sets up every instalment with its due date.
        {hasDues && " Existing dues are kept; only missing ones are added."}
      </p>
      <table className="review-table">
        <thead>
          <tr>
            <th>Class</th>
            <th className="num">Per student, per year</th>
            <th className="num">Students</th>
            <th className="num">Class total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.grade}>
              <td>{gradeLabel(r.grade)}</td>
              <td className="num">{rupees(r.perStudent)}</td>
              <td className="num">{r.students}</td>
              <td className="num">{rupees(r.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th>Whole school</th>
            <th />
            <th className="num">{rows.reduce((s, r) => s + r.students, 0)}</th>
            <th className="num">{rupees(total)}</th>
          </tr>
        </tfoot>
      </table>
      {error && <p className="field-error">{error}</p>}
      <button className="btn btn-primary btn-xl" onClick={create} disabled={busy || total === 0}>
        {busy ? "Creating…" : hasDues ? `Add missing dues for ${session.name}` : `Create dues for ${session.name}`}
      </button>
    </>
  );
}

// --------------------------------------------------------------- dialogs ---

function Dialog({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

function StudentPicker({ students, onPick }) {
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return students
      .filter((s) => `${s.name} ${s.admission_no} ${s.parent_name ?? ""} ${s.parent_phone ?? ""}`.toLowerCase().includes(t))
      .slice(0, 8);
  }, [students, q]);
  return (
    <div className="picker">
      <label className="search">
        <Icon name="search" />
        <input autoFocus placeholder="Student name, admission no. or parent’s phone" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <ul className="picker-list">
        {matches.map((s) => (
          <li key={s.id}>
            <button onClick={() => onPick(s)}>
              <span>
                <strong>{s.name}</strong>
                <span className="row-sub">
                  {s.admission_no} · {gradeLabel(s.class)}
                  {s.section ? ` · ${s.section}` : ""}
                </span>
              </span>
              {s.fee_due > 0 ? <span className="badge badge-warning">{rupees(s.fee_due)} due</span> : <span className="badge badge-success">Nothing due</span>}
            </button>
          </li>
        ))}
        {q && matches.length === 0 && <li className="row-sub picker-empty">No student found.</li>}
      </ul>
    </div>
  );
}
