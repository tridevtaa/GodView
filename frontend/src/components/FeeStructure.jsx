import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addFeeHead,
  addGrade,
  addPlan,
  deletePlan,
  generateInvoices,
  listFeeHeads,
  listPlans,
  listSchedule,
  setGradeFee,
  updateGrade,
} from "../data/api.js";
import { rupees } from "../data/money.js";
import Icon from "./Icon.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SESSION_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
const OLD_PER_YEAR = { monthly: 12, quarterly: 4, half_yearly: 2, annual: 1, one_time: 1 };

const monthsText = (months) =>
  months.length === 12 ? "Apr to Mar" : months.map((m) => MONTHS[m - 1]).join(", ");

// How many instalments a fee line has in a year.
function instalments(line, plansById) {
  if (!line) return 0;
  if (line.plan_id) return plansById.get(line.plan_id)?.months.length ?? 0;
  return OLD_PER_YEAR[line.frequency] ?? 0;
}

// Owner: instalment types, fee heads, and each grade's fees in its own row.
export default function FeeStructure({ school, session, grades, onGradesChanged, students, onChanged }) {
  const [heads, setHeads] = useState([]);
  const [plans, setPlans] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const [h, p, s] = await Promise.all([listFeeHeads(school.id), listPlans(school.id), listSchedule(session.id)]);
      setHeads(h);
      setPlans(p);
      setSchedule(s);
      setError("");
    } catch (err) {
      setError(
        err?.code === "PGRST205"
          ? "The fee structure isn’t set up in the database yet. The latest database update needs to be applied first."
          : "Couldn’t load the fee structure."
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
      setError(
        err?.code === "23505"
          ? "That name is already used."
          : err?.code === "23503"
            ? "That’s still in use, so it can’t be removed."
            : "That didn’t go through. Check the values and try again."
      );
      return false;
    }
  };

  const plansById = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans]);
  const counts = useMemo(() => {
    const m = new Map();
    students.forEach((s) => m.set(s.class, (m.get(s.class) ?? 0) + 1));
    return m;
  }, [students]);
  const defaultPlan = plans.find((p) => p.name === "Monthly") ?? plans[0];

  async function createDues() {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const n = await generateInvoices(session.id);
      setNotice(n ? `Done. ${n.toLocaleString("en-IN")} dues created for ${session.name}.` : "Everything was already up to date; no new dues needed.");
      onChanged?.();
    } catch {
      setError("Couldn’t create the dues.");
    } finally {
      setBusy(false);
    }
  }

  if (!session) return <p className="notice">Import your students first; fees are set per session.</p>;

  // The fee lines that apply to a grade: its own line for a fee, else the
  // all-grades line (from older setups).
  const linesFor = (code) =>
    heads
      .map((h) => {
        const own = schedule.find((l) => l.head_id === h.id && l.class === code);
        const all = schedule.find((l) => l.head_id === h.id && !l.class);
        return own || all ? { head: h, own, inherited: own ? null : all } : null;
      })
      .filter(Boolean);
  const yearOf = (l) => (l ? Number(l.amount) * instalments(l, plansById) : 0);
  const total = grades.reduce(
    (sum, g) => sum + linesFor(g.code).reduce((t, x) => t + yearOf(x.own ?? x.inherited), 0) * (counts.get(g.code) ?? 0),
    0
  );

  // Adds a fee to one grade or to every grade, creating the fee name if new.
  async function addFee({ name, amount, planId, everyGrade }, grade) {
    const head = heads.find((h) => h.name.toLowerCase() === name.trim().toLowerCase()) ?? (await addFeeHead(school.id, name.trim()));
    const targets = everyGrade ? grades : [grade];
    for (const g of targets) {
      const own = schedule.find((l) => l.head_id === head.id && l.class === g.code);
      await setGradeFee(school.id, session.id, own, { grade: g.code, headId: head.id, amount, planId });
    }
  }

  return (
    <>
      {error && <p className="notice notice-error">{error}</p>}
      {notice && <p className="notice notice-success">{notice}</p>}

      <section className="panel fs-panel">
        <div className="fs-top">
          <div>
            <h2 className="fs-title">Fee structure · {session.name}</h2>
            <p className="row-sub">Changes save as you go.</p>
          </div>
          <div className="fs-create">
            <span className="row-sub">Whole school: {rupees(total)} a year</span>
            <button className="btn btn-primary" onClick={createDues} disabled={busy || schedule.length === 0}>
              {busy ? "Creating…" : `Create dues for ${session.name}`}
            </button>
          </div>
        </div>

        <div className="fs-plans-bar">
          <span className="fs-plans-label">Instalment types</span>
          <div className="fs-plans">
            {plans.map((p) => (
              <span key={p.id} className="fs-plan" title={`${p.months.length} instalments: ${monthsText(p.months)}, due on day ${p.due_day}`}>
                <strong>{p.name}</strong>
                <span className="row-sub">
                  {p.months.length}× · {monthsText(p.months)}
                </span>
                {!p.is_standard && (
                  <button className="btn-icon" aria-label={`Remove ${p.name}`} onClick={act(() => deletePlan(p.id))}>
                    <Icon name="x" size={12} />
                  </button>
                )}
              </span>
            ))}
            <NewPlan onSave={act((plan) => addPlan(school.id, plan))} />
          </div>
        </div>

        <ul className="fs-list">
          {grades.map((g) => {
            const lines = linesFor(g.code);
            const perYear = lines.reduce((t, x) => t + yearOf(x.own ?? x.inherited), 0);
            return (
              <li key={g.id} className="fs-row">
                <div className="fs-row-grade">
                  <GradeCell grade={g} onSave={async (fields) => (await act(() => updateGrade(g.id, fields))()) && onGradesChanged()} />
                  <span className="row-sub">{counts.get(g.code) ?? 0} students</span>
                </div>
                <div className="fs-row-fees">
                  {lines.map(({ head, own, inherited }) => (
                    <FeeLine
                      key={head.id}
                      name={head.name}
                      line={own}
                      inherited={inherited}
                      plans={plans}
                      plansById={plansById}
                      defaultPlanId={defaultPlan?.id}
                      onSave={act((v) => setGradeFee(school.id, session.id, own, { grade: g.code, headId: head.id, ...v }))}
                      onRemove={own ? act(() => setGradeFee(school.id, session.id, own, { amount: 0 })) : null}
                    />
                  ))}
                  <AddFee heads={heads} plans={plans} defaultPlanId={defaultPlan?.id} onAdd={(v) => act(() => addFee(v, g))()} />
                </div>
                <div className="fs-row-total">
                  <strong>{rupees(perYear)}</strong>
                  <span className="row-sub">per student, per year</span>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="fs-foot">
          <InlineAdd
            placeholder="Add a grade, e.g. Pre-Nursery"
            onAdd={async (name) => (await act(() => addGrade(school.id, name, (grades.at(-1)?.sort ?? 0) + 1))()) && onGradesChanged()}
          />
        </div>
        <p className="row-sub fs-note">
          Creating dues adds every instalment with its due date for each student. Running it again only adds what’s
          missing, so dues already created keep their amount if you change it later.
        </p>
      </section>
    </>
  );
}

// One fee in a grade's row: name, amount, instalment type, yearly amount.
function FeeLine({ name, line, inherited, plans, plansById, defaultPlanId, onSave, onRemove }) {
  const current = line ?? inherited;
  return (
    <div className="fs-line">
      <span className="fs-line-name">
        {name}
        {inherited && <span className="badge badge-neutral">All grades</span>}
      </span>
      <FeeCell line={line} inherited={inherited} plans={plans} plansById={plansById} defaultPlanId={defaultPlanId} onSave={onSave} />
      <span className="fs-line-year">{current ? `${rupees(Number(current.amount) * instalments(current, plansById))}/yr` : ""}</span>
      {onRemove ? (
        <button className="btn-icon" aria-label={`Remove ${name}`} onClick={onRemove}>
          <Icon name="x" size={14} />
        </button>
      ) : (
        <span className="fs-line-spacer" />
      )}
    </div>
  );
}

function AddFee({ heads, plans, defaultPlanId, onAdd }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", amount: "", planId: defaultPlanId ?? "", everyGrade: false });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  if (!open) {
    return (
      <button className="link-btn fs-add-fee" onClick={() => setOpen(true)}>
        + Add fee
      </button>
    );
  }
  return (
    <form
      className="fs-add-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onAdd({ ...form, planId: form.planId || defaultPlanId })) {
          setOpen(false);
          setForm({ name: "", amount: "", planId: defaultPlanId ?? "", everyGrade: false });
        }
      }}
    >
      <input className="input" list="fee-names" placeholder="Fee, e.g. Tuition fee" value={form.name} onChange={set("name")} required maxLength={60} autoFocus />
      <datalist id="fee-names">
        {heads.map((h) => (
          <option key={h.id} value={h.name} />
        ))}
      </datalist>
      <input className="input input-num" type="number" min="1" placeholder="₹ Amount" value={form.amount} onChange={set("amount")} required />
      <select className="select" value={form.planId} onChange={set("planId")}>
        {plans.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <label className="checkbox checkbox-inline">
        <input type="checkbox" checked={form.everyGrade} onChange={set("everyGrade")} />
        <span>Add to every grade</span>
      </label>
      <button className="btn btn-primary btn-sm" disabled={!form.name.trim() || !(Number(form.amount) > 0)}>
        Add
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

function GradeCell({ grade, onSave }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(grade.label);
  const [section, setSection] = useState("");

  return (
    <div className="fs-grade">
      {editing ? (
        <form
          className="fs-rename"
          onSubmit={(e) => {
            e.preventDefault();
            if (label.trim() && label.trim() !== grade.label) onSave({ label: label.trim() });
            setEditing(false);
          }}
        >
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} autoFocus />
          <button className="link-btn">Save</button>
        </form>
      ) : (
        <button className="fs-grade-name" onClick={() => setEditing(true)} title="Rename">
          {grade.label}
          <Icon name="edit" size={12} />
        </button>
      )}
      <div className="fs-sections">
        {grade.sections.map((s) => (
          <span key={s} className="chip chip-sm">
            {s}
            <button aria-label={`Remove section ${s}`} onClick={() => onSave({ sections: grade.sections.filter((x) => x !== s) })}>
              <Icon name="x" size={10} />
            </button>
          </span>
        ))}
        <form
          className="fs-add-section"
          onSubmit={(e) => {
            e.preventDefault();
            const v = section.trim();
            if (v && !grade.sections.includes(v)) onSave({ sections: [...grade.sections, v] });
            setSection("");
          }}
        >
          <input placeholder="+ Section" value={section} onChange={(e) => setSection(e.target.value)} maxLength={30} />
        </form>
      </div>
    </div>
  );
}

function FeeCell({ line, inherited, plans, plansById, defaultPlanId, onSave }) {
  const [amount, setAmount] = useState(line ? String(Number(line.amount)) : "");
  // A grade without its own amount shows the all-classes line's type.
  const initialPlan = line?.plan_id ?? inherited?.plan_id ?? defaultPlanId ?? "";
  const [planId, setPlanId] = useState(initialPlan);

  useEffect(() => {
    setAmount(line ? String(Number(line.amount)) : "");
    setPlanId(initialPlan);
  }, [line, initialPlan]);

  const save = (next = {}) => {
    const a = next.amount ?? amount;
    const p = next.planId ?? planId;
    if (String(Number(line?.amount ?? 0) || "") === String(Number(a) || "") && (line?.plan_id ?? "") === p) return;
    if (!line && !(Number(a) > 0)) return;
    onSave({ amount: a, planId: p });
  };

  const placeholder = inherited
    ? `${Number(inherited.amount)}`
    : "₹";

  return (
    <div className={`fs-cell${line ? " is-set" : ""}`}>
      <input
        type="number"
        min="0"
        step="1"
        inputMode="numeric"
        placeholder={placeholder}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        onBlur={() => save()}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        aria-label="Amount"
      />
      <select
        value={planId}
        onChange={(e) => {
          setPlanId(e.target.value);
          if (Number(amount) > 0) save({ planId: e.target.value });
        }}
        aria-label="Instalment type"
      >
        {plans.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function InlineAdd({ placeholder, onAdd }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="add-head"
      onSubmit={async (e) => {
        e.preventDefault();
        if (value.trim() && (await onAdd(value.trim())) !== false) setValue("");
      }}
    >
      <input className="input" placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)} maxLength={60} />
      <button className="btn btn-secondary btn-sm" disabled={!value.trim()}>
        <Icon name="plus" />
        Add
      </button>
    </form>
  );
}

function NewPlan({ onSave }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [months, setMonths] = useState([4, 7, 10, 1]);
  const [dueDay, setDueDay] = useState(10);

  if (!open) {
    return (
      <button className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
        <Icon name="plus" />
        Create instalment type
      </button>
    );
  }

  const toggle = (m) => setMonths((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : SESSION_ORDER.filter((x) => [...cur, m].includes(x))));

  return (
    <form
      className="fs-new-plan"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onSave({ name, months, due_day: dueDay })) {
          setOpen(false);
          setName("");
        }
      }}
    >
      <input className="input" placeholder="Name, e.g. Quarterly" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoFocus />
      <div className="pill-group">
        {SESSION_ORDER.map((m) => (
          <button type="button" key={m} className={`pill${months.includes(m) ? " on" : ""}`} onClick={() => toggle(m)} aria-pressed={months.includes(m)}>
            {MONTHS[m - 1]}
          </button>
        ))}
      </div>
      <label className="fs-due">
        <span className="row-sub">Due on day</span>
        <input className="input input-num" type="number" min="1" max="28" value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
      </label>
      <div className="fs-new-plan-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button className="btn btn-primary btn-sm" disabled={!name.trim() || months.length === 0}>
          Save · {months.length} instalment{months.length === 1 ? "" : "s"}
        </button>
      </div>
    </form>
  );
}
