import { useEffect, useMemo, useRef, useState } from "react";
import { saveClassResults, sessionTests, testResults } from "../data/api.js";
import { gradeRank } from "./GradeFilter.jsx";
import { Photo, gradeLabel } from "./PersonCard.jsx";
import { StepBar } from "./Steps.jsx";
import ClassSwitcher from "./ClassSwitcher.jsx";
import Icon from "./Icon.jsx";

const classText = (c, s) => `${gradeLabel(c)}${s ? ` · ${s}` : ""}`;

// Class-wise marks, in two steps: the test (class, exam, subject, out of),
// then every student in the class with a marks box. Marks already entered
// for that test are filled in, so this also corrects them. Blank = not
// entered (e.g. absent), and is left alone.
export default function MarksPage({ school, session, students, onClose }) {
  const [step, setStep] = useState(0);
  const [test, setTest] = useState({ key: "", exam: "", subject: "", max: "100" });
  const [known, setKnown] = useState({ exams: [], subjects: [] });
  const [marks, setMarks] = useState({}); // student id -> string
  const [before, setBefore] = useState({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(0);
  const inputs = useRef([]);

  useEffect(() => {
    if (session) sessionTests(session.id).then(setKnown, () => {});
  }, [session]);

  const groups = useMemo(() => {
    const m = new Map();
    for (const s of students) {
      if (!s.class || s.status === "left") continue;
      const key = `${s.class}|${s.section ?? ""}`;
      m.set(key, [...(m.get(key) ?? []), s]);
    }
    return [...m]
      .map(([key, kids]) => ({
        key,
        klass: key.split("|")[0],
        section: key.split("|")[1],
        kids: kids.sort((x, y) => (Number(x.roll_no) || 999) - (Number(y.roll_no) || 999) || x.name.localeCompare(y.name)),
      }))
      .sort((a, b) => gradeRank(a.klass) - gradeRank(b.klass) || a.section.localeCompare(b.section));
  }, [students]);
  // One class: picked for you.
  useEffect(() => {
    if (!test.key && groups.length === 1) setTest((t) => ({ ...t, key: groups[0].key }));
  }, [groups, test.key]);
  const group = groups.find((g) => g.key === test.key);
  const max = Number(test.max);
  const testOk = Boolean(group && test.exam.trim() && test.subject.trim() && max > 0);

  async function toMarks() {
    if (!testOk) return;
    setLoading(true);
    setError("");
    try {
      const rows = await testResults(session.id, test.exam, test.subject);
      const got = Object.fromEntries(rows.map((r) => [r.student_id, r.marks === null ? "" : String(Number(r.marks))]));
      const start = Object.fromEntries(group.kids.map((k) => [k.id, got[k.id] ?? ""]));
      setMarks(start);
      setBefore(start);
      setStep(1);
    } catch {
      setError("Couldn’t load this test’s marks. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  const over = (v) => v !== "" && (Number(v) < 0 || Number(v) > max || Number.isNaN(Number(v)));
  const entered = group ? group.kids.filter((k) => marks[k.id] !== "" && marks[k.id] !== undefined).length : 0;
  const changed = group ? group.kids.filter((k) => (marks[k.id] ?? "") !== (before[k.id] ?? "")) : [];
  const bad = group ? group.kids.some((k) => over(marks[k.id] ?? "")) : false;

  async function save() {
    if (!changed.length || bad) return;
    setBusy(true);
    setError("");
    try {
      await saveClassResults(school.id, session.id, { exam: test.exam, subject: test.subject, max_marks: max }, changed.map((k) => ({ student_id: k.id, marks: marks[k.id] })));
      setBefore(marks);
      setSaved(changed.filter((k) => marks[k.id] !== "").length);
    } catch {
      setError("Couldn’t save. Check the marks (not more than the maximum) and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="marks">
      <div className="marks-top">
        <button className="back-btn" onClick={onClose} aria-label="Back" title="Back">
          <Icon name="chevronLeft" size={22} />
        </button>
        <StepBar steps={["Test", "Marks"]} step={step} onPick={(i) => (i === 0 ? setStep(0) : toMarks())} canPick={(i) => i === 0 || testOk} />
      </div>

      {step === 0 && (
        <form
          className="marks-test"
          onSubmit={(e) => {
            e.preventDefault();
            toMarks();
          }}
        >
          <div className="field">
            <span>Class</span>
            {groups.length ? (
              <ClassSwitcher groups={groups} value={test.key} onChange={(key) => setTest({ ...test, key })} />
            ) : (
              <p className="row-sub">No classes yet.</p>
            )}
          </div>
          <div className="form-grid">
            <label>
              <span>Exam</span>
              <input className="input" list="marks-exams" value={test.exam} onChange={(e) => setTest({ ...test, exam: e.target.value })} placeholder="e.g. Unit Test 1" maxLength={80} required />
              <datalist id="marks-exams">
                {known.exams.map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </label>
            <label>
              <span>Subject</span>
              <input className="input" list="marks-subjects" value={test.subject} onChange={(e) => setTest({ ...test, subject: e.target.value })} placeholder="e.g. Maths" maxLength={80} required />
              <datalist id="marks-subjects">
                {known.subjects.map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </label>
            <label>
              <span>Out of</span>
              <input className="input" type="number" inputMode="decimal" min="1" value={test.max} onChange={(e) => setTest({ ...test, max: e.target.value })} required />
            </label>
          </div>
          {error && <p className="field-error">{error}</p>}
          <div className="marks-foot">
            <span />
            <button className="btn btn-primary" disabled={!testOk || loading}>
              {loading ? "Loading…" : "Next"} <Icon name="arrowRight" />
            </button>
          </div>
        </form>
      )}

      {step === 1 && group && (
        <section className="marks-sheet">
          <header className="marks-sheet-head">
            <strong>{classText(group.klass, group.section)}</strong>
            <span className="row-sub">
              {test.exam} · {test.subject} · out of {max}
            </span>
          </header>
          <ol className="marks-list">
            {group.kids.map((k, i) => {
              const v = marks[k.id] ?? "";
              return (
                <li key={k.id} className={over(v) ? "is-bad" : ""}>
                  <Photo person={k} className="att-photo" />
                  <span className="att-name">
                    <strong>{k.name}</strong>
                    {k.roll_no && <span className="row-sub">Roll {k.roll_no}</span>}
                  </span>
                  <input
                    ref={(el) => (inputs.current[i] = el)}
                    className="input marks-input"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max={max}
                    step="0.5"
                    value={v}
                    placeholder="–"
                    aria-label={`${k.name} marks`}
                    onChange={(e) => (setMarks({ ...marks, [k.id]: e.target.value }), setSaved(0))}
                    onKeyDown={(e) => {
                      // Enter moves down the list, like a register.
                      if (e.key === "Enter") {
                        e.preventDefault();
                        inputs.current[i + 1]?.focus();
                      }
                    }}
                  />
                  <span className="marks-max">/ {max}</span>
                </li>
              );
            })}
          </ol>
          <div className="marks-save">
            <span className="row-sub">
              {saved ? (
                <>
                  <Icon name="check" size={14} /> Saved {saved}
                </>
              ) : (
                `${entered} of ${group.kids.length} entered`
              )}
            </span>
            {error && <span className="field-error">{error}</span>}
            <button className="btn btn-primary" onClick={save} disabled={busy || bad || !changed.length}>
              <Icon name="check" />
              {busy ? "Saving…" : "Save marks"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
