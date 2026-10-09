import { useCallback, useMemo, useState } from "react";
import TopBar from "./components/TopBar.jsx";
import PersonCard from "./components/PersonCard.jsx";
import AddModal from "./components/AddModal.jsx";
import ProfileModal from "./components/ProfileModal.jsx";
import FeeSummary from "./components/FeeSummary.jsx";
import ImportModal from "./components/ImportModal.jsx";
import GradeFilter, { gradeOptions } from "./components/GradeFilter.jsx";
import Icon from "./components/Icon.jsx";
import { gradeLabel } from "./components/PersonCard.jsx";
import SessionSelect from "./components/SessionSelect.jsx";
import { useAuth } from "./components/AuthGate.jsx";
import { usePeople } from "./data/usePeople.js";
import { useSessions } from "./data/useSessions.js";

const SEARCH_KEYS = {
  students: ["name", "parent_name", "mother_name", "admission_no", "class", "section", "parent_phone", "srn", "city"],
  employees: ["name", "designation", "department", "employee_no"],
};

export default function App() {
  const [mode, setMode] = useState("students");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [grade, setGrade] = useState("");
  const [importing, setImporting] = useState(false);
  const [pickedSession, setPickedSession] = useState(null);
  const { school } = useAuth();
  const { sessions, current: currentSession } = useSessions(school.id);
  const sessionId = pickedSession ?? currentSession?.id;
  const { people, loading, source, add, patch, reload } = usePeople(mode, school.id, sessionId);

  // Past sessions are history: shown, not edited.
  const viewOnly = mode === "students" && Boolean(currentSession) && sessionId !== currentSession.id;
  const canEdit = source === "supabase" && !viewOnly;

  // Students who left stay in the database (history) but aren't shown.
  const current = useMemo(() => people.filter((p) => p.status !== "left"), [people]);
  const grades = useMemo(() => (mode === "students" ? gradeOptions(current) : []), [current, mode]);
  const inGrade = useMemo(
    () => (mode === "students" && grade ? current.filter((p) => p.class === grade) : current),
    [current, mode, grade]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return inGrade;
    return inGrade.filter((p) =>
      SEARCH_KEYS[mode].some((k) => String(p[k] ?? "").toLowerCase().includes(q))
    );
  }, [inGrade, query, mode]);

  const openIndex = visible.findIndex((p) => p.id === openId);
  const closeProfile = useCallback(() => setOpenId(null), []);

  function switchMode(next) {
    if (next === mode) return;
    setMode(next);
    setQuery("");
    setGrade("");
    setOpenId(null);
  }

  function switchSession(id) {
    setPickedSession(id);
    setGrade("");
    setOpenId(null);
  }

  const isStudents = mode === "students";
  const title = isStudents ? "Students" : "Employees";

  return (
    <div className="app">
      <TopBar mode={mode} onMode={switchMode} />

      <main className="page">
        <div className="page-header">
          <div>
            <h1>{title}</h1>
            <div className="page-meta">
              <span className="page-count">
                {loading ? "Loading…" : `${current.length.toLocaleString("en-IN")} ${mode}`}
              </span>
              {isStudents && (
                <SessionSelect
                  sessions={sessions}
                  value={sessionId}
                  current={currentSession}
                  onChange={switchSession}
                />
              )}
              {viewOnly && <span className="badge badge-neutral">Past session · view only</span>}
            </div>
          </div>
          <div className="page-actions">
            {isStudents && canEdit && (
              <button className="btn btn-secondary" onClick={() => setImporting(true)}>
                <Icon name="upload" />
                Import
              </button>
            )}
            {canEdit && (
              <button className="btn btn-primary" onClick={() => setAdding(true)}>
                <Icon name="plus" />
                Add {isStudents ? "student" : "employee"}
              </button>
            )}
          </div>
        </div>

        {!loading && source === "error" && (
          <p className="notice notice-error">
            Couldn’t load {mode}. Check your connection, or ask your school’s administrator for access.
          </p>
        )}

        {!loading && isStudents && source === "supabase" && (
          <FeeSummary students={inGrade} scope={grade ? gradeLabel(grade) : "All grades"} />
        )}

        <div className="toolbar">
          <label className="search">
            <Icon name="search" />
            <input
              type="search"
              placeholder={isStudents ? "Search name, parent, admission no., phone…" : "Search name, role, department…"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={`Search ${mode}`}
            />
          </label>
          {isStudents && <GradeFilter options={grades} value={grade} onChange={setGrade} />}
          {!loading && (query || grade) && (
            <span className="toolbar-count">
              {visible.length} of {current.length}
            </span>
          )}
        </div>

        {loading ? (
          <div className="grid" aria-busy="true">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="card card-skeleton" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="empty">
            <p className="empty-title">No {mode} found</p>
            <p>
              {query ? `Nothing matches “${query}”` : "Nothing here yet"}
              {grade ? ` in ${gradeLabel(grade)}` : ""}.
            </p>
          </div>
        ) : (
          <div className="grid">
            {visible.map((p, i) => (
              <PersonCard key={p.id} person={p} mode={mode} index={i} onOpen={() => setOpenId(p.id)} />
            ))}
          </div>
        )}
      </main>

      {openIndex !== -1 && (
        <ProfileModal
          person={visible[openIndex]}
          mode={mode}
          schoolId={school.id}
          sessionId={sessionId}
          canEdit={canEdit}
          onUpdate={patch}
          onClose={closeProfile}
        />
      )}
      {importing && (
        <ImportModal
          schoolId={school.id}
          students={people}
          onClose={() => setImporting(false)}
          onDone={reload}
        />
      )}
      {adding && <AddModal mode={mode} onClose={() => setAdding(false)} onSave={add} />}
    </div>
  );
}
