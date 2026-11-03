import { useEffect, useMemo, useState } from "react";
import { sessionFeeLines } from "../data/api.js";
import { downloadCsv } from "../data/exportCsv.js";
import { rupees } from "../data/money.js";
import { gradeRank } from "./GradeFilter.jsx";
import { gradeLabel } from "./PersonCard.jsx";
import StatCards from "./StatCards.jsx";
import Icon from "./Icon.jsx";

// Fees > Reports > Class-wise: this session's fees for each grade, and its
// sections on a tap. Fees less concessions is what's collected plus what's
// still due, now or later. Students no longer in a class keep a row of their
// own, so the totals match the Overview.
const NO_CLASS = "No class";
const blank = () => ({ students: new Set(), fees: 0, concession: 0, collected: 0, dueNow: 0, dueLater: 0 });
function add(t, line, today) {
  const balance = Number(line.balance);
  t.students.add(line.student_id);
  t.fees += Number(line.amount);
  t.concession += Number(line.concession);
  t.collected += Number(line.paid);
  if (!line.due_date || line.due_date <= today) t.dueNow += balance;
  else t.dueLater += balance;
}
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function FeeClassReport({ school, session, students, header, tabs }) {
  const [lines, setLines] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stale = false;
    setLines(null);
    setError("");
    sessionFeeLines(session.id).then(
      (r) => !stale && setLines(r),
      () => !stale && (setLines([]), setError("Couldn’t load the report. Try again."))
    );
    return () => {
      stale = true;
    };
  }, [session.id]);

  const { grades, total } = useMemo(() => {
    const day = today();
    const byId = new Map(students.map((s) => [s.id, s]));
    const map = new Map();
    const sum = blank();
    for (const line of lines ?? []) {
      const s = byId.get(line.student_id);
      const klass = s?.class || NO_CLASS;
      if (!map.has(klass)) map.set(klass, { klass, ...blank(), sections: new Map() });
      const g = map.get(klass);
      const sec = s?.section || "";
      if (!g.sections.has(sec)) g.sections.set(sec, { section: sec, ...blank() });
      add(g, line, day);
      add(g.sections.get(sec), line, day);
      add(sum, line, day);
    }
    const order = [...map.values()].sort((a, b) => (a.klass === NO_CLASS) - (b.klass === NO_CLASS) || gradeRank(a.klass) - gradeRank(b.klass) || a.klass.localeCompare(b.klass));
    return { grades: order, total: sum };
  }, [lines, students]);

  const [open, setOpen] = useState(() => new Set());
  const flip = (k) =>
    setOpen((o) => {
      const next = new Set(o);
      if (!next.delete(k)) next.add(k);
      return next;
    });
  const name = (g) => (g.klass === NO_CLASS ? NO_CLASS : gradeLabel(g.klass));
  const cells = (t) => [t.students.size, t.fees, t.concession, t.collected, t.dueNow, t.dueLater];

  function download() {
    const rows = [];
    for (const g of grades) {
      rows.push([name(g), "", ...cells(g)]);
      const parts = [...g.sections.values()];
      if (parts.length > 1 || parts[0]?.section) parts.forEach((s) => rows.push([name(g), s.section || "No section", ...cells(s)]));
    }
    rows.push(["Total", "", ...cells(total)]);
    downloadCsv(["Class", "Section", "Students", "Fees", "Concession", "Collected", "Due now", "Due later"], rows, `${school.slug}-fees-by-class-${session.name}.csv`);
  }

  const row = (label, t, extra = {}) => (
    <>
      <span className="cf-name">{label}</span>
      <span className="cf-num" data-label="Students">
        {t.students.size.toLocaleString("en-IN")}
      </span>
      <span className="cf-num" data-label="Fees">
        {rupees(t.fees)}
      </span>
      <span className="cf-num" data-label="Concession">
        {rupees(t.concession)}
      </span>
      <span className="cf-num" data-label="Collected">
        {rupees(t.collected)}
      </span>
      <span className="cf-num cf-due" data-label="Due now">
        {rupees(t.dueNow)}
      </span>
      <span className="cf-num" data-label="Due later">
        {rupees(t.dueLater)}
      </span>
      <span className="cf-more">{extra.chevron}</span>
    </>
  );

  return (
    <>
      <StatCards
        items={[
          {
            tone: "due",
            label: `Due now: ${session.name}`,
            value: lines === null ? undefined : rupees(total.dueNow),
            note: lines !== null && (
              <span className="sw-facts">
                <span>{rupees(total.collected)} collected</span>
                <span>{rupees(total.concession)} concessions</span>
                <span>{rupees(total.dueLater)} due later</span>
              </span>
            ),
          },
        ]}
      />
      {header}
      <div className="report-filters">{tabs}</div>

      {error && <p className="notice notice-error">{error}</p>}
      {lines === null ? (
        <div className="card card-skeleton att-skeleton" aria-busy="true" />
      ) : !grades.length ? (
        <p className="notice">No fees set up for this session yet.</p>
      ) : (
        <section className="panel report-panel">
          <div className="panel-title panel-title-row">
            <h2>By class</h2>
            <button type="button" className="btn btn-secondary btn-sm" onClick={download}>
              <Icon name="download" /> Download
            </button>
          </div>
          <div className="cf-table">
            <div className="cf-row cf-head" aria-hidden="true">
              <span>Class</span>
              <span>Students</span>
              <span>Fees</span>
              <span>Concession</span>
              <span>Collected</span>
              <span>Due now</span>
              <span>Due later</span>
              <span />
            </div>
            {grades.map((g) => {
              const parts = [...g.sections.values()].sort((a, b) => a.section.localeCompare(b.section));
              const can = parts.length > 1 || Boolean(parts[0]?.section);
              const isOpen = open.has(g.klass);
              const body = row(name(g), g, { chevron: can && <Icon name="chevronDown" size={16} /> });
              return (
                <div key={g.klass} className={`cf-group${isOpen ? " is-open" : ""}`}>
                  {can ? (
                    <button type="button" className="cf-row" onClick={() => flip(g.klass)} aria-expanded={isOpen}>
                      {body}
                    </button>
                  ) : (
                    <div className="cf-row">{body}</div>
                  )}
                  {isOpen &&
                    parts.map((s) => (
                      <div key={s.section} className="cf-row cf-sub">
                        {row(s.section || "No section", s)}
                      </div>
                    ))}
                </div>
              );
            })}
            <div className="cf-row cf-total">{row("Total", total)}</div>
          </div>
        </section>
      )}
    </>
  );
}
