import { useEffect, useMemo, useRef, useState } from "react";
import { saveClassResults, sessionTests, testResults } from "../data/api.js";
import { parseMarksSheet } from "../data/marksImport.js";
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
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState(null); // { matched, unmatched, invalid }
  const [toast, setToast] = useState("");
  const inputs = useRef([]);
  const fileInput = useRef(null);
  const toastTimer = useRef(null);

  useEffect(() => () => clearTimeout(toastTimer.current), []);
  function flash(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2200);
  }

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

  // Blocks a bad keystroke before it lands, rather than only flagging it
  // after the fact: negative, over the max, or finer than half marks.
  function enterMark(raw, kidId) {
    if (raw === "") {
      setMarks((m) => ({ ...m, [kidId]: "" }));
      setSaved(0);
      return;
    }
    const num = Number(raw);
    if (Number.isNaN(num)) return;
    if (num < 0) return flash("Marks can't be negative");
    if (num > max) return flash(`Marks can't be more than ${max}`);
    if ((num * 2) % 1 !== 0) return flash("Enter a whole number or a half mark, e.g. 32 or 32.5");
    setMarks((m) => ({ ...m, [kidId]: raw }));
    setSaved(0);
  }

  // Lets a teacher upload a sheet (Roll No / Name + one marks column) instead
  // of typing every value. Matched rows fill the inputs below for review;
  // nothing is saved until "Save marks" is pressed.
  async function importFile(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !group) return;
    setImporting(true);
    setError("");
    setImportNote(null);
    try {
      const XLSX = await import("xlsx"); // loaded only when importing
      const book = XLSX.read(await f.arrayBuffer(), { cellDates: true });
      const sheet = book.Sheets[book.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
      if (!rows.length) throw new Error("That sheet looks empty");
      const { matched, unmatched } = parseMarksSheet(rows, group.kids, max);
      setMarks((m) => {
        const next = { ...m };
        for (const r of matched) next[r.id] = r.value;
        return next;
      });
      setSaved(0);
      setImportNote({ matched: matched.length, unmatched, invalid: matched.filter((r) => r.invalid).length });
    } catch (err) {
      setError(err.message || "Couldn't read that file.");
    } finally {
      setImporting(false);
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
            <div className="marks-sheet-head-text">
              <strong>{classText(group.klass, group.section)}</strong>
              <span className="row-sub">
                {test.exam} · {test.subject} · out of {max}
              </span>
            </div>
            <label className="btn btn-secondary btn-sm marks-upload-btn">
              <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" onChange={importFile} disabled={importing} />
              <Icon name="upload" size={16} />
              {importing ? "Reading…" : "Upload a sheet"}
            </label>
          </header>
          {importNote && (
            <p className="marks-import-note row-sub">
              <Icon name="check" size={14} /> {importNote.matched} matched from the file
              {importNote.invalid ? `, ${importNote.invalid} out of range` : ""}
              {importNote.unmatched.length
                ? ` · ${importNote.unmatched.length} not found: ${importNote.unmatched
                    .slice(0, 5)
                    .map((u) => u.name || `Roll ${u.roll_no}`)
                    .join(", ")}${importNote.unmatched.length > 5 ? "…" : ""}`
                : ""}
            </p>
          )}
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
                    onChange={(e) => enterMark(e.target.value, k.id)}
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
      {toast && <p className="marks-toast">{toast}</p>}
    </div>
  );
}
