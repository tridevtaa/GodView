import { useEffect, useState } from "react";
import { listClassSections, myClassAllocationRequest, requestClassAllocation } from "../data/api.js";
import ClassPicker from "./ClassPicker.jsx";
import { gradeLabel } from "./PersonCard.jsx";
import { logOut } from "./AuthGate.jsx";
import { LogoMark } from "./Logo.jsx";

const classList = (classes = []) =>
  classes.map((c) => `${gradeLabel(c.class)}${c.section ? ` · ${c.section}` : ""}`).join(", ");

// Full-screen, shown instead of the dashboard to a teacher with no classes
// assigned this session: pick classes, then wait for the owner to approve.
export default function ClassAllocationGate({ school, session }) {
  const [classOptions, setClassOptions] = useState([]);
  const [request, setRequest] = useState(undefined); // undefined = loading, null = none yet
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    Promise.all([listClassSections(school.id, session.id), myClassAllocationRequest(school.id)]).then(
      ([options, latest]) => {
        if (!alive) return;
        setClassOptions(options);
        setRequest(latest);
        if (latest && latest.status !== "approved") {
          setClasses(latest.classes ?? []);
          setSubjects(latest.subjects ?? "");
          setNote(latest.note ?? "");
        }
      },
      () => alive && setRequest(null)
    );
    return () => {
      alive = false;
    };
  }, [school.id, session.id]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await requestClassAllocation(school.id, classes, subjects, note);
      setRequest({ status: "pending", classes, subjects, note, created_at: new Date().toISOString() });
    } catch (err) {
      setError(/pick at least one/i.test(err?.message ?? "") ? "Pick at least one class." : "Couldn’t send that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (request === undefined) {
    return <main data-clarity-mask="True" className="auth-screen" aria-busy="true" />;
  }

  if (request?.status === "pending") {
    return (
      <main data-clarity-mask="True" className="auth-screen">
        <div className="auth-card">
          <div className="auth-brand">
            <LogoMark size={44} />
          </div>
          <div className="request-form">
            <h1>Waiting for approval</h1>
            <p className="muted">
              {school.name}’s owner hasn’t reviewed your classes yet. You’ll land on your dashboard as soon as they approve.
            </p>
            <dl className="summary-list">
              <div>
                <dt>Classes</dt>
                <dd className="summary-wrap">{classList(request.classes)}</dd>
              </div>
            </dl>
            <button className="btn btn-primary btn-block" onClick={() => window.location.reload()}>
              Check again
            </button>
            <button className="btn btn-secondary btn-block" onClick={() => setRequest(null)}>
              Update request
            </button>
            <button className="btn btn-secondary btn-block" onClick={logOut}>
              Sign out
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main data-clarity-mask="True" className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <LogoMark size={44} />
        </div>
        <form className="request-form request-form-wide" onSubmit={submit}>
          <h1>Pick your classes</h1>
          <p className="muted">
            {request?.status === "rejected"
              ? `${school.name} didn’t approve your last request. Pick again.`
              : `One more step before your dashboard: tell ${school.name} which classes you teach.`}
          </p>
          <div className="field-block">
            <span className="field-label">Your classes{session?.name ? ` for ${session.name}` : ""}</span>
            <ClassPicker options={classOptions} value={classes} onChange={setClasses} />
          </div>
          <label>
            <span>Subjects you teach</span>
            <input value={subjects} onChange={(e) => setSubjects(e.target.value)} maxLength={200} placeholder="e.g. Maths, EVS" />
          </label>
          <label>
            <span>Note for the owner</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Optional" />
          </label>
          {error && <p className="field-error">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={busy || !classes.length}>
            {busy ? "Sending…" : "Send request"}
          </button>
          <button type="button" className="btn btn-secondary btn-block" onClick={logOut}>
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
