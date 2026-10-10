import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import InstallPrompt from "./components/InstallPrompt.jsx";
import TopBar from "./components/TopBar.jsx";
import PersonCard from "./components/PersonCard.jsx";
import PhotoUpgrade from "./components/PhotoUpgrade.jsx";
import AddModal from "./components/AddModal.jsx";
import ProfileModal from "./components/ProfileModal.jsx";
import ImportModal from "./components/ImportModal.jsx";
import GradeFilter, { gradeOptions, gradeRank, gradesText } from "./components/GradeFilter.jsx";
import Icon from "./components/Icon.jsx";
import { setGradeLabels } from "./components/PersonCard.jsx";
import SessionSelect from "./components/SessionSelect.jsx";
import TeamPage from "./components/TeamPage.jsx";
import ExportButton from "./components/ExportButton.jsx";
import FeesPage from "./components/FeesPage.jsx";
import RequestsPage from "./components/RequestsPage.jsx";
import { countOpenRequests, countPendingRequests, listGrades, listRoutes } from "./data/api.js";
import { useAuth } from "./components/AuthGate.jsx";
import { usePeople } from "./data/usePeople.js";
import { useSessions } from "./data/useSessions.js";

const SEARCH_KEYS = {
  students: ["name", "parent_name", "mother_name", "admission_no", "class", "section", "parent_phone", "srn", "city"],
  employees: ["name", "designation", "department", "employee_no"],
};


