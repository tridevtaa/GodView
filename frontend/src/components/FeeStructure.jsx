import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addFeeHead,
  addGrade,
  deleteGrade,
  generateInvoices,
  listFeeHeads,
  listPlans,
  listSchedule,
  removeFeeFromStructure,
  renameFeeHead,
  setGradeFee,
  updateGrade,
} from "../data/api.js";
import { rupees } from "../data/money.js";
import Icon from "./Icon.jsx";

const OLD_PER_YEAR = { monthly: 12, quarterly: 4, half_yearly: 2, annual: 1, one_time: 1 };
const amountText = (n) => (n ? String(Number(n)) : "");

// Owner: one card per fee. Each card lists every grade with its amount; the
// fee's frequency is set once. + adds a fee; Save writes the card.
export default function FeeStructure({ school, session, grades, onGradesChanged, students, onChanged }) {
  const [heads, setHeads] = useState([]);
  const [plans, setPlans] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [drafts, setDrafts] = useState([]); // new, unsaved fee cards
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

  const plansById = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans]);
  const counts = useMemo(() => {
    const m = new Map();
    students.forEach((s) => m.set(s.class, (m.get(s.class) ?? 0) + 1));
    return m;
  }, [students]);
  // Fees in this session's structure, in the order they were added.
  const fees = heads.filter((h) => schedule.some((l) => l.head_id === h.id));

  if (!session) return <p className="notice">Import your students first; fees are set per session.</p>;

  const perYear = (line) =>
    !line ? 0 : Number(line.amount) * (line.plan_id ? plansById.get(line.plan_id)?.months.length ?? 0 : OLD_PER_YEAR[line.frequency] ?? 0);
  const total = grades.reduce((sum, g) => {
    const t = fees.reduce((acc, h) => {
      const line = schedule.find((l) => l.head_id === h.id && l.class === g.code) ?? schedule.find((l) => l.head_id === h.id && !l.class);
      return acc + perYear(line);
    }, 0);
    return sum + t * (counts.get(g.code) ?? 0);
  }, 0);

  // Writes one card: fee name, frequency, grade names and amounts.
  async function saveFee(head, { name, planId, rows }) {
    setError("");
    setNotice("");
    let gradesChanged = false;
    try {
      const fee = head ?? (await addFeeHead(school.id, name));
      if (head && name.trim() !== head.name) await renameFeeHead(head.id, name);

      let sort = Math.max(0, ...grades.map((g) => g.sort));
      for (const row of rows) {
        const label = row.label.trim();
        if (row.grade) {
          if (label && label !== row.grade.label) {
            await updateGrade(row.grade.id, { label });
            gradesChanged = true;
          }
          row.code = row.grade.code;
        } else if (label) {
          const found = grades.find((g) => g.label.toLowerCase() === label.toLowerCase() || g.code.toLowerCase() === label.toLowerCase());
          row.code = found ? found.code : (await addGrade(school.id, label, ++sort)).code;
          gradesChanged ||= !found;
        }
      }

      for (const row of rows) {
        if (!row.code) continue;
        const own = schedule.find((l) => l.head_id === fee.id && l.class === row.code);
        const amount = Number(row.amount) || 0;
        if (own && Number(own.amount) === amount && own.plan_id === planId) continue;
        if (!own && !amount) continue;
        await setGradeFee(school.id, session.id, own, { grade: row.code, headId: fee.id, amount, planId });
      }
      // Older "all grades" lines are now written out per grade.
      const shared = schedule.find((l) => l.head_id === fee.id && !l.class);
      if (shared) await setGradeFee(school.id, session.id, shared, { amount: 0 });

      await load();
      if (gradesChanged) onGradesChanged();
      setNotice(`${name.trim()} saved.`);
      return true;
    } catch (err) {
      setError(err?.code === "23505" ? "A fee with that name already exists." : "Couldn’t save that fee. Try again.");
      return false;
    }
  }

  async function removeFee(head) {
    try {
      await removeFeeFromStructure(session.id, head.id);
      await load();
    } catch {
      setError("Couldn’t remove that fee.");
    }
  }

  async function removeGrade(grade) {
    try {
      await deleteGrade(grade.id);
      onGradesChanged();
    } catch {
      setError("Couldn’t remove that grade.");
    }
  }

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

  const cardProps = { grades, plans, counts, onRemoveGrade: removeGrade };

  return (
    <>
      {error && <p className="notice notice-error">{error}</p>}
      {notice && <p className="notice notice-success">{notice}</p>}

      <button className="fc-add" onClick={() => setDrafts((d) => [Date.now(), ...d])} aria-label="Add a fee">
        <Icon name="plus" size={40} />
      </button>

      {drafts.map((id) => (
        <FeeCard
          key={id}
          {...cardProps}
          lines={[]}
          onCancel={() => setDrafts((d) => d.filter((x) => x !== id))}
          onSave={async (v) => (await saveFee(null, v)) && setDrafts((d) => d.filter((x) => x !== id))}
        />
      ))}

      {fees.map((h) => (
        <FeeCard
          key={h.id}
          {...cardProps}
          head={h}
          lines={schedule.filter((l) => l.head_id === h.id)}
          onSave={(v) => saveFee(h, v)}
          onRemove={() => removeFee(h)}
        />
      ))}

      {fees.length > 0 && (
        <section className="panel fc-dues">
          <div>
            <strong>Whole school: {rupees(total)} a year</strong>
            <p className="row-sub">
              Creating dues adds each instalment with its due date for every student. Running it again only adds
              what’s missing.
            </p>
          </div>
          <button className="btn btn-primary" onClick={createDues} disabled={busy}>
            {busy ? "Creating…" : `Create dues for ${session.name}`}
          </button>
        </section>
      )}
    </>
  );
}

