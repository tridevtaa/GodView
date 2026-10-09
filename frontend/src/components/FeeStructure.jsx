import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addFeeHead,
  addGrade,
  addPlan,
  deleteFeeHead,
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

  const total = grades.reduce((sum, g) => {
    const perYear = heads.reduce((t, h) => {
      const line = schedule.find((l) => l.head_id === h.id && l.class === g.code) ?? schedule.find((l) => l.head_id === h.id && !l.class);
      return t + (line ? Number(line.amount) * instalments(line, plansById) : 0);
    }, 0);
    return sum + perYear * (counts.get(g.code) ?? 0);
  }, 0);

  return (
    <>
      {error && <p className="notice notice-error">{error}</p>}
      {notice && <p className="notice notice-success">{notice}</p>}

      <section className="panel fs-panel">
        <h2 className="panel-title">Instalment types</h2>
        <p className="row-sub fs-help">When each fee falls due. Pick one for every fee below.</p>
        <div className="fs-plans">
          {plans.map((p) => (
            <span key={p.id} className="fs-plan">
              <strong>{p.name}</strong>
              <span className="row-sub">
                {p.months.length} × · {monthsText(p.months)} · due on {p.due_day}
              </span>
              {p.is_standard ? (
                <span className="badge badge-neutral">Standard</span>
              ) : (
                <button className="btn-icon" aria-label={`Remove ${p.name}`} onClick={act(() => deletePlan(p.id))}>
                  <Icon name="x" size={14} />
                </button>
              )}
            </span>
          ))}
          <NewPlan onSave={act((plan) => addPlan(school.id, plan))} />
        </div>
      </section>

      <section className="panel fs-panel">
        <h2 className="panel-title">Fee heads</h2>
        <div className="fs-heads">
          {heads.map((h) => (
            <span key={h.id} className="chip">
              {h.name}
              {!schedule.some((l) => l.head_id === h.id) && (
                <button aria-label={`Remove ${h.name}`} onClick={act(() => deleteFeeHead(h.id))}>
                  <Icon name="x" size={12} />
                </button>
              )}
            </span>
          ))}
          <InlineAdd placeholder="New fee head, e.g. Tuition fee" onAdd={act((name) => addFeeHead(school.id, name))} />
        </div>
      </section>

      <section className="panel fs-panel">
        <div className="panel-title panel-title-row">
          <h2>Fees by grade · {session.name}</h2>
          <span className="row-sub">Changes save as you go</span>
        </div>
        {heads.length === 0 ? (
          <p className="row-sub panel-empty">Add a fee head above to start.</p>
        ) : (
          <div className="fs-scroll">
            <table className="fs-table">
              <thead>
                <tr>
                  <th className="fs-grade-col">Grade and sections</th>
                  <th className="num">Students</th>
                  {heads.map((h) => (
                    <th key={h.id}>{h.name}</th>
                  ))}
                  <th className="num">Per student, per year</th>
                </tr>
              </thead>
              <tbody>
                {grades.map((g) => {
                  let perYear = 0;
                  return (
                    <tr key={g.id}>
                      <td className="fs-grade-col">
                        <GradeCell grade={g} onSave={async (fields) => (await act(() => updateGrade(g.id, fields))()) && onGradesChanged()} />
                      </td>
                      <td className="num">{counts.get(g.code) ?? 0}</td>
                      {heads.map((h) => {
                        const own = schedule.find((l) => l.head_id === h.id && l.class === g.code);
                        const all = schedule.find((l) => l.head_id === h.id && !l.class);
                        const line = own ?? all;
                        perYear += line ? Number(line.amount) * instalments(line, plansById) : 0;
                        return (
                          <td key={h.id}>
                            <FeeCell
                              line={own}
                              inherited={own ? null : all}
                              plans={plans}
                              plansById={plansById}
                              defaultPlanId={defaultPlan?.id}
                              onSave={act((v) => setGradeFee(school.id, session.id, own, { grade: g.code, headId: h.id, ...v }))}
                            />
                          </td>
                        );
                      })}
                      <td className="num">
                        <strong>{rupees(perYear)}</strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="fs-foot">
          <InlineAdd
            placeholder="Add a grade, e.g. Pre-Nursery"
            onAdd={async (name) => (await act(() => addGrade(school.id, name, (grades.at(-1)?.sort ?? 0) + 1))()) && onGradesChanged()}
          />
          <div className="fs-create">
            <span className="row-sub">Whole school: {rupees(total)} a year</span>
            <button className="btn btn-primary" onClick={createDues} disabled={busy || schedule.length === 0}>
              {busy ? "Creating…" : `Create dues for ${session.name}`}
            </button>
          </div>
        </div>
        <p className="row-sub fs-note">
          Creating dues adds every instalment with its due date for each student. Running it again only adds what’s
          missing, so after changing an amount, dues already created keep their old amount.
        </p>
      </section>
    </>
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
    ? `${Number(inherited.amount)} (all)`
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
      {line && Number(line.amount) > 0 && (
        <span className="fs-cell-year">
          {rupees(Number(line.amount) * instalments(line, plansById))}/yr
        </span>
      )}
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
