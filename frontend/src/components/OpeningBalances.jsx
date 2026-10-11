import { useState } from "react";
import { importOpeningBalances } from "../data/api.js";
import { rupees } from "../data/money.js";
import Icon from "./Icon.jsx";

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

export default function OpeningBalances({ school, session, students, onDone, embedded = false }) {
  const [open, setOpen] = useState(embedded);
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

  const body = (
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
  );

  if (embedded) return body;

  return (
    <section className="panel">
      <button className="panel-title panel-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <h2>Opening balances from your previous fee system</h2>
        <Icon name="chevronDown" className={open ? "is-open" : ""} />
      </button>
      {open && body}
    </section>
  );
}
