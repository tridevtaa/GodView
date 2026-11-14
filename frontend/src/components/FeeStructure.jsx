import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addFeeHead,
  addGrade,
  addPlan,
  deleteGrade,
  generateInvoices,
  listFeeHeads,
  listPlans,
  listRoutes,
  listSchedule,
  removeFeeFromStructure,
  renameFeeHead,
  setGradeFee,
  updateGrade,
} from "../data/api.js";
import { rupees } from "../data/money.js";
import Icon from "./Icon.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SESSION_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
const OLD_PER_YEAR = { monthly: 12, quarterly: 4, half_yearly: 2, annual: 1, one_time: 1 };

// Always offered, even before the school's own list has loaded.
const STANDARD_PLANS = [
  { name: "Monthly", months: SESSION_ORDER, is_standard: true },
  { name: "Bi-annually", months: [4, 10], is_standard: true },
  { name: "One time", months: [4], is_standard: true },
];

// Every new fee starts with these grades (or the school's own list).
const TEMPLATE_GRADES = [
  ["Nursery", "Nursery"],
  ["KG 1", "KG 1"],
  ["KG 2", "KG 2"],
  ...Array.from({ length: 12 }, (_, i) => [String(i + 1), `Grade ${i + 1}`]),
].map(([code, label], sort) => ({ code, label, sort }));

const amountText = (n) => (n ? String(Number(n)) : "");
const sameStreams = (a, b) => (a ?? []).map((x) => x.toLowerCase()).sort().join("|") === (b ?? []).map((x) => x.toLowerCase()).sort().join("|");
const inStreams = (streams, stream) => !streams || streams.some((x) => x.trim().toLowerCase() === (stream ?? "").trim().toLowerCase());
const rank = (l) => (!l.class ? 0 : !l.streams ? 1 : 2);
// The line a student pays for a fee: class and stream, then class, then all.
// A fee by bus stop: the line for the student's stop, if they ride the bus.
const bestLine = (lines, s) =>
  lines.some((l) => l.stop_id)
    ? s.uses_bus
      ? lines.find((l) => l.stop_id && l.stop_id === s.bus_stop_id)
      : undefined
    : lines.filter((l) => (!l.class || l.class === s.class) && inStreams(l.streams, s.stream)).sort((a, b) => rank(b) - rank(a))[0];
// Transport-sounding names start out charged by bus stop.
const TRANSPORT_NAME = /transport|\bbus\b|\bvan\b|conveyance/i;
// Instalments due in an earlier month, e.g. "Jun with May".
const earlyText = (p) =>
  (p.due_months ?? []).map((d, i) => (d !== p.months[i] ? `${MONTHS[p.months[i] - 1]} with ${MONTHS[d - 1]}` : null)).filter(Boolean).join(", ");
const monthsText = (months) =>
  months.length === 12 ? "Apr to Mar" : SESSION_ORDER.filter((m) => months.includes(m)).map((m) => MONTHS[m - 1]).join(", ");
const timesText = (n) => (n === 1 ? "once a year" : `${n} times a year`);

