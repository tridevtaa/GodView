import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addFeeHead,
  addGrade,
  addPlan,
  deleteGrade,
  generateInvoices,
  listFeeHeads,
  listPlans,
  listSchedule,
  removeFeeFromStructure,
  setFeePlan,
  setGradeFee,
  updateGrade,
} from "../data/api.js";
import { rupees } from "../data/money.js";
import Icon from "./Icon.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SESSION_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
const OLD_PER_YEAR = { monthly: 12, quarterly: 4, half_yearly: 2, annual: 1, one_time: 1 };
// Sensible starting instalment type for the template's fees.
const DEFAULT_PLAN = { "tuition fee": "Monthly", transport: "Monthly", "exam fee": "Bi-yearly" };

const instalments = (line, plansById) =>
  !line ? 0 : line.plan_id ? (plansById.get(line.plan_id)?.months.length ?? 0) : (OLD_PER_YEAR[line.frequency] ?? 0);

// Owner: a ready-made table. Grades down the side, fees across the top with
// one instalment type each; type the amounts. Edit or remove what you don't use.
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
          ? "The fee structure isn’t set up in the database yet. Run the latest database update (npx supabase db push) first."
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
        err?.code === "23505" ? "That name is already used." : err?.code === "23503" ? "That’s still in use." : "That didn’t go through. Try again."
      );
      return false;
    }
  };

  const plansById = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans]);
  const planByName = (name) => plans.find((p) => p.name === name);
  const counts = useMemo(() => {
    const m = new Map();
    students.forEach((s) => m.set(s.class, (m.get(s.class) ?? 0) + 1));
    return m;
  }, [students]);

  // A fee's instalment type: whatever its lines use, else the template default.
  const planFor = (head) =>
    schedule.find((l) => l.head_id === head.id && l.plan_id)?.plan_id ??
    planByName(DEFAULT_PLAN[head.name.toLowerCase()] ?? "One time")?.id ??
    plans[0]?.id;
  const cellLine = (head, code) =>
    schedule.find((l) => l.head_id === head.id && l.class === code) ?? schedule.find((l) => l.head_id === head.id && !l.class);

  if (!session) return <p className="notice">Import your students first; fees are set per session.</p>;

  const perYear = (g) => heads.reduce((t, h) => {
    const line = cellLine(h, g.code);
    return t + (line ? Number(line.amount) * instalments(line, plansById) : 0);
  }, 0);
  const total = grades.reduce((t, g) => t + perYear(g) * (counts.get(g.code) ?? 0), 0);

  async function createDues() {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const n = await generateInvoices(session.id);
      setNotice(n ? `Done. ${n.toLocaleString("en-IN")} dues created for ${session.name}.` : "Everything was already up to date.");
      onChanged?.();
    } catch {
      setError("Couldn’t create the dues.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <p className="notice notice-error">{error}</p>}
      {notice && <p className="notice notice-success">{notice}</p>}

      <section className="panel ft">
        <div className="ft-top">
          <div>
            <h2 className="fs-title">Fee structure · {session.name}</h2>
            <p className="row-sub">Type the amount each grade pays. Leave a box empty if a grade doesn’t pay that fee.</p>
          </div>
          <div className="fs-create">
            <span className="row-sub">Whole school: {rupees(total)} a year</span>
            <button className="btn btn-primary" onClick={createDues} disabled={busy || schedule.length === 0}>
              {busy ? "Creating…" : `Create dues for ${session.name}`}
            </button>
          </div>
        </div>

        <div className="ft-scroll">
          <table className="ft-table">
            <thead>
              <tr>
                <th className="ft-grade">Grade</th>
                {heads.map((h) => (
                  <th key={h.id} className="ft-fee">
                    <div className="ft-fee-head">
                      <span>{h.name}</span>
                      <RemoveButton label={`Remove ${h.name}`} confirm={`Remove ${h.name} for all grades?`} onConfirm={act(() => removeFeeFromStructure(session.id, h.id))} />
                    </div>
                    <select
                      className="ft-plan"
                      value={planFor(h) ?? ""}
                      onChange={act((e) => setFeePlan(session.id, h.id, e.target.value))}
                      aria-label={`${h.name} instalments`}
                    >
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.months.length}×)
                        </option>
                      ))}
                    </select>
                  </th>
                ))}
                <th className="ft-add-col">
                  <AddFee onAdd={act((name) => addFeeHead(school.id, name))} />
                </th>
                <th className="num ft-total">Per year</th>
              </tr>
            </thead>
            <tbody>
              {grades.map((g) => (
                <tr key={g.id}>
                  <td className="ft-grade">
                    <GradeName
                      grade={g}
                      students={counts.get(g.code) ?? 0}
                      onRename={async (label) => (await act(() => updateGrade(g.id, { label }))()) && onGradesChanged()}
                      onRemove={async () => (await act(() => deleteGrade(g.id))()) && onGradesChanged()}
                    />
                  </td>
                  {heads.map((h) => {
                    const own = schedule.find((l) => l.head_id === h.id && l.class === g.code);
                    const shared = own ? null : schedule.find((l) => l.head_id === h.id && !l.class);
                    return (
                      <td key={h.id}>
                        <AmountBox
                          own={own}
                          shared={shared}
                          onSave={act((amount) => setGradeFee(school.id, session.id, own, { grade: g.code, headId: h.id, amount, planId: planFor(h) }))}
                        />
                      </td>
                    );
                  })}
                  <td />
                  <td className="num ft-total">
                    <strong>{rupees(perYear(g))}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ft-foot">
          <AddGrade onAdd={async (name) => (await act(() => addGrade(school.id, name, (grades.at(-1)?.sort ?? 0) + 1))()) && onGradesChanged()} />
          <CustomPlan plans={plans} onSave={act((plan) => addPlan(school.id, plan))} />
        </div>
      </section>
    </>
  );
}

function AmountBox({ own, shared, onSave }) {
  const [value, setValue] = useState(own ? String(Number(own.amount)) : "");
  useEffect(() => setValue(own ? String(Number(own.amount)) : ""), [own]);
  const save = () => {
    const before = own ? String(Number(own.amount)) : "";
    const after = String(Number(value) || "");
    if (before !== after) onSave(value);
  };
  return (
    <label className={`ft-amount${own ? " is-set" : ""}`}>
      <span>₹</span>
      <input
        type="number"
        min="0"
        inputMode="numeric"
        placeholder={shared ? String(Number(shared.amount)) : "-"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </label>
  );
}

function GradeName({ grade, students, onRename, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(grade.label);
  return (
    <div className="ft-grade-cell">
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (label.trim() && label.trim() !== grade.label) onRename(label.trim());
            setEditing(false);
          }}
        >
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => setEditing(false)} maxLength={40} autoFocus />
        </form>
      ) : (
        <button className="ft-grade-name" onClick={() => setEditing(true)} title="Rename">
          {grade.label}
          <Icon name="edit" size={12} />
        </button>
      )}
      <span className="row-sub">{students} students</span>
      {students === 0 && (
        <RemoveButton label={`Remove ${grade.label}`} confirm={`Remove ${grade.label}?`} onConfirm={onRemove} />
      )}
    </div>
  );
}

