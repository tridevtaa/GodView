import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import InstallPrompt from "./components/InstallPrompt.jsx";
import TopBar from "./components/TopBar.jsx";
import PersonCard from "./components/PersonCard.jsx";
import Grid from "./components/Grid.jsx";
import PhotoUpgrade from "./components/PhotoUpgrade.jsx";
import GradeFilter, { gradeOptions, gradeRank, gradesText } from "./components/GradeFilter.jsx";
import Icon from "./components/Icon.jsx";
import { setGradeLabels } from "./components/PersonCard.jsx";
import SessionSelect from "./components/SessionSelect.jsx";
import ExportButton from "./components/ExportButton.jsx";
import GlobalSearch from "./components/GlobalSearch.jsx";
import QuickActions from "./components/QuickActions.jsx";
import HomePage from "./components/HomePage.jsx";
import ClassAllocationGate from "./components/ClassAllocationGate.jsx";
import NoticeBoard from "./components/NoticeBoard.jsx";
import CalendarPage from "./components/CalendarPage.jsx";
import { attendanceOverview, countPendingRequests, listAssignments, listGrades, listRoutes, loadAttendance, sessionResultPercents, staffInbox } from "./data/api.js";
import StatCards from "./components/StatCards.jsx";
import { rupeesShort } from "./data/money.js";
import { useAuth } from "./components/AuthGate.jsx";
import { usePeople } from "./data/usePeople.js";
import { useSessions } from "./data/useSessions.js";
import { forget, swr } from "./data/cache.js";
import { onNotificationOpen, syncPush } from "./pwa/push.js";
import { onFresh } from "./pwa/fresh.js";
import { useSchoolBranding } from "./pwa/branding.js";
import UpdatePrompt from "./components/UpdatePrompt.jsx";
import { useSwipeTabs } from "./pwa/swipeTabs.js";
import { AiCard, Hint, InsightsButton, hintFor, useInsights } from "./components/AiInsights.jsx";

const SEARCH_KEYS = {
  students: ["name", "parent_name", "mother_name", "admission_no", "class", "section", "parent_phone", "srn", "city"],
  employees: ["name", "designation", "department", "employee_no"],
};