function FeeCard({ head, lines, grades, plans, counts, onSave, onCancel, onRemove, onRemoveGrade }) {
  const startPlan = lines.find((l) => l.plan_id)?.plan_id ?? plans.find((p) => p.name === "Monthly")?.id ?? plans[0]?.id ?? "";
  const startRows = useCallback(
    () =>
      grades.map((g) => {
        const line = lines.find((l) => l.class === g.code) ?? lines.find((l) => !l.class);
        return { key: g.id, grade: g, label: g.label, amount: amountText(line?.amount) };
      }),
    [grades, lines]
  );
  const [name, setName] = useState(head?.name ?? "");
  const [planId, setPlanId] = useState(startPlan);
  const [rows, setRows] = useState(startRows);
  const [dirty, setDirty] = useState(!head);
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(false);

  // Pick up saved changes (and renamed grades) unless this card has edits.
  useEffect(() => {
    if (!dirty) {
      setRows(startRows());
      setPlanId(startPlan);
      setName(head?.name ?? "");
    }
  }, [startRows, startPlan, head?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!planId && startPlan) setPlanId(startPlan);
  }, [planId, startPlan]);

  const months = plans.find((p) => p.id === planId)?.months.length ?? 0;
  const edit = (fn) => {
    setDirty(true);
    fn();
  };
  const setRow = (key, field, value) => edit(() => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r))));

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    const ok = await onSave({ name, planId, rows: rows.map((r) => ({ ...r })) });
    setSaving(false);
    if (ok) setDirty(false);
  }

  return (
    <form className="panel fc" onSubmit={save}>
      <div className="fc-head">
        <input
          className="fc-name"
          placeholder="Fee name, e.g. Tuition fee"
          value={name}
          onChange={(e) => edit(() => setName(e.target.value))}
          required
          maxLength={60}
          autoFocus={!head}
        />
        <select className="fc-freq" value={planId} onChange={(e) => edit(() => setPlanId(e.target.value))} aria-label="Frequency">
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="fc-head-end">
          {head &&
            (asking ? (
              <span className="ft-confirm">
                <span>Remove {head.name} for all grades?</span>
                <button type="button" className="link-btn link-danger" onClick={onRemove}>
                  Remove
                </button>
                <button type="button" className="link-btn" onClick={() => setAsking(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <button type="button" className="link-btn link-danger" onClick={() => setAsking(true)}>
                Remove fee
              </button>
            ))}
          {!head && (
            <button type="button" className="link-btn" onClick={onCancel}>
              Cancel
            </button>
          )}
        </span>
      </div>

      <div className="fc-grid fc-cols">
        <span>Grade</span>
        <span>INR</span>
        <span className="fc-total">Total/y</span>
      </div>
      {rows.map((r) => {
        const students = r.grade ? counts.get(r.grade.code) ?? 0 : null;
        return (
          <div key={r.key} className="fc-grid fc-row">
            <span className="fc-grade">
              <input className="fc-input" placeholder="Grade name" value={r.label} onChange={(e) => setRow(r.key, "label", e.target.value)} maxLength={40} />
              {r.grade && students === 0 ? (
                <button
                  type="button"
                  className="ft-x"
                  title={`Remove ${r.grade.label} from the school`}
                  aria-label={`Remove ${r.grade.label} from the school`}
                  onClick={() => onRemoveGrade(r.grade)}
                >
                  <Icon name="x" size={12} />
                </button>
              ) : (
                <span className="ft-x-space" />
              )}
            </span>
            <input
              className="fc-input fc-amount"
              type="number"
              min="0"
              inputMode="numeric"
              placeholder="Amount"
              value={r.amount}
              onChange={(e) => setRow(r.key, "amount", e.target.value)}
            />
            <span className="fc-total">{Number(r.amount) > 0 ? rupees(Number(r.amount) * months) : ""}</span>
          </div>
        );
      })}

      <div className="fc-foot">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => edit(() => setRows((rs) => [...rs, { key: `new-${Date.now()}`, grade: null, label: "", amount: "" }]))}
        >
          Add More
        </button>
        <span className="fc-foot-end">
          {head && !dirty && <span className="row-sub">Saved</span>}
          <button className="btn btn-primary" disabled={saving || !dirty || !name.trim() || !planId}>
            {saving ? "Saving…" : "Save"}
          </button>
        </span>
      </div>
    </form>
  );
}