// Owner: one card per fee. Each card lists the grades with their amount and
// one frequency for the fee. + adds a fee; Save writes the card.
export default function FeeStructure({ school, session, grades, onGradesChanged, students, onChanged }) {
  const [heads, setHeads] = useState([]);
  const [savedPlans, setSavedPlans] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [drafts, setDrafts] = useState([]); // new, unsaved fee cards
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const [h, p, s, r] = await Promise.all([
        listFeeHeads(school.id),
        listPlans(school.id),
        listSchedule(session.id),
        listRoutes(school.id).catch(() => []),
      ]);
      setHeads(h);
      setSavedPlans(p);
      setSchedule(s);
      setRoutes(r);
      setError("");
    } catch (err) {
      setError(
        err?.code === "PGRST205"
          ? "Fees can’t be saved yet: the latest database update hasn’t been applied (npx supabase db push)."
          : "Couldn’t load the fee structure."
      );
    }
  }, [school.id, session]);

  useEffect(() => {
    load();
  }, [load]);

  // Frequencies by name: the three standard ones first, then the school's own.
  const plans = useMemo(() => {
    const byName = new Map(savedPlans.map((p) => [p.name, p]));
    const standard = STANDARD_PLANS.map((p) => byName.get(p.name) ?? p);
    return [...standard, ...savedPlans.filter((p) => !STANDARD_PLANS.some((s) => s.name === p.name))];
  }, [savedPlans]);
  const planName = (id) => savedPlans.find((p) => p.id === id)?.name;
  const gradeList = grades.length ? grades : TEMPLATE_GRADES;
  const counts = useMemo(() => {
    const m = new Map();
    students.forEach((s) => m.set(s.class, (m.get(s.class) ?? 0) + 1));
    return m;
  }, [students]);
  const streamsByGrade = useMemo(() => {
    const m = new Map();
    students.forEach((s) => {
      if (!s.stream) return;
      if (!m.has(s.class)) m.set(s.class, new Set());
      m.get(s.class).add(s.stream);
    });
    return new Map([...m].map(([k, v]) => [k, [...v].sort()]));
  }, [students]);
  // Riders per stop and per route; riders with no stop on any route.
  const riders = useMemo(() => {
    const routeOf = new Map(routes.flatMap((r) => r.stops.map((st) => [st.id, r.id])));
    const byStop = new Map();
    const byRoute = new Map();
    let noStop = 0;
    students.forEach((s) => {
      if (!s.uses_bus) return;
      const r = routeOf.get(s.bus_stop_id);
      if (!r) return noStop++;
      byStop.set(s.bus_stop_id, (byStop.get(s.bus_stop_id) ?? 0) + 1);
      byRoute.set(r, (byRoute.get(r) ?? 0) + 1);
    });
    return { byStop, byRoute, noStop };
  }, [students, routes]);
  const fees = heads.filter((h) => schedule.some((l) => l.head_id === h.id));

  if (!session) return <p className="notice">Import your students first; fees are set per session.</p>;

  const perYear = (line) =>
    !line
      ? 0
      : Number(line.amount) *
        (line.plan_id ? savedPlans.find((p) => p.id === line.plan_id)?.months.length ?? 0 : OLD_PER_YEAR[line.frequency] ?? 0);
  const total = students.reduce(
    (sum, s) => sum + fees.reduce((acc, h) => acc + perYear(bestLine(schedule.filter((l) => l.head_id === h.id), s)), 0),
    0
  );

  async function addFrequency(plan) {
    setError("");
    try {
      await addPlan(school.id, plan);
      await load();
      return true;
    } catch (err) {
      setError(err?.code === "23505" ? "A frequency with that name already exists." : "Couldn’t add that frequency. Try again.");
      return false;
    }
  }

  // Writes one card: fee name, frequency, and amounts by grade or by stop.
  async function saveFee(head, { name, plan, rows, byStop, stopRows }) {
    setError("");
    setNotice("");
    let gradesChanged = false;
    try {
      const planId = savedPlans.find((p) => p.name === plan)?.id;
      if (!planId) throw Object.assign(new Error("no plan"), { code: "PGRST205" });
      const fee = head ?? (await addFeeHead(school.id, name));
      if (head && name.trim() !== head.name) await renameFeeHead(head.id, name);

      // A fee is by grade or by stop: switching clears the other kind.
      for (const l of schedule.filter((l) => l.head_id === fee.id && Boolean(l.stop_id) !== byStop)) {
        await setGradeFee(school.id, session.id, l, { amount: 0 });
      }
      if (byStop) {
        for (const row of stopRows) {
          const own = schedule.find((l) => l.head_id === fee.id && l.stop_id === row.stopId);
          const amount = Number(row.amount) || 0;
          if (own && Number(own.amount) === amount && own.plan_id === planId) continue;
          if (!own && !amount) continue;
          await setGradeFee(school.id, session.id, own, { headId: fee.id, amount, planId, stopId: row.stopId });
        }
        await load();
        setNotice(`${name.trim()} saved.`);
        return true;
      }

      let sort = Math.max(0, ...grades.map((g) => g.sort));
      for (const row of rows) {
        const label = row.label.trim();
        if (row.grade?.id) {
          if (label && label !== row.grade.label) {
            await updateGrade(row.grade.id, { label });
            gradesChanged = true;
          }
          row.code = row.grade.code;
        } else if (label && Number(row.amount) > 0) {
          const code = row.grade?.code ?? label;
          const found = grades.find((g) => g.code.toLowerCase() === code.toLowerCase() || g.label.toLowerCase() === label.toLowerCase());
          row.code = found ? found.code : (await addGrade(school.id, label, row.grade?.sort ?? ++sort, code)).code;
          gradesChanged ||= !found;
        }
      }

      for (const row of rows) {
        if (!row.code) continue;
        const own = schedule.find((l) => l.head_id === fee.id && !l.stop_id && l.class === row.code && sameStreams(l.streams, row.streams));
        const amount = Number(row.amount) || 0;
        if (own && Number(own.amount) === amount && own.plan_id === planId) continue;
        if (!own && !amount) continue;
        await setGradeFee(school.id, session.id, own, { grade: row.code, headId: fee.id, amount, planId, streams: row.streams ?? null });
      }
      const shared = schedule.find((l) => l.head_id === fee.id && !l.class && !l.stop_id);
      if (shared) await setGradeFee(school.id, session.id, shared, { amount: 0 });

      await load();
      if (gradesChanged) onGradesChanged();
      setNotice(`${name.trim()} saved.`);
      return true;
    } catch (err) {
      setError(
        err?.code === "23505"
          ? "A fee with that name already exists."
          : err?.code === "PGRST205" || err?.code === "42P01"
            ? "Fees can’t be saved yet: the latest database update hasn’t been applied (npx supabase db push)."
            : "Couldn’t save that fee. Try again."
      );
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

  const cardProps = { grades: gradeList, plans, counts, streamsByGrade, routes, riders, onRemoveGrade: removeGrade, onAddFrequency: addFrequency };

  return (
    <>
      {error && <p className="notice notice-error">{error}</p>}
      {notice && <p className="notice notice-success">{notice}</p>}

      <button className="fc-add" onClick={() => setDrafts((d) => [Date.now(), ...d])}>
        <span className="fc-add-icon">
          <Icon name="plus" size={26} />
        </span>
        <span className="fc-add-text">
          <strong>Add a fee</strong>
          <span>Tuition, exam fee… by grade. Transport by bus stop.</span>
        </span>
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

      {fees.map((h) => {
        const lines = schedule.filter((l) => l.head_id === h.id);
        return (
          <FeeCard
            key={h.id}
            {...cardProps}
            head={h}
            lines={lines}
            savedPlan={planName(lines.find((l) => l.plan_id)?.plan_id)}
            onSave={(v) => saveFee(h, v)}
            onRemove={() => removeFee(h)}
          />
        );
      })}

      {fees.length > 0 && (
        <section className="fc-dues navy-card">
          <div>
            <span className="fc-dues-label">Whole school, per year</span>
            <strong>
              {rupees(total)}
              {students.length > 0 && (
                <span className="fc-dues-avg"> (avg {rupees(Math.round(total / students.length))}/student/y)</span>
              )}
            </strong>
          </div>
          <p className="row-sub">
            When the fees look right, create the dues: every student gets each instalment with its due date. Running it
            again only adds what’s missing.
          </p>
          <button className="btn btn-primary" onClick={createDues} disabled={busy}>
            {busy ? "Creating…" : `Create dues for ${session.name}`}
          </button>
        </section>
      )}
    </>
  );
}

function FeeCard({ head, lines: allLines, savedPlan, grades, plans, counts, streamsByGrade, routes, riders, onSave, onCancel, onRemove, onRemoveGrade, onAddFrequency }) {
  const lines = useMemo(() => allLines.filter((l) => !l.stop_id), [allLines]);
  const savedByStop = allLines.some((l) => l.stop_id);
  const startStopRows = useCallback(
    () =>
      routes.flatMap((r) =>
        r.stops.map((st) => ({ key: st.id, stopId: st.id, route: r, label: st.name, amount: amountText(allLines.find((l) => l.stop_id === st.id)?.amount) }))
      ),
    [routes, allLines]
  );
  const startRows = useCallback(
    () =>
      grades.flatMap((g) => {
        const key = g.id ?? g.code;
        const byStream = lines.filter((l) => l.class === g.code && l.streams);
        const plain = lines.find((l) => l.class === g.code && !l.streams) ?? lines.find((l) => !l.class);
        if (!byStream.length) return [{ key, grade: g, label: g.label, amount: amountText(plain?.amount) }];
        return [
          ...byStream.map((l) => ({ key: `${key}-${l.streams.join("|")}`, grade: g, label: g.label, streams: l.streams, amount: amountText(l.amount) })),
          ...(lines.find((l) => l.class === g.code && !l.streams)
            ? [{ key: `${key}-other`, grade: g, label: g.label, streams: null, other: true, amount: amountText(plain.amount) }]
            : []),
        ];
      }),
    [grades, lines]
  );
  const startPlan = savedPlan ?? "Monthly";
  const [name, setName] = useState(head?.name ?? "");
  const [plan, setPlan] = useState(startPlan);
  const [rows, setRows] = useState(startRows);
  const [byStop, setByStop] = useState(savedByStop);
  const [pickedBy, setPickedBy] = useState(Boolean(head)); // owner chose grade/stop
  const [stopRows, setStopRows] = useState(startStopRows);
  const [dirty, setDirty] = useState(!head);
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(false);
  const [open, setOpen] = useState(!head); // saved fees start minimised

  // Pick up saved changes (and renamed grades) unless this card has edits.
  useEffect(() => {
    if (!dirty) {
      setRows(startRows());
      setStopRows(startStopRows());
      setByStop(savedByStop);
      setPlan(startPlan);
      setName(head?.name ?? "");
    }
  }, [startRows, startStopRows, savedByStop, startPlan, head?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const times = plans.find((p) => p.name === plan)?.months.length ?? 0;
  const edit = (fn) => {
    setDirty(true);
    fn();
  };
  const setRow = (key, field, value) =>
    edit(() => (byStop ? setStopRows : setRows)((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r))));
  const shown = byStop ? stopRows : rows.filter((r) => !r.hidden);
  const hasStops = routes.some((r) => r.stops.length) || savedByStop;
  const chooseBy = (v) => edit(() => (setByStop(v), setPickedBy(true)));
  // Same amount for every stop on a route
  const fillRoute = (routeId, amount) =>
    edit(() => setStopRows((rs) => rs.map((r) => (r.route.id === routeId ? { ...r, amount } : r))));
  const yearTotal = shown.reduce((t, r) => Math.max(t, (Number(r.amount) || 0) * times), 0);
  const filled = shown.filter((r) => Number(r.amount) > 0).length;

  // One row per stream for a grade (the plain row is kept hidden so Save clears it).
  const split = (row) =>
    edit(() =>
      setRows((rs) =>
        rs.flatMap((r) =>
          r.key !== row.key
            ? [r]
            : [
                { ...r, hidden: true, amount: "" },
                ...streamsByGrade.get(row.grade.code).map((st) => ({ key: `${r.key}-${st}`, grade: r.grade, label: r.label, streams: [st], amount: r.amount })),
              ]
        )
      )
    );
  // Back to one amount for the whole grade.
  const merge = (code) =>
    edit(() =>
      setRows((rs) => {
        const group = rs.filter((r) => r.grade?.code === code);
        const amount = group.find((r) => !r.hidden && r.amount)?.amount ?? "";
        const out = [];
        rs.forEach((r) => {
          if (r.grade?.code !== code) return out.push(r);
          if (r.streams || r.other) out.push({ ...r, hidden: true, amount: "" });
          if (!r.streams && !r.other) out.push({ ...r, hidden: false, amount });
        });
        if (!group.some((r) => !r.streams && !r.other)) {
          const g = group[0].grade;
          out.splice(out.indexOf(group.at(-1)) + 1, 0, { key: `${g.id ?? g.code}-merged`, grade: g, label: g.label, amount });
        }
        return out;
      })
    );

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    const ok = await onSave({ name, plan, rows: rows.map((r) => ({ ...r })), byStop, stopRows });
    setSaving(false);
    if (ok) {
      setDirty(false);
      setOpen(false);
    }
  }

  if (!open && head) {
    const amounts = shown.map((r) => Number(r.amount) || 0).filter(Boolean);
    const lo = Math.min(...amounts);
    const hi = Math.max(...amounts);
    return (
      <button type="button" className="fc fc-mini" onClick={() => setOpen(true)} aria-expanded="false">
        <span className="fc-mini-main">
          <strong className="fc-mini-name">{name}</strong>
          <span className="freq-btn fc-mini-freq">
            {plan}
            <span className="freq-times">{times}×</span>
          </span>
        </span>
        <span className="fc-mini-stats">
          <span>
            <span className="fc-mini-label">{byStop ? "Stops" : "Grades"}</span>
            <strong>{new Set(shown.filter((r) => Number(r.amount) > 0).map((r) => r.grade?.code ?? r.key)).size}</strong>
          </span>
          <span>
            <span className="fc-mini-label">Per instalment</span>
            <strong>{amounts.length ? (lo === hi ? rupees(lo) : `${rupees(lo)} to ${rupees(hi)}`) : "-"}</strong>
          </span>
          <span>
            <span className="fc-mini-label">Per year</span>
            <strong>{amounts.length ? (lo === hi ? rupees(lo * times) : `${rupees(lo * times)} to ${rupees(hi * times)}`) : "-"}</strong>
          </span>
        </span>
        <span className="fc-mini-edit">
          <Icon name="edit" size={14} />
          Edit
        </span>
      </button>
    );
  }

  return (
    <form className="fc" onSubmit={save}>
      <header className="fc-head">
        <div className="fc-title">
          <input
            className="fc-name"
            placeholder="Fee name, e.g. Tuition fee"
            value={name}
            onChange={(e) => {
              const v = e.target.value;
              edit(() => setName(v));
              if (!pickedBy && hasStops) setByStop(TRANSPORT_NAME.test(v));
            }}
            required
            maxLength={60}
            autoFocus={!head}
            aria-label="Fee name"
          />
          <FrequencyMenu plans={plans} value={plan} onChange={(v) => edit(() => setPlan(v))} onAdd={onAddFrequency} />
          {hasStops && (
            <div className="segmented segmented-sm" role="radiogroup" aria-label="Charge by">
              <button type="button" role="radio" aria-checked={!byStop} className={byStop ? "" : "active"} onClick={() => chooseBy(false)}>
                By grade
              </button>
              <button type="button" role="radio" aria-checked={byStop} className={byStop ? "active" : ""} onClick={() => chooseBy(true)}>
                By bus stop
              </button>
            </div>
          )}
        </div>
        <div className="fc-head-end">
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
              <span className="fc-head-actions">
                <button type="button" className="link-btn link-danger" onClick={() => setAsking(true)}>
                  Remove fee
                </button>
                {!dirty && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>
                    Minimise
                  </button>
                )}
              </span>
            ))}
          {!head && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </header>

      <div className="fc-table">
        <div className="fc-grid fc-cols">
          <span>{byStop ? "Bus stop" : "Grade"}</span>
          <span>Amount per instalment</span>
          <span className="fc-right">Per year</span>
        </div>
        {byStop &&
          shown.map((r, i) => {
            const amount = Number(r.amount) || 0;
            const n = riders.byStop.get(r.stopId) ?? 0;
            const first = shown[i - 1]?.route.id !== r.route.id;
            const group = shown.filter((x) => x.route.id === r.route.id);
            const same = group.every((x) => x.amount === group[0].amount) ? group[0].amount : "";
            return (
              <div key={r.key}>
                {first && (
                  <div className="fc-grid fc-route">
                    <div className="fc-grade">
                      <span className="fc-grade-text">{r.route.name}</span>
                      <span className="fc-stream">
                        {group.length} stop{group.length === 1 ? "" : "s"} · {riders.byRoute.get(r.route.id) ?? 0} on the bus
                      </span>
                    </div>
                    {group.length > 1 && (
                      <label className="fc-amount fc-amount-all">
                        <span>₹</span>
                        <input
                          type="number"
                          min="0"
                          inputMode="numeric"
                          placeholder="All stops"
                          value={same}
                          onChange={(e) => fillRoute(r.route.id, e.target.value)}
                          aria-label={`Same amount for every stop on ${r.route.name}`}
                        />
                      </label>
                    )}
                  </div>
                )}
              <div className={`fc-grid fc-row fc-stop${amount > 0 ? " is-set" : ""}`}>
                <div className="fc-grade">
                  <span className="fc-stop-name">{r.label}</span>
                  {n > 0 && <span className="fc-count">{n} on the bus</span>}
                </div>
                <label className="fc-amount">
                  <span>₹</span>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    placeholder="0"
                    value={r.amount}
                    onChange={(e) => setRow(r.key, "amount", e.target.value)}
                    aria-label={`${r.label} amount`}
                  />
                </label>
                <span className="fc-right fc-year">{amount > 0 ? rupees(amount * times) : "-"}</span>
              </div>
              </div>
            );
          })}
        {byStop && riders.noStop > 0 && (
          <p className="row-sub fc-note">
            {riders.noStop} on the bus {riders.noStop === 1 ? "has" : "have"} no stop yet, so no transport fee. Set it in Transport.
          </p>
        )}
        {!byStop && shown.map((r, i) => {
          const students = r.grade?.id ? counts.get(r.grade.code) ?? 0 : null;
          const amount = Number(r.amount) || 0;
          const byStream = Boolean(r.streams || r.other);
          const firstOfGroup = byStream && shown[i - 1]?.grade?.code !== r.grade.code;
          const canSplit = !byStream && r.grade && (streamsByGrade.get(r.grade.code)?.length ?? 0) > 1;
          return (
            <div key={r.key} className={`fc-grid fc-row${amount > 0 ? " is-set" : ""}${byStream && !firstOfGroup ? " is-sub" : ""}`}>
              <div className="fc-grade">
                {byStream ? (
                  <>
                    <span className={`fc-grade-text${firstOfGroup ? "" : " is-quiet"}`}>{r.label}</span>
                    <span className="fc-stream">{r.other ? "Other streams" : r.streams.join(" / ")}</span>
                    {firstOfGroup && (
                      <button type="button" className="link-btn fc-split" onClick={() => merge(r.grade.code)}>
                        One amount
                      </button>
                    )}
                  </>
                ) : (
                  <input className="fc-grade-input" placeholder="Grade name" value={r.label} onChange={(e) => setRow(r.key, "label", e.target.value)} maxLength={40} aria-label="Grade name" />
                )}
                {!byStream && students !== null && <span className="fc-count">{students} student{students === 1 ? "" : "s"}</span>}
                {canSplit && (
                  <button type="button" className="link-btn fc-split" onClick={() => split(r)}>
                    Split by stream
                  </button>
                )}
                {!byStream && r.grade?.id && students === 0 && (
                  <button type="button" className="ft-x" title={`Remove ${r.grade.label} from the school`} aria-label={`Remove ${r.grade.label} from the school`} onClick={() => onRemoveGrade(r.grade)}>
                    <Icon name="x" size={12} />
                  </button>
                )}
              </div>
              <label className="fc-amount">
                <span>₹</span>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  placeholder="0"
                  value={r.amount}
                  onChange={(e) => setRow(r.key, "amount", e.target.value)}
                  aria-label={`${r.label || "Grade"} amount`}
                />
              </label>
              <span className="fc-right fc-year">{amount > 0 ? rupees(amount * times) : "-"}</span>
            </div>
          );
        })}
      </div>

      <footer className="fc-foot">
        {byStop ? (
          <span />
        ) : (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => edit(() => setRows((rs) => [...rs, { key: `new-${Date.now()}`, grade: null, label: "", amount: "" }]))}
          >
            <Icon name="plus" />
            Add grade
          </button>
        )}
        <span className="fc-foot-end">
          <span className="row-sub">
            {dirty ? `${filled} of ${shown.length} rows filled` : "Saved"}
            {yearTotal > 0 && ` · up to ${rupees(yearTotal)} a year`}
          </span>
          <button className="btn btn-primary" disabled={saving || !dirty || !name.trim()}>
            {saving ? "Saving…" : "Save"}
          </button>
        </span>
      </footer>
    </form>
  );
}