const StudentMap = lazy(() => import("./components/StudentMap.jsx"));
export default function App() {
  const [mode, setMode] = useState("students");
  const [query, setQuery] = useState("");
  // Students page: tiles or the map (owners/admins). Remembered per browser.
  const [view, setViewState] = useState(() => {
    try {
      return localStorage.getItem("godview.studentsView") === "map" ? "map" : "tiles";
    } catch {
      return "tiles";
    }
  });
  const setView = (v) => {
    setViewState(v);
    try {
      localStorage.setItem("godview.studentsView", v);
    } catch {
      /* private mode: fine, just not remembered */
    }
  };
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [openTab, setOpenTab] = useState("details");
  const [pickedGrades, setPickedGrades] = useState([]); // picked grades; none means all
  const [importing, setImporting] = useState(false);
  const [pickedSession, setPickedSession] = useState(null);
  const { school, role, user, setSchool } = useAuth();
  const isOwner = role === "owner";
  const isAdmin = role === "owner" || role === "admin";
  const [pendingCount, setPendingCount] = useState(0);
  const [openRequests, setOpenRequests] = useState(0);
  const [badgeTick, setBadgeTick] = useState(0);
  useEffect(() => {
    if (isOwner) countPendingRequests(school.id).then(setPendingCount, () => setPendingCount(0));
    countOpenRequests(school.id).then(setOpenRequests, () => setOpenRequests(0));
  }, [isOwner, school.id, mode, badgeTick]);
  const { sessions, current: currentSession } = useSessions(school.id);

  // The school's grade list (names and sections); grade names everywhere use it.
  const [schoolGrades, setSchoolGrades] = useState([]);
  const loadGrades = useCallback(() => {
    listGrades(school.id).then(
      (rows) => {
        setGradeLabels(rows);
        setSchoolGrades(rows);
      },
      () => setSchoolGrades([])
    );
  }, [school.id]);
  useEffect(() => {
    loadGrades();
  }, [loadGrades]);

  // Bus routes with their stops (for the Add student card, profiles, Owner).
  const [routes, setRoutes] = useState([]);
  const [ownerTab, setOwnerTab] = useState("team");
  const openOwner = (tab) => {
    setOwnerTab(tab);
    switchMode("team");
  };
  const loadRoutes = useCallback(
    () => listRoutes(school.id).then(setRoutes, () => setRoutes([])),
    [school.id]
  );
  useEffect(() => {
    loadRoutes();
  }, [loadRoutes]);
  const sessionId = pickedSession ?? currentSession?.id;
  // Fees, Requests and Team work on the session's students.
  const dataMode = mode === "employees" ? "employees" : "students";
  const { people, loading, source, add, patch, reload } = usePeople(dataMode, school.id, sessionId);

  // Past sessions are history: shown, not edited.
  const viewOnly = mode !== "employees" && Boolean(currentSession) && sessionId !== currentSession.id;
  // Records: owners/admins. Photos, notes, results: anyone who can see the student.
  const canEdit = source === "supabase" && !viewOnly && isAdmin;
  const canWrite = source === "supabase" && !viewOnly;

  // Students who left stay in the database (history) but aren't shown.
  // Ordered by grade (Nursery → 12), then section, then name.
  const current = useMemo(
    () =>
      people
        .filter((p) => p.status !== "left")
        .sort(
          (a, b) =>
            gradeRank(a.class ?? "") - gradeRank(b.class ?? "") ||
            String(a.section ?? "").localeCompare(String(b.section ?? "")) ||
            String(a.name ?? "").localeCompare(String(b.name ?? ""))
        ),
    [people]
  );
  const gradeChoices = useMemo(() => (mode === "students" ? gradeOptions(current) : []), [current, mode]);
  const inGrade = useMemo(
    () => (mode === "students" && pickedGrades.length ? current.filter((p) => pickedGrades.includes(p.class)) : current),
    [current, mode, pickedGrades]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return inGrade;
    return inGrade.filter((p) =>
      SEARCH_KEYS[mode].some((k) => String(p[k] ?? "").toLowerCase().includes(q))
    );
  }, [inGrade, query, mode]);

  // On the Students page the profile follows the filtered grid; elsewhere
  // (Fees, Requests) any student in the session can be opened.
  const profileList = mode === "students" || mode === "employees" ? visible : current;
  const openIndex = profileList.findIndex((p) => p.id === openId);
  const closeProfile = useCallback(() => setOpenId(null), []);
  const openStudent = useCallback((id, tab = "details") => {
    setOpenTab(tab);
    setOpenId(id);
  }, []);

  function switchMode(next) {
    if (next === mode) return;
    setMode(next);
    setQuery("");
    setPickedGrades([]);
    setOpenId(null);
  }

  const selectedSession = sessions.find((s) => s.id === sessionId);
  const currentLabel = selectedSession?.name ?? "";

  function switchSession(id) {
    setPickedSession(id);
    setPickedGrades([]);
    setOpenId(null);
  }

  const isStudents = mode === "students";
  // Teachers only ever load their own classes; say so, so the number isn't
  // mistaken for the whole school.
  const countLabel = (() => {
    const n = `${current.length.toLocaleString("en-IN")} ${mode}`;
    if (!isStudents || isAdmin) return n;
    const classes = new Set(current.map((p) => `${p.class}|${p.section ?? ""}`)).size;
    return classes ? `${n} in your ${classes} class${classes === 1 ? "" : "es"}` : n;
  })();
  const title = isStudents ? "Students" : "Employees";
  const sections = [
    ["students", "Students"],
    ...(isAdmin ? [["fees", "Fees"]] : []),
    ["requests", "Requests", openRequests],
    ...(isAdmin ? [["employees", "Employees"]] : []),
    ...(isOwner ? [["team", "Owner", pendingCount]] : []),
  ];

  return (
    <div className="app">
      <TopBar mode={mode} onMode={switchMode} sections={sections} />
      {/* Quietly shrinks full-size ERP photos in the background (computers, owners/admins). */}
      {!loading && isAdmin && dataMode === "students" && <PhotoUpgrade schoolId={school.id} students={people} onPhoto={patch} />}
      <InstallPrompt />

      <main className="page">
        {mode === "team" ? (
          <TeamPage
            school={school}
            session={currentSession}
            me={user.email}
            onSchoolSaved={setSchool}
            routes={routes}
            onRoutesChanged={loadRoutes}
            tab={ownerTab}
            onTab={setOwnerTab}
            students={current}
          />
        ) : mode === "fees" ? (
          <FeesPage
            school={school}
            role={role}
            grades={schoolGrades}
            onGradesChanged={loadGrades}
            session={selectedSession}
            students={current}
            onOpenStudent={openStudent}
            onChanged={reload}
          />
        ) : mode === "requests" ? (
          <RequestsPage
            school={school}
            me={user.email}
            onOpenStudent={(id) => openStudent(id)}
            onChanged={() => setBadgeTick((t) => t + 1)}
          />
        ) : (
        <>
        <div className="page-header">
          <div>
            <h1 className="sr-only">{title}</h1>
            <div className="page-meta">
              <span className="page-count">
                {loading ? "Loading…" : countLabel}
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
            {isStudents && isAdmin && !loading && (
              <ExportButton school={school} role={role} people={visible} label={`students-${currentLabel}`} />
            )}
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

        {!loading && isStudents && !isAdmin && current.length === 0 && (
          <p className="notice">
            You haven’t been given any classes for this session yet. Ask the school’s owner to assign your classes.
          </p>
        )}

        <div className="toolbar">
          {isStudents && isAdmin && (
            <nav className="segmented view-switch" aria-label="View">
              {[
                ["tiles", "Tiles"],
                ["map", "Map"],
              ].map(([v, l]) => (
                <button key={v} className={view === v ? "active" : ""} onClick={() => setView(v)}>
                  {l}
                </button>
              ))}
            </nav>
          )}
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
          {isStudents && <GradeFilter options={gradeChoices} value={pickedGrades} onChange={setPickedGrades} />}
          {!loading && (query || pickedGrades.length > 0) && (
            <span className="toolbar-count">
              {visible.length} of {current.length}
            </span>
          )}
        </div>

        {isStudents && isAdmin && view === "map" && !loading ? (
          <Suspense fallback={<p className="row-sub">Loading the map…</p>}>
            <StudentMap school={school} students={visible} allStudents={current} canEdit={canEdit} onOpenStudent={(id) => openStudent(id)} />
          </Suspense>
        ) : loading ? (
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
              {pickedGrades.length ? ` in ${gradesText(pickedGrades)}` : ""}.
            </p>
          </div>
        ) : (
          <div className="grid">
            {visible.map((p, i) => (
              <PersonCard key={p.id} person={p} mode={mode} index={i} showFee={isAdmin} onOpen={() => openStudent(p.id)} />
            ))}
          </div>
        )}
        </>
        )}
      </main>

      {openIndex !== -1 && (
        <ProfileModal
          key={`${openId}-${openTab}`}
          person={profileList[openIndex]}
          mode={dataMode}
          initialTab={openTab}
          school={school}
          schoolId={school.id}
          sessionId={sessionId}
          me={user.email}
          isAdmin={isAdmin}
          canEdit={canEdit}
          canWrite={canWrite}
          onUpdate={patch}
          onFeesChanged={reload}
          onClose={closeProfile}
          grades={schoolGrades}
          routes={routes}
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
      {adding && (
        <AddModal
          mode={mode}
          grades={schoolGrades}
          routes={routes}
          students={mode === "students" ? people : []}
          onClose={() => setAdding(false)}
          onSave={add}
          onManageRoutes={isOwner ? () => (setAdding(false), openOwner("transport")) : null}
        />
      )}
    </div>
  );
}