function RemoveButton({ label, confirm, onConfirm }) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <span className="ft-confirm">
        <span>{confirm}</span>
        <button className="link-btn link-danger" onClick={() => { setAsking(false); onConfirm(); }}>
          Remove
        </button>
        <button className="link-btn" onClick={() => setAsking(false)}>
          Keep
        </button>
      </span>
    );
  }
  return (
    <button className="ft-x" aria-label={label} title={label} onClick={() => setAsking(true)}>
      <Icon name="x" size={12} />
    </button>
  );
}

function AddFee({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  if (!open) {
    return (
      <button className="link-btn" onClick={() => setOpen(true)}>
        + Add fee
      </button>
    );
  }
  return (
    <form
      className="ft-inline"
      onSubmit={async (e) => {
        e.preventDefault();
        if (name.trim() && (await onAdd(name.trim()))) {
          setName("");
          setOpen(false);
        }
      }}
    >
      <input className="input" placeholder="Fee name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => !name && setOpen(false)} maxLength={60} autoFocus />
    </form>
  );
}

function AddGrade({ onAdd }) {
  const [name, setName] = useState("");
  return (
    <form
      className="ft-inline"
      onSubmit={async (e) => {
        e.preventDefault();
        if (name.trim() && (await onAdd(name.trim()))) setName("");
      }}
    >
      <input className="input" placeholder="+ Add a grade, e.g. Pre-Nursery" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
    </form>
  );
}

// Optional: an instalment type beyond Monthly, Bi-yearly and One time.
function CustomPlan({ plans, onSave }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [months, setMonths] = useState([4, 7, 10, 1]);
  const custom = plans.filter((p) => !p.is_standard);
  const toggle = (m) => setMonths((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : SESSION_ORDER.filter((x) => [...cur, m].includes(x))));

  if (!open) {
    return (
      <button className="link-btn" onClick={() => setOpen(true)}>
        + Other instalment type{custom.length ? ` (${custom.map((p) => p.name).join(", ")})` : ""}
      </button>
    );
  }
  return (
    <form
      className="fs-new-plan"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onSave({ name, months, due_day: 10 })) {
          setOpen(false);
          setName("");
        }
      }}
    >
      <input className="input" placeholder="Name, e.g. Quarterly" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoFocus />
      <div className="pill-group">
        {SESSION_ORDER.map((m) => (
          <button type="button" key={m} className={`pill${months.includes(m) ? " on" : ""}`} onClick={() => toggle(m)}>
            {MONTHS[m - 1]}
          </button>
        ))}
      </div>
      <div className="fs-new-plan-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button className="btn btn-primary btn-sm" disabled={!name.trim() || months.length === 0}>
          Save · {months.length} instalments
        </button>
      </div>
    </form>
  );
}