// Frequency picker: the three standard ones, the school's own, and
// "Add frequency type" to make a new one by ticking months.
function FrequencyMenu({ plans, value, onChange, onAdd }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [months, setMonths] = useState([4, 7, 10, 1]);
  const ref = useRef(null);
  const current = plans.find((p) => p.name === value);

  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && (setOpen(false), setAdding(false));
    const esc = (e) => e.key === "Escape" && (setOpen(false), setAdding(false));
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const toggle = (m) => setMonths((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : SESSION_ORDER.filter((x) => [...cur, m].includes(x))));

  return (
    <div className="freq" ref={ref}>
      <button type="button" className="freq-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span>{value}</span>
        {current && <span className="freq-times">{current.months.length}×</span>}
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="freq-menu" role="listbox">
          {plans.map((p) => (
            <button
              type="button"
              role="option"
              aria-selected={p.name === value}
              key={p.name}
              className={`freq-opt${p.name === value ? " is-on" : ""}`}
              onClick={() => {
                onChange(p.name);
                setOpen(false);
              }}
            >
              <span>
                <strong>{p.name}</strong>
                <span className="row-sub">
                  {timesText(p.months.length)} · {monthsText(p.months)}
                  {earlyText(p) && ` · ${earlyText(p)}`}
                </span>
              </span>
              {p.name === value && <Icon name="check" size={16} />}
            </button>
          ))}
          {adding ? (
            <div className="freq-new">
              <input className="input" placeholder="Name, e.g. Quarterly" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />
              <span className="row-sub">Due in these months:</span>
              <div className="pill-group">
                {SESSION_ORDER.map((m) => (
                  <button type="button" key={m} className={`pill pill-sm${months.includes(m) ? " on" : ""}`} onClick={() => toggle(m)}>
                    {MONTHS[m - 1]}
                  </button>
                ))}
              </div>
              <div className="freq-new-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!name.trim() || months.length === 0}
                  onClick={async () => {
                    if (await onAdd({ name: name.trim(), months, due_day: 10 })) {
                      onChange(name.trim());
                      setName("");
                      setAdding(false);
                      setOpen(false);
                    }
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="freq-opt freq-add" onClick={() => setAdding(true)}>
              <Icon name="plus" size={16} />
              Add frequency type
            </button>
          )}
        </div>
      )}
    </div>
  );
}
