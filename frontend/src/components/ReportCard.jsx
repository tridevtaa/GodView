import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { attendanceTotals, listSessions, logoUrl } from "../data/api.js";
import { gradeLabel } from "./PersonCard.jsx";
import Icon from "./Icon.jsx";

// The 8-point scale most Indian boards use.
const SCALE = [
  [91, "A1"],
  [81, "A2"],
  [71, "B1"],
  [61, "B2"],
  [51, "C1"],
  [41, "C2"],
  [33, "D"],
  [0, "E"],
];
const gradeFor = (pct) => (pct === null ? "" : SCALE.find(([min]) => pct >= min)[1]);
const shortDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
const num = (n) => String(Math.round(Number(n) * 100) / 100);
const scored = (r) => r && r.marks !== null && r.max_marks;

// A printable report card from the marks entered for this session. The
// teacher picks the exams to show and can add a remark before printing.
export default function ReportCard({ school, person, sessionId, results, onClose }) {
  // Exams in the order they were first entered (Unit 1 before Term 1)
  const exams = useMemo(() => {
    const first = new Map();
    results.forEach((r) => {
      const at = r.created_at ?? "";
      if (!first.has(r.exam) || at < first.get(r.exam)) first.set(r.exam, at);
    });
    return [...first].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0])).map(([e]) => e);
  }, [results]);
  const [shown, setShown] = useState(exams);
  const [remarks, setRemarks] = useState("");
  const [session, setSession] = useState("");
  const [attendance, setAttendance] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    listSessions(person.school_id).then(
      (list) => !cancelled && setSession(list.find((s) => s.id === sessionId)?.name ?? ""),
      () => {}
    );
    attendanceTotals(person.id, sessionId).then(
      (t) => !cancelled && setAttendance(t),
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, [person.id, person.school_id, sessionId]);

  const cols = exams.filter((e) => shown.includes(e));
  const subjects = [...new Set(results.filter((r) => cols.includes(r.exam)).map((r) => r.subject))].sort((a, b) => a.localeCompare(b));
  const cell = new Map(results.map((r) => [`${r.exam}\u0000${r.subject}`, r]));
  const get = (exam, subject) => cell.get(`${exam}\u0000${subject}`);

  // When every subject in an exam is out of the same marks, say it once in
  // the heading and print only the marks.
  const sameMax = Object.fromEntries(
    cols.map((e) => {
      const maxes = new Set(results.filter((r) => r.exam === e && r.max_marks).map((r) => Number(r.max_marks)));
      return [e, maxes.size === 1 ? [...maxes][0] : null];
    })
  );

  const sum = (rows) => {
    const ok = rows.filter(scored);
    const got = ok.reduce((s, r) => s + Number(r.marks), 0);
    const max = ok.reduce((s, r) => s + Number(r.max_marks), 0);
    return { got, max, pct: max ? (got / max) * 100 : null };
  };
  const bySubject = (s) => sum(cols.map((e) => get(e, s)));
  const byExam = (e) => sum(subjects.map((s) => get(e, s)));
  const overall = sum(cols.flatMap((e) => subjects.map((s) => get(e, s))));
  const many = cols.length > 1;

  const address = [school.address, school.city, school.state, school.pincode].filter(Boolean).join(", ");
  const details = [
    ["Student", person.name],
    ["Class", [gradeLabel(person.class), person.section].filter(Boolean).join(" · ")],
    ["Admission no.", person.admission_no],
    ["Roll no.", person.roll_no],
    ["Father", person.parent_name],
    ["Mother", person.mother_name],
    ["Date of birth", shortDate(person.dob)],
    ["Attendance", attendance?.working ? `${attendance.present} of ${attendance.working} days` : ""],
  ].filter(([, v]) => v);

  const toggle = (e) => setShown((s) => (s.includes(e) ? (s.length > 1 ? s.filter((x) => x !== e) : s) : [...s, e]));

  return createPortal(
    <div className="modal-backdrop receipt-backdrop" onClick={(e) => (e.stopPropagation(), onClose())}>
      <section className="modal receipt-modal cert-modal" onClick={(e) => e.stopPropagation()} aria-label="Report card">
        <div className="receipt-tools no-print">
          <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
            <Icon name="file" /> Print / Save PDF
          </button>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="rc-setup no-print">
          {exams.length > 1 && (
            <div className="choice-row" role="group" aria-label="Exams on the report card">
              {exams.map((e) => (
                <button type="button" key={e} className={`choice${shown.includes(e) ? " on" : ""}`} aria-pressed={shown.includes(e)} onClick={() => toggle(e)}>
                  {e}
                </button>
              ))}
            </div>
          )}
          <textarea className="input" rows={2} maxLength={300} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Teacher’s remarks (optional)" aria-label="Teacher’s remarks" />
        </div>

        <article className="receipt cert report-card">
          <header className="receipt-head cert-head">
            {school.logo_path && <img src={logoUrl(school.logo_path)} alt="" />}
            <div>
              <h2>{school.name}</h2>
              {address && <p>{address}</p>}
              {(school.phone || school.email) && <p>{[school.phone, school.email].filter(Boolean).join(" · ")}</p>}
            </div>
          </header>
          <h3 className="cert-title">Report Card{session ? ` ${session}` : ""}</h3>

          <dl className="receipt-meta rc-meta">
            {details.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>

          <div className="rc-scroll">
            <table className="rc-table">
              <thead>
                <tr>
                  <th scope="col">Subject</th>
                  {cols.map((e) => (
                    <th scope="col" key={e}>
                      {e}
                      {sameMax[e] && <small>out of {num(sameMax[e])}</small>}
                    </th>
                  ))}
                  {many && <th scope="col">Total</th>}
                  <th scope="col">Grade</th>
                </tr>
              </thead>
              <tbody>
                {subjects.map((s) => {
                  const t = bySubject(s);
                  const own = cols.length === 1 ? get(cols[0], s)?.grade : null;
                  return (
                    <tr key={s}>
                      <th scope="row">{s}</th>
                      {cols.map((e) => {
                        const r = get(e, s);
                        return (
                          <td key={e}>
                            {r?.marks == null ? (r?.grade ?? "-") : sameMax[e] ? num(r.marks) : `${num(r.marks)}${r.max_marks ? ` / ${num(r.max_marks)}` : ""}`}
                          </td>
                        );
                      })}
                      {many && <td>{t.max ? `${num(t.got)} / ${num(t.max)}` : "-"}</td>}
                      <td className="rc-grade">{own || gradeFor(t.pct) || "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  {cols.map((e) => {
                    const t = byExam(e);
                    return <td key={e}>{t.max ? `${num(t.got)} / ${num(t.max)}` : "-"}</td>;
                  })}
                  {many && <td>{overall.max ? `${num(overall.got)} / ${num(overall.max)}` : "-"}</td>}
                  <td className="rc-grade">{gradeFor(overall.pct) || "-"}</td>
                </tr>
                {many && (
                  <tr>
                    <th scope="row">Percentage</th>
                    {cols.map((e) => {
                      const t = byExam(e);
                      return <td key={e}>{t.pct === null ? "-" : `${num(t.pct.toFixed(1))}%`}</td>;
                    })}
                    <td>{overall.pct === null ? "-" : `${num(overall.pct.toFixed(1))}%`}</td>
                    <td />
                  </tr>
                )}
              </tfoot>
            </table>
          </div>

          {overall.pct !== null && (
            <p className="rc-overall">
              Overall <strong>{num(overall.pct.toFixed(1))}%</strong> · Grade <strong>{gradeFor(overall.pct)}</strong>
            </p>
          )}

          <div className="rc-remarks">
            <span>Remarks</span>
            <p className={remarks.trim() ? "" : "is-blank"}>{remarks.trim() || " "}</p>
          </div>

          <p className="rc-scale">Grades: {SCALE.map(([min, g], i) => `${g} ${min}${i ? `-${SCALE[i - 1][0] - 1}` : "-100"}`).join(" · ")}</p>

          <footer className="cert-sign">
            <span>Class teacher</span>
            <span>Parent</span>
            <span>
              {school.principal_name && <strong>{school.principal_name}</strong>}
              Principal
            </span>
          </footer>
        </article>
      </section>
    </div>,
    document.body
  );
}
