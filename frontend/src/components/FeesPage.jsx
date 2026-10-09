import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addFeeHead,
  addScheduleLine,
  deleteFeeHead,
  deleteScheduleLine,
  feeSessionSummary,
  generateInvoices,
  importOpeningBalances,
  listFeeHeads,
  listSchedule,
} from "../data/api.js";
import { rupees } from "../data/money.js";
import { gradeLabel } from "./PersonCard.jsx";
import { gradeOptions } from "./GradeFilter.jsx";
import Icon from "./Icon.jsx";

const FREQUENCIES = {
  monthly: "Monthly (12)",
  quarterly: "Quarterly (4)",
  half_yearly: "Half-yearly (2)",
  annual: "Once a year",
  one_time: "One-time",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PER_YEAR = { monthly: 12, quarterly: 4, half_yearly: 2, annual: 1, one_time: 1 };

// Owners/admins: fee structure, dues, collection and opening balances.
export default function FeesPage({ school, session, students, onOpenStudent, onChanged }) {
  const [summary, setSummary] = useState(null);
  const [heads, setHeads] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const [s, h, sch] = await Promise.all([feeSessionSummary(session.id), listFeeHeads(school.id), listSchedule(session.id)]);
      setSummary(s);
      setHeads(h);
      setSchedule(sch);
      setError("");
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
    } catch (err) {
      setError(
        err?.code === "PGRST205"
          ? "Fees aren’t set up in the database yet. The latest database update needs to be applied first."
          : err?.code === "23505"
            ? "That already exists."
            : "That didn’t go through. Check the values and try again."
      );
    }
  };

  async function generate() {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const n = await generateInvoices(session.id);
      setNotice(n ? `Created ${n.toLocaleString("en-IN")} dues for ${session.name}.` : "All dues already exist; nothing new to create.");
      await load();
      onChanged();
    } catch {
      setError("Couldn’t generate dues.");
    } finally {
      setBusy(false);
    }
  }

  const grades = useMemo(() => gradeOptions(students), [students]);
  const headName = new Map(heads.map((h) => [h.id, h.name]));
  const withDues = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students
      .filter((s) => s.fee_due > 0)
      .filter((s) => !q || `${s.name} ${s.admission_no} ${s.class}`.toLowerCase().includes(q))
      .sort((a, b) => b.fee_due - a.fee_due);
  }, [students, query]);

  if (!session) return <p className="notice">Create a session first (import students) to set up fees.</p>;

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
      </div>

      {error && <p className="notice notice-error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      <section className="fee-cards">
        <Stat label="Billed this session" value={summary?.billed} />
        <Stat label="Collected" value={summary?.collected} tone="paid" />
        <Stat label="Due by today" value={summary?.due_now} tone="due" note={summary ? `${summary.students_due} students` : ""} />
        <Stat label="Outstanding (whole session)" value={summary?.outstanding} />
      </section>

      <section className="panel">
        <h2 className="panel-title">Fee structure for {session.name}</h2>
        <div className="fee-heads">
          <span className="row-sub">Fee heads:</span>
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
          <AddHead onAdd={act((name) => addFeeHead(school.id, name))} />
        </div>

        {schedule.length > 0 && (
          <table className="schedule-table">
            <thead>
              <tr>
                <th>Class</th>
                <th>Fee head</th>
                <th className="num">Amount</th>
                <th>How often</th>
                <th>Starts</th>
                <th className="num">Per year</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {schedule.map((l) => (
                <tr key={l.id}>
                  <td>{l.class ? gradeLabel(l.class) : "All classes"}</td>
                  <td>{headName.get(l.head_id)}</td>
                  <td className="num">{rupees(l.amount)}</td>
                  <td>{FREQUENCIES[l.frequency]}</td>
                  <td>
                    {MONTHS[l.start_month - 1]}, due on {l.due_day}
                  </td>
                  <td className="num">{rupees(l.amount * PER_YEAR[l.frequency])}</td>
                  <td className="num">
                    <button className="link-btn link-danger" onClick={act(() => deleteScheduleLine(l.id))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {heads.length > 0 ? (
          <AddLine grades={grades} heads={heads} onAdd={act((line) => addScheduleLine(school.id, session.id, line))} />
        ) : (
          <p className="row-sub fee-hint">Add fee heads first (e.g. Tuition fee, Transport, Annual charges).</p>
        )}

        <div className="fee-generate">
          <p className="row-sub">
            Creates each enrolled student’s dues for the whole session from this structure. Safe to run again: existing
            dues are kept, so add new lines and run it once more.
          </p>
          <button className="btn btn-primary btn-sm" onClick={generate} disabled={busy || schedule.length === 0}>
            {busy ? "Generating…" : `Generate dues for ${session.name}`}
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-title panel-title-row">
          <h2>Students with dues</h2>
          <input className="input" placeholder="Search name or admission no." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {withDues.length === 0 ? (
          <p className="row-sub panel-empty">Nobody owes anything right now.</p>
        ) : (
          <ul className="dues-list">
            {withDues.slice(0, 200).map((s) => (
              <li key={s.id}>
                <button onClick={() => onOpenStudent(s.id, "fees")}>
                  <span>
                    <strong>{s.name}</strong>
                    <span className="row-sub">
                      {s.admission_no} · {gradeLabel(s.class)}
                      {s.section ? ` · ${s.section}` : ""}
                    </span>
                  </span>
                  <span className={`badge ${s.fee_status === "overdue" ? "badge-danger" : "badge-warning"}`}>
                    {rupees(s.fee_due)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <OpeningBalances
        school={school}
        session={session}
        students={students}
        onDone={async () => {
          await load();
          onChanged();
        }}
      />
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

function AddHead({ onAdd }) {
  const [name, setName] = useState("");
  return (
    <form
      className="add-head"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onAdd(name.trim());
        setName("");
      }}
    >
      <input className="input" placeholder="New fee head" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      <button className="btn btn-secondary btn-sm" disabled={!name.trim()}>
        Add
      </button>
    </form>
  );
}

function AddLine({ grades, heads, onAdd }) {
  const blank = { class: "", head_id: heads[0]?.id ?? "", amount: "", frequency: "monthly", start_month: 4, due_day: 10 };
  const [line, setLine] = useState(blank);
  const set = (k) => (e) => setLine({ ...line, [k]: e.target.value });
  return (
    <form
      className="add-line"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(line);
        setLine({ ...blank, head_id: line.head_id });
      }}
    >
      <select className="select" value={line.class} onChange={set("class")}>
        <option value="">All classes</option>
        {grades.map((g) => (
          <option key={g.value} value={g.value}>
            {gradeLabel(g.value)}
          </option>
        ))}
      </select>
      <select className="select" value={line.head_id} onChange={set("head_id")} required>
        {heads.map((h) => (
          <option key={h.id} value={h.id}>
            {h.name}
          </option>
        ))}
      </select>
      <input className="input input-num" type="number" min="1" step="0.01" placeholder="₹ Amount" value={line.amount} onChange={set("amount")} required />
      <select className="select" value={line.frequency} onChange={set("frequency")}>
        {Object.entries(FREQUENCIES).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <select className="select" value={line.start_month} onChange={set("start_month")} title="First month due">
        {MONTHS.map((m, i) => (
          <option key={m} value={i + 1}>
            From {m}
          </option>
        ))}
      </select>
      <input className="input input-num" type="number" min="1" max="28" value={line.due_day} onChange={set("due_day")} title="Day of month due" />
      <button className="btn btn-primary btn-sm" disabled={!(Number(line.amount) > 0)}>
        <Icon name="plus" />
        Add line
      </button>
    </form>
  );
}

// Reads the "Due Fee List" export from the previous fee system: a few title
// rows, then a header row starting with "S.No"; columns between "Due Fees"
// and "Vehicle Route" are fee heads.
async function readDueList(file) {
  const XLSX = await import("xlsx");
  const book = XLSX.read(await file.arrayBuffer());
  const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, defval: "" });
  const h = rows.findIndex((r) => String(r[0]).trim().toLowerCase() === "s.no");
  if (h < 0) throw new Error("no-header");
  const header = rows[h].map((c) => String(c).trim());
  const adm = header.findIndex((c) => /^adm/i.test(c));
  const due = header.findIndex((c) => /^due fees$/i.test(c));
  const end = header.findIndex((c, i) => i > due && /route|pick ?up/i.test(c));
  if (adm < 0 || due < 0) throw new Error("no-header");
  const headCols = header
    .map((c, i) => [c, i])
    .filter(([, i]) => i > due && (end < 0 || i < end))
    .map(([c, i]) => [c.toLowerCase().replace(/\b\w/g, (x) => x.toUpperCase()), i]);
  return rows
    .slice(h + 1)
    .filter((r) => typeof r[0] === "number" || /^\d+$/.test(String(r[0])))
    .map((r) => ({
      admission_no: String(r[adm]).trim(),
      total: Number(r[due]) || 0,
      heads: headCols.map(([name, i]) => [name, Number(r[i]) || 0]).filter(([, v]) => v > 0),
    }));
}

function OpeningBalances({ school, session, students, onDone }) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState(null);
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");

  async function choose(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError("");
    setPlan(null);
    try {
      const rows = await readDueList(f);
      const byAdm = new Map(students.map((s) => [String(s.admission_no).toUpperCase(), s]));
      const records = [];
      const missing = [];
      for (const r of rows) {
        const s = byAdm.get(r.admission_no.toUpperCase());
        if (!s) {
          missing.push(r.admission_no);
          continue;
        }
        const heads = r.heads.length ? r.heads : r.total > 0 ? [["Previous Dues", r.total]] : [];
        heads.forEach(([head, amount]) => records.push({ student_id: s.id, head, amount }));
      }
      setPlan({ file: f.name, records, students: new Set(records.map((r) => r.student_id)).size, missing, total: records.reduce((t, r) => t + r.amount, 0) });
    } catch {
      setError("That doesn’t look like a Due Fee List export (couldn’t find the S.No / Adm. No. / Due Fees columns).");
    }
  }

  async function run() {
    setState("saving");
    setError("");
    try {
      await importOpeningBalances(school.id, session.id, plan.records);
      setState("done");
      onDone();
    } catch {
      setState("idle");
      setError("Import stopped part-way. It’s safe to run the same file again.");
    }
  }

  return (
    <section className="panel">
      <button className="panel-title panel-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <h2>Opening balances from your previous fee system</h2>
        <Icon name="chevronDown" className={open ? "is-open" : ""} />
      </button>
      {open && (
        <div className="opening-body">
          <p className="row-sub">
            Upload the <strong>Due Fee List</strong> export. Each student’s outstanding amount becomes an “Opening
            balance” due under the matching fee head for {session.name}. Re-uploading updates the amounts.
          </p>
          <label className="dropzone">
            <input type="file" accept=".xlsx,.xls,.csv" onChange={choose} disabled={state === "saving"} />
            <Icon name="upload" size={20} />
            <span className="dropzone-title">{plan?.file ?? "Choose the Due Fee List"}</span>
          </label>
          {plan && state !== "done" && (
            <>
              <dl className="summary-list">
                <div>
                  <dt>Students with a balance</dt>
                  <dd>{plan.students}</dd>
                </div>
                <div>
                  <dt>Total opening balance</dt>
                  <dd>{rupees(plan.total)}</dd>
                </div>
                {plan.missing.length > 0 && (
                  <div>
                    <dt>Not found in this session (skipped)</dt>
                    <dd title={plan.missing.join(", ")}>{plan.missing.length}</dd>
                  </div>
                )}
              </dl>
              <button className="btn btn-primary btn-sm" onClick={run} disabled={state === "saving" || !plan.records.length}>
                {state === "saving" ? "Importing…" : "Import opening balances"}
              </button>
            </>
          )}
          {state === "done" && <p className="callout callout-success">Opening balances imported.</p>}
          {error && <p className="field-error">{error}</p>}
        </div>
      )}
    </section>
  );
}
