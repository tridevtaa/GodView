import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import InstallPrompt from "./components/InstallPrompt.jsx";
import TopBar from "./components/TopBar.jsx";
import PersonCard from "./components/PersonCard.jsx";
import PhotoUpgrade from "./components/PhotoUpgrade.jsx";
import HomeworkPage from "./components/HomeworkPage.jsx";
import AttendancePage from "./components/AttendancePage.jsx";
import AddModal from "./components/AddModal.jsx";
import ProfileModal from "./components/ProfileModal.jsx";
import ImportModal from "./components/ImportModal.jsx";
import GradeFilter, { gradeOptions, gradeRank, gradesText } from "./components/GradeFilter.jsx";
import Icon from "./components/Icon.jsx";
import { setGradeLabels } from "./components/PersonCard.jsx";
import SessionSelect from "./components/SessionSelect.jsx";
import TeamPage from "./components/TeamPage.jsx";
import TransportRoutes from "./components/TransportRoutes.jsx";
import ExportButton from "./components/ExportButton.jsx";
import FeesPage from "./components/FeesPage.jsx";
import InboxPage from "./components/InboxPage.jsx";
import MarksPage from "./components/MarksPage.jsx";
import GlobalSearch from "./components/GlobalSearch.jsx";
import { countPendingRequests, listAssignments, listGrades, listRoutes, sessionResultPercents, staffInbox } from "./data/api.js";
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
  // Transport: the map starts as a small preview ("routes"); "map" opens it.
  const [view, setView] = useState("routes");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [openTab, setOpenTab] = useState("details");
  const [pickedGrades, setPickedGrades] = useState([]); // picked grades; none means all
  const [importing, setImporting] = useState(false);
  const [pickedSession, setPickedSession] = useState(null);
  const { school, role, user, setSchool } = useAuth();
  const isOwner = role === "owner";
  const isAdmin = role === "owner" || role === "admin";
  // Principal: sees students, attendance, homework, requests and employees
  // across the school, and changes nothing (no imports, exports or edits).
  const isPrincipal = role === "principal";
  const [pendingCount, setPendingCount] = useState(0);
  // Inbox badge: conversations with unread parent messages or open requests.
  const [inboxCount, setInboxCount] = useState(0);
  useEffect(() => {
    if (isOwner) countPendingRequests(school.id).then(setPendingCount, () => setPendingCount(0));
    staffInbox(school.id).then(
      (rows) => setInboxCount(rows.filter((t) => Number(t.unread) > 0 || Number(t.open_requests) > 0).length),
      () => {}
    );
  }, [isOwner, school.id, mode]);
  const { sessions, current: currentSession } = useSessions(school.id);

  // The pinned search strip frosts only once the page has scrolled.
  useEffect(() => {
    const root = document.documentElement;
    const onScroll = () => root.classList.toggle("is-scrolled", window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      root.classList.remove("is-scrolled");
    };
  }, []);

  // Teachers see Attendance only when they're a class's class teacher
  // (in-charge) this session; owners, admins and the principal always do.
  const [isClassTeacher, setIsClassTeacher] = useState(false);
  useEffect(() => {
    if (role !== "teacher" || !currentSession) return;
    listAssignments(school.id).then(
      (rows) => setIsClassTeacher(rows.some((a) => a.email === user.email && a.session_id === currentSession.id && a.is_class_teacher)),
      () => setIsClassTeacher(false)
    );
  }, [role, school.id, currentSession, user.email]);
  const seesAttendance = role !== "teacher" || isClassTeacher;

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
  // Staff: the people (employees) and, for the owner, who can sign in.
  const [staffTab, setStaffTab] = useState("people");
  // School settings (profile) or the Transport tab.
  const openOwner = (tab) => switchMode(tab === "transport" ? "transport" : "team");
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
  const canWrite = source === "supabase" && !viewOnly && !isPrincipal;

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

  // Students page order: the last three profiles this person opened, then
  // owners and admins see the biggest dues first; teachers (and the
  // principal) see the lowest results first, students without marks last.
  const recentKey = `godview.recent.${school.id}.${user.email}`;
  const [recent, setRecent] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(recentKey) || "[]");
    } catch {
      return [];
    }
  });
  const rememberOpened = useCallback(
    (id) =>
      setRecent((r) => {
        const next = [id, ...r.filter((x) => x !== id)].slice(0, 3);
        try {
          localStorage.setItem(recentKey, JSON.stringify(next));
        } catch {
          /* private mode: fine */
        }
        return next;
      }),
    [recentKey]
  );
  const [perf, setPerf] = useState(new Map());
  useEffect(() => {
    if (isAdmin || !sessionId || source !== "supabase") return;
    sessionResultPercents(sessionId).then(setPerf, () => setPerf(new Map()));
  }, [isAdmin, sessionId, source]);
  const ordered = useMemo(() => {
    if (mode !== "students") return visible;
    const rest = [...visible].sort((a, b) => {
      if (isAdmin) return (Number(b.fee_due) || 0) - (Number(a.fee_due) || 0);
      const pa = perf.get(a.id) ?? null;
      const pb = perf.get(b.id) ?? null;
      if (pa === null || pb === null) return pa === null ? (pb === null ? 0 : 1) : -1;
      return pa - pb;
    });
    const first = recent.map((id) => rest.find((p) => p.id === id)).filter(Boolean);
    return [...first, ...rest.filter((p) => !recent.includes(p.id))];
  }, [visible, mode, isAdmin, perf, recent]);

  // On the Students page the profile follows the filtered grid; elsewhere
  // (Fees, Requests) any student in the session can be opened.
  const profileList = mode === "students" || mode === "employees" ? visible : current;
  const openIndex = profileList.findIndex((p) => p.id === openId);
  // Students open as a full page at /students/<id>: the browser's (or
  // phone's) Back button returns to the list, at the same scroll position.
  const listScroll = useRef(0);
  const closeProfile = useCallback(() => {
    if (window.history.state?.student) window.history.back();
    else {
      setOpenId(null);
      if (window.location.pathname.startsWith("/students/")) window.history.replaceState(null, "", "/");
    }
  }, []);
  const openStudent = useCallback(
    (id, tab = "details") => {
      setOpenTab(tab);
      if (dataMode === "students") {
        rememberOpened(id);
        if (!window.history.state?.student) listScroll.current = window.scrollY;
        const url = `/students/${id}`;
        if (window.history.state?.student) window.history.replaceState({ student: id }, "", url);
        else window.history.pushState({ student: id }, "", url);
      }
      setOpenId(id);
    },
    [dataMode, rememberOpened]
  );
  useEffect(() => {
    const onPop = (e) => setOpenId(e.state?.student ?? null);
    window.addEventListener("popstate", onPop);
    // A link straight to /students/<id> (e.g. after a reload).
    const m = /^\/students\/([0-9a-f-]{36})$/.exec(window.location.pathname);
    if (m) setOpenId(m[1]);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const studentPage = openIndex !== -1 && dataMode === "students";
  // Top of the page when a student opens; back where you were when it closes.
  useLayoutEffect(() => {
    window.scrollTo(0, studentPage ? 0 : listScroll.current);
  }, [studentPage, openId]); // eslint-disable-line react-hooks/exhaustive-deps

  function switchMode(next) {
    // A + action opens its form once; moving between pages clears it.
    setQuick({ kind: "", at: 0 });
    if (next === mode) {
      if (openId !== null) closeProfile();
      return;
    }
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
    const n = `${current.length.toLocaleString("en-IN")} ${isStudents ? "students" : "staff"}`;
    if (!isStudents || isAdmin || isPrincipal) return n;
    const classes = new Set(current.map((p) => `${p.class}|${p.section ?? ""}`)).size;
    return classes ? `${n} in your ${classes} class${classes === 1 ? "" : "es"}` : n;
  })();
  const title = isStudents ? "Students" : "Staff";
  // Header: Students, Inbox, Staff and Transport. Everything about the
  // students (attendance, homework, fees) lives inside Students, behind a
  // switch at the top; each role sees the parts it can use. School settings
  // are in the account menu (owner only).
  const leads = isAdmin || isPrincipal;
  // Teachers: their daily work gets its own tabs (Attendance for class
  // in-charges, Homework). Leads find these inside Students instead.
  const sections = [
    ["students", "Students"],
    ...(!leads ? [...(seesAttendance ? [["attendance", "Attendance"]] : []), ["homework", "Homework"]] : []),
    ["requests", "Inbox", mode === "requests" ? 0 : inboxCount],
    ...(leads ? [["employees", "Staff", isOwner ? pendingCount : 0]] : []),
    ...(isAdmin ? [["transport", "Transport"]] : []),
  ];
  const STUDENT_PARTS = ["students", "attendance", "homework", "fees", "marks"];
  const studentParts = leads
    ? [
        ["students", "Students"],
        ["attendance", "Attendance"],
        ["homework", "Homework"],
        ...(isAdmin ? [["fees", "Fees"]] : []),
      ]
    : [["students", "Students"]];
  const studentsSwitch = (
    <nav className="segmented segmented-sm students-switch page-switch" aria-label="Students">
      {studentParts.map(([v, l]) => (
        <button key={v} className={mode === v ? "active" : ""} onClick={() => switchMode(v)}>
          {l}
        </button>
      ))}
    </nav>
  );
  // The + in the middle of the phone tab bar: everything this person can
  // create, wherever they are. Pages open their form when `quick` changes.
  const [quick, setQuick] = useState({ kind: "", at: 0 });
  // The common search: the session's students (kept from the Students
  // load, so it works on every page) and a conversation to open in Inbox.
  const [searchStudents, setSearchStudents] = useState([]);
  useEffect(() => {
    if (dataMode === "students" && !loading) setSearchStudents(current);
  }, [dataMode, loading, current]);
  const [openThread, setOpenThread] = useState({ id: null, at: 0 });
  const globalSearch = (
    <GlobalSearch
      school={school}
      students={searchStudents}
      seesStaff={leads}
      onStudent={(id) => {
        switchMode("students");
        openStudent(id);
      }}
      onStaff={(id) => {
        switchMode("employees");
        setStaffTab("people");
        setOpenId(id);
      }}
      onThread={(id) => {
        switchMode("requests");
        setOpenThread({ id, at: Date.now() });
      }}
    />
  );
  const plusActions = [
    ...(canEdit ? [["student", "Add student", "users"]] : []),
    ...(isAdmin && !viewOnly ? [["fee", "Collect fee", "rupee"]] : []),
    // Teachers' daily work: their class register (class in-charges), homework
    // and marks. Owners, admins and the principal see these, not give them.
    ...(role === "teacher" && isClassTeacher && !viewOnly ? [["attendance", "Mark attendance", "register"]] : []),
    ...(role === "teacher" ? [["homework", "Give homework", "book"]] : []),
    ...(role === "teacher" && canWrite ? [["result", "Add result", "chart"]] : []),
    ...(!isPrincipal ? [["message", "New message", "message"]] : []),
    ...(isAdmin ? [["staff", "Add staff", "briefcase"]] : []),
  ];
  function runAction(kind) {
    const go = { student: "students", fee: "fees", homework: "homework", message: "requests", staff: "employees", attendance: "attendance", result: "marks" }[kind];
    switchMode(go);
    if (kind === "student" || kind === "staff") {
      if (kind === "staff") setStaffTab("people");
      setAdding(true);
    } else {
      setQuick({ kind, at: Date.now() });
    }
  }
  const staffTabs = isOwner && (
    <nav className="segmented segmented-sm page-switch" aria-label="Staff">
      {[
        ["people", "People"],
        ["access", "App access", pendingCount],
      ].map(([v, l, n]) => (
        <button key={v} className={staffTab === v ? "active" : ""} onClick={() => setStaffTab(v)}>
          {l}
          {n > 0 && <span className="seg-count">{n}</span>}
        </button>
      ))}
    </nav>
  );

  return (
    <div className={`app${plusActions.length ? " has-plus" : ""}`} data-clarity-mask="True">
      <TopBar
        mode={leads && STUDENT_PARTS.includes(mode) ? "students" : mode === "marks" ? "students" : mode}
        onMode={switchMode}
        sections={sections}
        onSettings={isOwner ? () => openOwner("profile") : null}
        session={sessions.length > 0 && <SessionSelect sessions={sessions} value={sessionId} current={currentSession} onChange={switchSession} />}
        actions={plusActions}
        search={globalSearch}
        onAction={runAction}
      />
      {/* Quietly shrinks full-size ERP photos in the background (computers, owners/admins). */}
      {!loading && isAdmin && dataMode === "students" && <PhotoUpgrade schoolId={school.id} students={people} onPhoto={patch} />}
      <InstallPrompt />

      <main className="page">
        {studentPage ? (
          <ProfileModal
            asPage
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
        ) : mode === "employees" && isOwner && staffTab === "access" ? (
          <>
            <div className="page-header">
              <div className="page-meta">
                <h1 className="sr-only">Staff</h1>
                {staffTabs}
              </div>
            </div>
            <TeamPage view="access" school={school} session={currentSession} me={user.email} onCount={setPendingCount} />
          </>
        ) : mode === "team" ? (
          <TeamPage
            view="school"
            school={school}
            session={currentSession}
            me={user.email}
            onSchoolSaved={setSchool}
          />
        ) : mode === "fees" ? (
          <FeesPage
            heading={studentsSwitch}
            collectAt={quick.kind === "fee" ? quick.at : 0}
            school={school}
            role={role}
            grades={schoolGrades}
            onGradesChanged={loadGrades}
            session={selectedSession}
            pastSession={Boolean(currentSession) && sessionId !== currentSession.id}
            students={current}
            onOpenStudent={openStudent}
            onChanged={reload}
          />
        ) : mode === "marks" && canWrite ? (
          <MarksPage school={school} session={currentSession} students={current} onClose={() => switchMode("students")} />
        ) : mode === "transport" && isAdmin ? (
          <>
            <h1 className="sr-only">Transport</h1>
            {/* The map on top: a short preview that opens to full size. */}
            {view === "map" && (
              <div className="tr-map-bar">
                <button className="btn btn-secondary btn-sm" onClick={() => setView("routes")}>
                  <Icon name="chevronDown" /> Collapse map
                </button>
              </div>
            )}
            <Suspense fallback={<div className="card card-skeleton tr-map-skeleton" />}>
              <StudentMap
                school={school}
                students={current}
                allStudents={current}
                canEdit={canEdit}
                onOpenStudent={(id) => openStudent(id)}
                compact={view !== "map"}
                onExpand={() => setView("map")}
              />
            </Suspense>
            {view !== "map" && <TransportRoutes school={school} routes={routes} students={current} onChanged={loadRoutes} />}
          </>
        ) : mode === "attendance" && seesAttendance ? (
          <AttendancePage school={school} session={currentSession} students={current} isAdmin={leads} readOnly={isPrincipal} me={user.email} heading={leads ? studentsSwitch : null} />
        ) : mode === "homework" ? (
          <HomeworkPage school={school} session={currentSession} students={current} me={user.email} isAdmin={isAdmin} readOnly={leads} heading={leads ? studentsSwitch : null} giveAt={quick.kind === "homework" ? quick.at : 0} />
        ) : mode === "requests" ? (
          <InboxPage
            newAt={quick.kind === "message" ? quick.at : 0}
            openThread={openThread}
            readOnly={isPrincipal}
            school={school}
            students={current}
            me={user.email}
            onOpenStudent={(id) => openStudent(id)}
            onCount={setInboxCount}
          />
        ) : (
        <>
        <h1 className="sr-only">{title}</h1>
        {!loading && source === "error" && (
          <p className="notice notice-error">
            Couldn’t load {mode}. Check your connection, or ask your school’s administrator for access.
          </p>
        )}

        {!loading && isStudents && !isAdmin && !isPrincipal && current.length === 0 && (
          <p className="notice">
            You haven’t been given any classes for this session yet. Ask the school’s owner to assign your classes.
          </p>
        )}

        {/* Students: search, grades and the actions on one line; the count
            lives in the search box. */}
        {/* One row, pinned under the header while scrolling: the page switch,
            search, filters and actions (Students and Staff alike). */}
        <div className="toolbar toolbar-students toolbar-sticky">
          {isStudents && studentParts.length > 1 && studentsSwitch}
          {!isStudents && staffTabs}
          {isStudents && <GradeFilter options={gradeChoices} value={pickedGrades} onChange={setPickedGrades} />}
          {!loading && (query || pickedGrades.length > 0) && (
            <span className="toolbar-count">
              {visible.length} of {current.length}
            </span>
          )}
          {viewOnly && <span className="badge badge-neutral">Past session · view only</span>}
          {!isStudents && canEdit && (
            <div className="page-actions toolbar-actions">
              <button className="btn btn-primary" onClick={() => setAdding(true)}>
                <Icon name="plus" />
                Add staff
              </button>
            </div>
          )}
          {isStudents && (
            <div className="page-actions toolbar-actions">
              {isAdmin && !loading && <ExportButton school={school} role={role} people={visible} label={`students-${currentLabel}`} />}
              {canEdit && (
                <button className="btn btn-secondary" onClick={() => setImporting(true)} aria-label="Import" title="Import">
                  <Icon name="upload" />
                  <span className="btn-label">Import</span>
                </button>
              )}
              {canEdit && (
                <button className="btn btn-primary" onClick={() => setAdding(true)}>
                  <Icon name="plus" />
                  Add student
                </button>
              )}
              {role === "teacher" && canWrite && (
                <button className="btn btn-primary" onClick={() => switchMode("marks")}>
                  <Icon name="chart" />
                  Add results
                </button>
              )}
            </div>
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
              {pickedGrades.length ? ` in ${gradesText(pickedGrades)}` : ""}.
            </p>
          </div>
        ) : (
          <div className="grid">
            {ordered.map((p, i) => (
              <PersonCard key={p.id} person={p} mode={mode} index={i} showFee={isAdmin} onOpen={() => openStudent(p.id)} />
            ))}
          </div>
        )}
        </>
        )}
      </main>

      {openIndex !== -1 && !studentPage && (
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