// Each screen's code loads when it's first needed, and is fetched in the
// background once the app is up, so switching tabs never waits for it.
const SCREENS = {
  HomeworkPage: () => import("./components/HomeworkPage.jsx"),
  AddModal: () => import("./components/AddModal.jsx"),
  ProfileModal: () => import("./components/ProfileModal.jsx"),
  ImportModal: () => import("./components/ImportModal.jsx"),
  TeamPage: () => import("./components/TeamPage.jsx"),
  TransportRoutes: () => import("./components/TransportRoutes.jsx"),
  FeesPage: () => import("./components/FeesPage.jsx"),
  InboxPage: () => import("./components/InboxPage.jsx"),
  MarksPage: () => import("./components/MarksPage.jsx"),
  CollectFee: () => import("./components/CollectFee.jsx"),
};
const HomeworkPage = lazy(SCREENS.HomeworkPage);
const AddModal = lazy(SCREENS.AddModal);
const ProfileModal = lazy(SCREENS.ProfileModal);
const ImportModal = lazy(SCREENS.ImportModal);
const TeamPage = lazy(SCREENS.TeamPage);
const TransportRoutes = lazy(SCREENS.TransportRoutes);
const FeesPage = lazy(SCREENS.FeesPage);
const InboxPage = lazy(SCREENS.InboxPage);
const MarksPage = lazy(SCREENS.MarksPage);
const CollectFee = lazy(SCREENS.CollectFee);
const StudentMap = lazy(() => import("./components/StudentMap.jsx"));
const MyProfile = lazy(() => import("./components/MyProfile.jsx"));
export default function App() {
  // Everyone lands on Home.
  const [mode, setMode] = useState("home");
  const [query, setQuery] = useState("");
  // Transport: the map starts as a small preview ("routes"); "map" opens it.
  const [view, setView] = useState("routes");
  // Full-screen map: Escape closes it, and the page behind doesn't scroll.
  useEffect(() => {
    if (view !== "map") return;
    const onKey = (e) => e.key === "Escape" && setView("routes");
    window.addEventListener("keydown", onKey);
    document.documentElement.classList.add("map-open");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("map-open");
    };
  }, [view]);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [openTab, setOpenTab] = useState("details");
  const [pickedGrades, setPickedGrades] = useState([]); // picked grades; none means all
  const [importing, setImporting] = useState(false);
  const [pickedSession, setPickedSession] = useState(null);
  const { school, role, user, setSchool } = useAuth();
  // The browser tab shows the school (logo and name), not Godview.
  // An owner's app also makes the school's home screen icon (pwa/branding.js).
  useSchoolBranding(school, { owner: role === "owner" });
  const isOwner = role === "owner";
  const isAdmin = role === "owner" || role === "admin";
  // Principal: sees students, attendance, homework, requests and employees
  // across the school, and changes nothing (no imports, exports or edits).
  const isPrincipal = role === "principal";
  // Owners, admins and the principal: they see the whole school.
  const leads = isAdmin || isPrincipal;
  const [pendingCount, setPendingCount] = useState(0);
  // Inbox badge: conversations with unread parent messages or open requests.
  const [inboxCount, setInboxCount] = useState(0);
  // Badges refresh on opening, every minute, and when the app comes back to
  // the screen; not on every tab switch. (Inbox and Staff update them too.)
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      if (isOwner) countPendingRequests(school.id).then(setPendingCount, () => {});
      staffInbox(school.id).then(
        (rows) => setInboxCount(rows.filter((t) => Number(t.unread) > 0 || Number(t.open_requests) > 0).length),
        () => {}
      );
    };
    refresh();
    const t = setInterval(refresh, 60000);
    const stop = onFresh(refresh); // back on screen, or a notification came in
    return () => {
      clearInterval(t);
      stop();
    };
  }, [isOwner, school.id]);
  const { sessions, current: currentSession } = useSessions(school.id);

  // Warm the other screens' code in the background.
  useEffect(() => {
    const warm = () => Object.values(SCREENS).forEach((load) => load().catch(() => {}));
    const id = "requestIdleCallback" in window ? requestIdleCallback(warm, { timeout: 2500 }) : setTimeout(warm, 1500);
    return () => ("cancelIdleCallback" in window ? cancelIdleCallback(id) : clearTimeout(id));
  }, []);

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
  // `myAssignments` is null until loaded, so a teacher never flashes the
  // class-picker before we actually know whether they have any.
  const [myAssignments, setMyAssignments] = useState(null);
  useEffect(() => {
    if (role !== "teacher" || !currentSession) return;
    listAssignments(school.id).then(
      (rows) => setMyAssignments(rows.filter((a) => a.email === user.email && a.session_id === currentSession.id)),
      () => setMyAssignments([])
    );
  }, [role, school.id, currentSession, user.email]);
  const isClassTeacher = (myAssignments ?? []).some((a) => a.is_class_teacher);
  const seesAttendance = role !== "teacher" || isClassTeacher;
  // A teacher with no classes this session picks them first, before anything else.
  const needsClasses = role === "teacher" && Boolean(currentSession) && myAssignments !== null && myAssignments.length === 0;

  // The school's grade list (names and sections); grade names everywhere use it.
  const [schoolGrades, setSchoolGrades] = useState([]);
  const loadGrades = useCallback(() => {
    swr(
      `grades:${school.id}`,
      () => listGrades(school.id),
      (rows) => {
        setGradeLabels(rows);
        setSchoolGrades(rows);
      },
      { persist: true }
    ).catch(() => {});
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
    () => swr(`routes:${school.id}`, () => listRoutes(school.id), setRoutes, { persist: true }).catch(() => {}),
    [school.id]
  );
  useEffect(() => {
    loadRoutes();
  }, [loadRoutes]);
  const sessionId = pickedSession ?? currentSession?.id;
  // Fees, Requests and Team work on the session's students.
  const dataMode = mode === "employees" ? "employees" : "students";
  const { people, loading, source, add, patch, drop, reload } = usePeople(dataMode, school.id, sessionId);

  // Past sessions are history: shown, not edited.
  const viewOnly = mode !== "employees" && Boolean(currentSession) && sessionId !== currentSession.id;
  // Records: owners/admins. Photos, notes, results: anyone who can see the student.
  const canEdit = source === "supabase" && !viewOnly && isAdmin;
  const canWrite = source === "supabase" && !viewOnly && !isPrincipal;
  // AI insights (Premium): Transport on its page, Results on Students
  const insT = useInsights(school, "transport", isAdmin && mode === "transport");
  const insR = useInsights(school, "results", (isAdmin || isPrincipal) && !viewOnly && source === "supabase" && mode === "students");
  const aiNote = (ins, slot) => (hintFor(ins, slot) ? <Hint ins={ins} slot={slot} /> : undefined);

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
  // A classmate opened from a profile may be outside the filtered grid.
  const profileList = (mode === "students" || mode === "employees") && (!openId || visible.some((p) => p.id === openId)) ? visible : current;
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
    if (m) {
      // On Students, so that tab is lit and Back goes to the list.
      setMode("students");
      setOpenId(m[1]);
      // History as if opened from the list: the list underneath, the
      // student on top. Otherwise Back (or closing the chat) lands on an
      // entry that isn't the student and closes the page.
      if (!window.history.state?.student) {
        const url = window.location.pathname + window.location.search;
        window.history.replaceState(null, "", "/");
        window.history.pushState({ student: m[1] }, "", url);
      }
    }
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
    const inactive = isStudents ? current.filter((p) => p.status === "inactive").length : 0;
    const n = `${current.length.toLocaleString("en-IN")} ${isStudents ? "students" : "staff"}${inactive ? ` · ${inactive.toLocaleString("en-IN")} inactive` : ""}`;
    if (!isStudents || isAdmin || isPrincipal) return n;
    const classes = new Set(current.map((p) => `${p.class}|${p.section ?? ""}`)).size;
    return classes ? `${n} in your ${classes} class${classes === 1 ? "" : "es"}` : n;
  })();
  const title = isStudents ? "Students" : "Staff";

  // Today's attendance for the overview cards: the whole school for leads
  // (the same remembered numbers as the Attendance page), a teacher's own
  // students otherwise.
  const todayIso = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const [today, setToday] = useState(null); // { present, absent, marked }
  useEffect(() => {
    if ((mode !== "students" && mode !== "home") || !currentSession || viewOnly) return;
    if (leads) {
      swr(`att-overview:${currentSession.id}:${todayIso}`, () => attendanceOverview(currentSession.id, todayIso), (rows) =>
        setToday({
          present: rows.reduce((t, r) => t + Number(r.present) + Number(r.late), 0),
          absent: rows.reduce((t, r) => t + Number(r.absent), 0),
          leave: rows.reduce((t, r) => t + Number(r.on_leave), 0),
          marked: rows.reduce((t, r) => t + Number(r.students) - Number(r.unmarked), 0),
          notMarked: rows.filter((r) => Number(r.unmarked) === Number(r.students)).length,
          classes: rows.length,
        })
      ).catch(() => {});
    } else {
      swr(`att-day:${currentSession.id}:${todayIso}`, () => loadAttendance(currentSession.id, todayIso), (rows) => {
        const mine = new Set(current.map((p) => p.id));
        const own = rows.filter((r) => mine.has(r.student_id));
        setToday({
          present: own.filter((r) => r.status === "present" || r.status === "late").length,
          absent: own.filter((r) => r.status === "absent").length,
          leave: own.filter((r) => r.status === "leave").length,
          marked: own.length,
        });
      }).catch(() => {});
    }
  }, [mode, currentSession, viewOnly, leads, todayIso, current]);

  // Tiles at the top of Students and Staff: one number and a word each.
  const overview = (() => {
    if (loading) return null;
    if (isStudents) {
      const owing = current.filter((p) => Number(p.fee_due) > 0);
      const due = owing.reduce((t, p) => t + Number(p.fee_due), 0);
      const paid = current.reduce((t, p) => t + (Number(p.fee_paid) || 0), 0);
      const billed = current.reduce((t, p) => t + (Number(p.fee_billed) || 0), 0);
      const overdue = current.filter((p) => p.fee_status === "overdue").length;
      const pct = today?.marked ? Math.round((today.present / today.marked) * 100) : null;
      return [
        {
          icon: "scholar",
          color: "indigo",
          label: leads ? "Students" : "My students",
          value: current.length,
          note: (() => {
            const inactive = current.filter((p) => p.status === "inactive").length;
            return inactive ? `${inactive.toLocaleString("en-IN")} inactive` : null;
          })(),
        },
        isAdmin && {
          icon: "rupee",
          label: "Due now",
          value: due,
          format: rupeesShort,
          tone: due > 0 ? "due" : "paid",
          bar: billed ? { value: paid, max: billed, label: `${Math.round((paid / billed) * 100)}% of the year collected` } : undefined,
          badge: overdue,
          badgeLabel: `${overdue.toLocaleString("en-IN")} students overdue`,
          onClick: () => switchMode("fees"),
        },
        {
          icon: "register",
          label: "Present today",
          value: today === null ? undefined : today.marked ? today.present : "–",
          tone: pct === null ? undefined : pct >= 90 ? "paid" : pct >= 75 ? "due" : "overdue",
          color: pct === null ? "teal" : undefined,
          ring: pct ?? undefined,
          badge: today?.notMarked ?? 0,
          badgeLabel: `${today?.notMarked ?? 0} classes not marked`,
          onClick: seesAttendance ? () => (switchMode("calendar"), setQuick({ kind: "attendance", at: Date.now() })) : undefined,
        },
      ];
    }
    const teaching = current.filter((p) => /teach|prt|tgt|pgt|lecturer|faculty/i.test(`${p.designation ?? ""} ${p.department ?? ""}`)).length;
    return [
      { icon: "users", color: "pink", label: "Staff", value: current.length },
      { icon: "teacher", color: "violet", label: "Teaching", value: teaching, bar: current.length ? { value: teaching, max: current.length, label: "Teaching share" } : undefined },
      isOwner && {
        icon: "idcard",
        color: pendingCount ? "amber" : "teal",
        label: "Waiting",
        value: pendingCount,
        badge: pendingCount,
        badgeLabel: `${pendingCount} waiting for access`,
        onClick: () => setStaffTab("access"),
      },
    ];
  })();
  // Header: Students, Inbox, Staff and Transport. Everything about the
  // students (homework, fees) lives inside Students, behind a switch at the
  // top; each role sees the parts it can use. School settings are in the
  // account menu (owner only). Attendance and the exam datesheet live in
  // the Calendar instead, since they're both dated, day-by-day information.
  // Teachers: their daily work gets its own tab (Homework). Leads find it
  // inside Students instead.
  const sections = [
    ["home", "Home"],
    ["students", "Students"],
    ...(!leads ? [["homework", "Homework"]] : []),
    ["requests", "Inbox", mode === "requests" ? 0 : inboxCount],
    ...(leads ? [["employees", "Staff", isOwner ? pendingCount : 0]] : []),
    ...(isAdmin ? [["transport", "Transport"]] : []),
  ];
  const STUDENT_PARTS = ["students", "homework", "fees", "marks"];
  // The bottom tab that's lit: pages inside a tab light that tab.
  const litMode = leads && STUDENT_PARTS.includes(mode) ? "students" : mode === "marks" ? "students" : mode === "notices" || mode === "calendar" ? "home" : mode;
  // Phones: swipe sideways to the next or previous tab (not on a profile).
  useSwipeTabs(
    sections.map(([key]) => key),
    litMode,
    switchMode,
    !studentPage
  );
  const studentParts = leads
    ? [
        ["students", "Students"],
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
  const [noticeCompose, setNoticeCompose] = useState(false);
  const [calAdding, setCalAdding] = useState(false);
  // Collect fee pop-up, over whatever page is open: {} to pick a student,
  // { student } when one was tapped. feesAt nudges the Fees page to refresh.
  const [collect, setCollect] = useState(null);
  const [feesAt, setFeesAt] = useState(0);
  // The common search: the session's students (kept from the Students
  // load, so it works on every page) and a conversation to open in Inbox.
  const [searchStudents, setSearchStudents] = useState([]);
  useEffect(() => {
    if (dataMode === "students" && !loading) setSearchStudents(current);
  }, [dataMode, loading, current]);
  const [openThread, setOpenThread] = useState({ id: null, at: 0 });
  // Notifications: keep this device's subscription current, and open what
  // a tapped notification is about (a conversation, the noticeboard, or a
  // page for the everyday ones).
  const showTarget = useRef(null);
  showTarget.current = ({ thread, notice, go }) => {
    if (notice) return switchMode("notices");
    if (go === "access") {
      switchMode("employees");
      return setStaffTab("access");
    }
    if (go) return switchMode(go);
    switchMode("requests");
    setOpenThread({ id: thread, at: Date.now() });
  };
  useEffect(() => {
    syncPush().catch(() => {});
    return onNotificationOpen((to) => showTarget.current(to));
  }, []);
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
    ...(canEdit ? [["student", "Add student", "scholar"]] : []),
    ...(isAdmin && !viewOnly ? [["fee", "Collect fee", "rupee"]] : []),
    // Teachers' daily work: their class register (class in-charges), homework
    // and marks. Owners, admins and the principal see these, not give them.
    ...(role === "teacher" && isClassTeacher && !viewOnly ? [["attendance", "Mark attendance", "register"]] : []),
    ...(role === "teacher" ? [["homework", "Give homework", "book"]] : []),
    ...(role === "teacher" && canWrite ? [["result", "Add result", "chart"]] : []),
    // Exams: teachers for their classes, the office for any class
    ...(role === "teacher" || (isAdmin && !viewOnly) ? [["datesheet", "Add exam", "exam"]] : []),
    ["notice", "Post notice", "notice"],
    ...(isAdmin ? [["event", "Add to calendar", "calendar"]] : []),
  ];
  function runAction(kind) {
    if (kind === "fee") {
      setCollect({});
      return;
    }
    if (kind === "event") {
      switchMode("calendar");
      setCalAdding(true);
      return;
    }
    if (kind === "notice") {
      switchMode("notices");
      setNoticeCompose(true);
      return;
    }
    const go = { student: "students", fee: "fees", homework: "homework", datesheet: "calendar", staff: "employees", attendance: "calendar", result: "marks" }[kind];
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

  if (needsClasses) {
    return <ClassAllocationGate school={school} session={currentSession} />;
  }

  return (
    <div className={`app${plusActions.length ? " has-plus" : ""}`} data-clarity-mask="True">
      <TopBar
        // The noticeboard is reached from Home, so Home stays lit there.
        mode={litMode}
        onMode={switchMode}
        sections={sections}
        onSettings={isOwner ? () => openOwner("profile") : null}
        onProfile={() => switchMode("me")}
        session={sessions.length > 0 && <SessionSelect sessions={sessions} value={sessionId} current={currentSession} onChange={switchSession} />}
        search={globalSearch}
      />
      {/* Quietly shrinks full-size ERP photos in the background (computers, owners/admins). */}
      {!loading && isAdmin && dataMode === "students" && <PhotoUpgrade schoolId={school.id} students={people} onPhoto={patch} />}
      <InstallPrompt />
      <UpdatePrompt />

      <main className="page">
        <Suspense fallback={<div className="grid" aria-busy="true"><div className="card card-skeleton" /><div className="card card-skeleton" /><div className="card card-skeleton" /></div>}>
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
            isOwner={isOwner}
            onDeleted={(id) => {
              closeProfile();
              drop(id);
              forget("people:");
            }}
            onFeesChanged={reload}
            onClose={closeProfile}
            grades={schoolGrades}
            students={dataMode === "students" ? current : []}
            onOpenStudent={dataMode === "students" ? (id) => openStudent(id) : undefined}
            routes={routes}
          />
        ) : mode === "me" ? (
          <MyProfile school={school} session={currentSession} email={user.email} googleName={user.displayName} onBack={() => switchMode("home")} />
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
        ) : mode === "home" ? (
          <HomePage
            school={school}
            me={user.email}
            name={user.displayName}
            role={role}
            students={current}
            loading={loading}
            session={currentSession}
            today={today}
            pendingCount={pendingCount}
            routes={routes}
            actions={plusActions}
            onAction={runAction}
            onGo={(go) => {
              if (go === "access") {
                switchMode("employees");
                setStaffTab("access");
              } else if (go === "attendance") {
                switchMode("calendar");
                setQuick({ kind: "attendance", at: Date.now() });
              } else switchMode(go);
            }}
          />
        ) : mode === "calendar" ? (
          <>
            <div className="page-header">
              <div className="page-meta">
                <button className="back-btn" onClick={() => switchMode("home")} aria-label="Back to Home" title="Back">
                  <Icon name="chevronLeft" size={22} />
                </button>
                <h1 className="nb-page-title">
                  <Icon name="calendar" /> Calendar
                </h1>
              </div>
            </div>
            <CalendarPage
              schoolId={school.id}
              canEdit={isAdmin}
              staff
              adding={calAdding}
              onAdding={setCalAdding}
              onOpenNotices={() => switchMode("notices")}
              session={currentSession}
              students={current}
              me={user.email}
              dsIsAdmin={isAdmin}
              dsReadOnly={isPrincipal || viewOnly}
              dsCreateAt={quick.kind === "datesheet" ? quick.at : 0}
              seesAttendance={seesAttendance}
              attIsAdmin={leads}
              attReadOnly={isPrincipal}
              attOpenAt={quick.kind === "attendance" ? quick.at : 0}
              onOpenStudent={(id) => openStudent(id)}
            />
          </>
        ) : mode === "notices" ? (
          <>
            <div className="page-header nb-header">
              <div className="page-meta">
                <button className="back-btn" onClick={() => switchMode("home")} aria-label="Back to Home" title="Back">
                  <Icon name="chevronLeft" size={22} />
                </button>
                <h1 className="nb-page-title">
                  <Icon name="notice" /> Noticeboard
                </h1>
              </div>
              {!viewOnly && (
                <div className="page-actions">
                  <button className="btn btn-primary" onClick={() => setNoticeCompose(true)}>
                    <Icon name="plus" /> Post notice
                  </button>
                </div>
              )}
            </div>
            <NoticeBoard schoolId={school.id} me={user.email} isAdmin={isAdmin} compose={noticeCompose} onCompose={setNoticeCompose} />
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
            onCollect={(student) => setCollect({ student })}
            onOpenStudent={(id) => openStudent(id)}
            refreshAt={feesAt}
            school={school}
            role={role}
            grades={schoolGrades}
            onGradesChanged={loadGrades}
            session={selectedSession}
            pastSession={Boolean(currentSession) && sessionId !== currentSession.id}
            students={current}
            onChanged={reload}
          />
        ) : mode === "marks" && canWrite ? (
          <MarksPage school={school} session={currentSession} students={current} onClose={() => switchMode("students")} />
        ) : mode === "transport" && isAdmin ? (
          <>
            <h1 className="sr-only">Transport</h1>
            {school.plan !== "premium" && (
              <div className="ai-row">
                <InsightsButton section="transport" label="Transport insights" />
              </div>
            )}
            {(() => {
              const onBus = current.filter((s) => s.uses_bus).length;
              const pinned = current.filter((s) => s.home_lat != null).length;
              return (
                <StatCards
                  items={[
                    { icon: "bus", color: "orange", label: "Routes", value: routes.length, note: aiNote(insT, "routes") },
                    {
                      icon: "scholar",
                      color: "indigo",
                      label: "On the bus",
                      value: onBus,
                      bar: current.length ? { value: onBus, max: current.length, label: "Students on the bus" } : undefined,
                      note: aiNote(insT, "on_bus"),
                    },
                    {
                      icon: "pin",
                      color: "teal",
                      label: "Homes pinned",
                      value: pinned,
                      bar: current.length ? { value: pinned, max: current.length, label: "Homes pinned" } : undefined,
                      onClick: () => setView("map"),
                      note: aiNote(insT, "homes"),
                    },
                  ]}
                />
              );
            })()}
            {insT.on && (
              <AiCard
                ins={insT}
                opens={["routes", "buses", "map"]}
                onOpen={(kind) => {
                  if (kind === "map") setView("map");
                  else document.querySelector(kind === "buses" ? ".bus-section" : ".tr-add")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              />
            )}
            {/* The map on top: a short preview that opens to full size. */}
            {/* The map card; tapping it opens the map full screen on top. */}
            <Suspense fallback={<div className="card card-skeleton tr-map-skeleton" />}>
              <StudentMap school={school} students={current} allStudents={current} canEdit={canEdit} onOpenStudent={(id) => openStudent(id)} compact onExpand={() => setView("map")} />
            </Suspense>
            <TransportRoutes school={school} routes={routes} students={current} ins={insT} onChanged={loadRoutes} onStudentsChanged={(ids, fields) => ids.forEach((id) => patch(id, fields))} />
            {view === "map" && (
              <div className="map-full" role="dialog" aria-modal="true" aria-label="Map">
                <button className="map-full-close" onClick={() => setView("routes")} aria-label="Close map" title="Close">
                  <Icon name="x" size={20} />
                </button>
                <Suspense fallback={<p className="row-sub">Loading the map…</p>}>
                  <StudentMap
                    school={school}
                    students={current}
                    allStudents={current}
                    canEdit={canEdit}
                    onOpenStudent={(id) => (setView("routes"), openStudent(id))}
                  />
                </Suspense>
              </div>
            )}
          </>
        ) : mode === "homework" ? (
          <HomeworkPage school={school} session={currentSession} students={current} me={user.email} isAdmin={isAdmin} readOnly={leads} heading={leads ? studentsSwitch : null} giveAt={quick.kind === "homework" ? quick.at : 0} />
        ) : mode === "requests" ? (
          <InboxPage
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
              {mode === "students" && (isAdmin || isPrincipal) && !viewOnly && source === "supabase" && school.plan !== "premium" && (
                <InsightsButton section="results" label="Results insights" />
              )}
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

        {overview && !viewOnly && <StatCards items={overview} />}

        {insR.on && !query && pickedGrades.length === 0 && (
          <>
            <AiCard
              ins={insR}
              max={2}
              opens={canWrite ? ["marks"] : []}
              onOpen={(kind) => kind === "marks" && switchMode("marks")}
              onPerson={(id) => openStudent(id)}
            />
            <Hint ins={insR} slot="students" className="ai-hint-block" />
          </>
        )}

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
          <Grid
            items={ordered}
            resetKey={`${mode}|${query}|${pickedGrades.join(",")}`}
            render={(p, i) => <PersonCard key={p.id} person={p} mode={mode} index={i} showFee={isAdmin} onOpen={() => openStudent(p.id)} />}
          />
        )}
        </>
        )}
        </Suspense>
      </main>

      {/* Phones: the + at the right end of the search row. */}
      <QuickActions actions={plusActions} onAction={runAction} resetKey={`${mode}|${openId}`} />

      <Suspense fallback={null}>
        {collect && isAdmin && (
          <CollectFee
            school={school}
            students={dataMode === "students" ? current : searchStudents}
            student={collect.student}
            onClose={() => setCollect(null)}
            onPaid={() => {
              forget("fees:");
              setFeesAt(Date.now());
              reload();
            }}
          />
        )}
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
          isOwner={isOwner}
          onDeleted={(id) => {
            closeProfile();
            drop(id);
            forget("people:");
          }}
          onFeesChanged={reload}
          onClose={closeProfile}
          grades={schoolGrades}
          students={dataMode === "students" ? current : []}
          onOpenStudent={dataMode === "students" ? (id) => openStudent(id) : undefined}
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
      </Suspense>
    </div>
  );
}
