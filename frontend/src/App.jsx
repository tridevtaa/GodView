import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import InstallPrompt from "./components/InstallPrompt.jsx";
import TopBar from "./components/TopBar.jsx";
import PersonCard from "./components/PersonCard.jsx";
import Grid from "./components/Grid.jsx";
import PhotoUpgrade from "./components/PhotoUpgrade.jsx";
import { gradeOptions, gradeRank, gradesText } from "./components/GradeFilter.jsx";
import FilterSheet, { SortArrow } from "./components/FilterSheet.jsx";
import Icon from "./components/Icon.jsx";
import { gradeLabel, setGradeLabels } from "./components/PersonCard.jsx";
import SessionSelect from "./components/SessionSelect.jsx";
import ExportButton from "./components/ExportButton.jsx";
import GlobalSearch from "./components/GlobalSearch.jsx";
import QuickActions from "./components/QuickActions.jsx";
import { useWide } from "./components/HomeTrend.jsx";
import HomePage from "./components/HomePage.jsx";
import ClassAllocationGate from "./components/ClassAllocationGate.jsx";
import NoticeBoard from "./components/NoticeBoard.jsx";
import CalendarPage from "./components/CalendarPage.jsx";
import { attendanceOverview, countPendingRequests, listAssignments, listGrades, listRoutes, loadAttendance, sessionResultPercents, staffInbox } from "./data/api.js";
import StatCards from "./components/StatCards.jsx";
import { useAuth } from "./components/AuthGate.jsx";
import { usePeople } from "./data/usePeople.js";
import { useSessions } from "./data/useSessions.js";
import { forget, swr } from "./data/cache.js";
import { onNotificationOpen, syncPush } from "./pwa/push.js";
import { onFresh } from "./pwa/fresh.js";
import { useSchoolBranding } from "./pwa/branding.js";
import UpdatePrompt from "./components/UpdatePrompt.jsx";
import { useSwipeTabs } from "./pwa/swipeTabs.js";
import { useGoddessSwipe } from "./pwa/goddessSwipe.js";
import { SCREEN_AT, SECTION_OF, listScreens } from "./data/screens.js";
import { NEEDS } from "./data/needs.js";
import { CERT_KINDS } from "./data/certKinds.js";
import { AiCard, InsightsButton, useInsights } from "./components/AiInsights.jsx";
import { primeVoice } from "./components/voicePlayer.js";

const SEARCH_KEYS = {
  students: ["name", "parent_name", "mother_name", "admission_no", "class", "section", "parent_phone", "srn", "city"],
  employees: ["name", "designation", "department", "employee_no"],
};


// Each screen's code loads when it's first needed, and is fetched in the
// background once the app is up, so switching tabs never waits for it.
const SCREENS = {
  HomeworkPage: () => import("./components/HomeworkPage.jsx"),
  AdmissionsPage: () => import("./components/AdmissionsPage.jsx"),
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
const AdmissionsPage = lazy(SCREENS.AdmissionsPage);
const CertificatesRegister = lazy(() => import("./components/CertificatesTab.jsx").then((m) => ({ default: m.CertificatesRegister })));
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
const OrgChart = lazy(() => import("./components/OrgChart.jsx"));
const loadConcierge = () => import("./components/Concierge.jsx");
const Concierge = lazy(loadConcierge);
// Today's attendance added up, from the per-class overview
const attendanceTotals = (rows) => ({
  present: rows.reduce((t, r) => t + Number(r.present) + Number(r.late), 0),
  absent: rows.reduce((t, r) => t + Number(r.absent), 0),
  leave: rows.reduce((t, r) => t + Number(r.on_leave), 0),
  marked: rows.reduce((t, r) => t + Number(r.students) - Number(r.unmarked), 0),
  notMarked: rows.filter((r) => Number(r.unmarked) === Number(r.students)).length,
  classes: rows.length,
});

export default function App() {
  // Everyone lands on Home.
  const [mode, setMode] = useState("home");
  // Each page's tab, kept here so anything can open a screen directly.
  const [academicsView, setAcademicsView] = useState("homework");
  const [feesView, setFeesView] = useState("overview");
  const [plannerView, setPlannerView] = useState("calendar");
  const [inboxView, setInboxView] = useState("all");
  const [admissionsView, setAdmissionsView] = useState("enquiry");
  const [certKind, setCertKind] = useState(""); // certificates listed: "" for all
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
  // The assistant, full screen at /avatar.
  const [asking, setAsking] = useState(false);
  // Goddess being pulled down over Home on a phone, and came that way
  const [askPeek, setAskPeek] = useState(false);
  const [askPulled, setAskPulled] = useState(false);
  const [pickedGrades, setPickedGrades] = useState([]); // picked grades; none means all
  // Show only students with something missing (data/needs.js), or none
  const [needPick, setNeedPick] = useState(null);
  const [statusPick, setStatusPick] = useState("active"); // active | inactive
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
  // Owners and admins on a phone: Excel uploads and exports, reports and the
  // fee structure stay on computers. Parents and teachers keep everything.
  const wideScreen = useWide();
  const computerOnly = isAdmin && !wideScreen;
  // The assistant is Premium, for the people who see the whole school.
  const canAsk = leads && school.plan === "premium";
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
  const { sessions, current: currentSession, reload: reloadSessions } = useSessions(school.id);

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
  // Staff > People as cards or as the org chart, kept on this device.
  const [staffView, setStaffView] = useState(() => {
    try {
      return localStorage.getItem("godview.staffView") === "chart" ? "chart" : "list";
    } catch {
      return "list";
    }
  });
  const chooseStaffView = (v) => {
    setStaffView(v);
    try {
      localStorage.setItem("godview.staffView", v);
    } catch {
      /* private mode: fine */
    }
  };
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
  const { people, loading, source, add, patch, drop, reload, revalidate } = usePeople(dataMode, school.id, sessionId);

  // Past sessions are history: shown, not edited.
  const viewOnly = mode !== "employees" && Boolean(currentSession) && sessionId !== currentSession.id;
  // Records: owners/admins. Photos, notes, results: anyone who can see the student.
  const canEdit = source === "supabase" && !viewOnly && isAdmin;
  const canWrite = source === "supabase" && !viewOnly && !isPrincipal;
  // AI insights (Premium): Transport on its page, Results on Students
  const insT = useInsights(school, "transport", isAdmin && mode === "transport");
  const insS = useInsights(school, "staff", isAdmin && !viewOnly && source === "supabase" && mode === "employees" && staffTab === "people");
  const insR = useInsights(school, "results", (isAdmin || isPrincipal) && !viewOnly && source === "supabase" && mode === "students");

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
  const inGrade = useMemo(() => {
    let rows = current;
    if (mode === "students" && pickedGrades.length) rows = rows.filter((p) => pickedGrades.includes(p.class));
    if (mode === "students" && NEEDS[needPick]) rows = rows.filter(NEEDS[needPick].test);
    if (mode === "students" && statusPick !== "all") rows = rows.filter((p) => (p.status || "active") === statusPick);
    return rows;
  }, [current, mode, pickedGrades, needPick, statusPick]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return inGrade;
    return inGrade.filter((p) =>
      SEARCH_KEYS[mode].some((k) => String(p[k] ?? "").toLowerCase().includes(q))
    );
  }, [inGrade, query, mode]);

  // Sort picked on the Students page: { by: grade | fee | perf, dir: asc |
  // desc }, kept on this device. Owners and admins start on the biggest dues
  // first; teachers (and the principal) start on the lowest results first.
  const sortKey = `godview.sort.${school.id}.${user.email}`;
  const [sortPick, setSortPick] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(sortKey) || "null");
    } catch {
      return null;
    }
  });
  const chooseSort = (next) => {
    setSortPick(next);
    try {
      localStorage.setItem(sortKey, JSON.stringify(next));
    } catch {
      /* private mode: fine */
    }
  };
  // Fee sorting is for those who see fees
  const sort =
    sortPick && (sortPick.by !== "fee" || isAdmin)
      ? sortPick
      : isAdmin
      ? { by: "fee", dir: "desc" }
      : { by: "perf", dir: "asc" };
  const [perf, setPerf] = useState(new Map());
  const needPerf = sort.by === "perf";
  useEffect(() => {
    if (!needPerf || !sessionId || source !== "supabase") return;
    sessionResultPercents(sessionId).then(setPerf, () => setPerf(new Map()));
  }, [needPerf, sessionId, source]);
  const ordered = useMemo(() => {
    if (mode !== "students") return visible;
    const dir = sort.dir === "desc" ? -1 : 1;
    const byGrade = (a, b) => gradeRank(a.class ?? "") - gradeRank(b.class ?? "") || String(a.section ?? "").localeCompare(String(b.section ?? ""));
    const byName = (a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""));
    return [...visible].sort((a, b) => {
      if (sort.by === "grade") return dir * byGrade(a, b) || byName(a, b);
      if (sort.by === "fee") return dir * ((Number(a.fee_due) || 0) - (Number(b.fee_due) || 0)) || byGrade(a, b) || byName(a, b);
      // Performance: students without marks go last either way
      const pa = perf.get(a.id) ?? null;
      const pb = perf.get(b.id) ?? null;
      if (pa === null || pb === null) return pa === null ? (pb === null ? byGrade(a, b) || byName(a, b) : 1) : -1;
      return dir * (pa - pb) || byGrade(a, b) || byName(a, b);
    });
  }, [visible, mode, perf, sort]);

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
        if (!window.history.state?.student) listScroll.current = window.scrollY;
        const url = `/students/${id}`;
        if (window.history.state?.student) window.history.replaceState({ student: id }, "", url);
        else window.history.pushState({ student: id }, "", url);
      }
      setOpenId(id);
    },
    [dataMode]
  );
  useEffect(() => {
    const onPop = (e) => {
      setOpenId(e.state?.student ?? null);
      setAsking(Boolean(e.state?.avatar));
    };
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
    // A link straight to /avatar: Home underneath, so Back closes it.
    if (window.location.pathname === "/avatar") {
      window.history.replaceState(null, "", "/");
      if (canAsk) {
        window.history.pushState({ avatar: true }, "", "/avatar");
        setAsking(true);
      }
    }
    return () => window.removeEventListener("popstate", onPop);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const studentPage = openIndex !== -1 && dataMode === "students";
  // Top of the page when a student opens; back where you were when it closes.
  useLayoutEffect(() => {
    window.scrollTo(0, studentPage ? 0 : listScroll.current);
  }, [studentPage, openId]); // eslint-disable-line react-hooks/exhaustive-deps
  // A new page opens at its top
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [mode]);

  // Opens a section or any screen in it (data/screens.js).
  function switchMode(next) {
    // Office has no page of its own: its first screen this person has.
    if (next === "office") next = screens.find((s) => s.section === "office")?.key ?? "students";
    const [page, tab] = SCREEN_AT[next] ?? [next];
    // A + action opens its form once; moving between pages clears it.
    setQuick({ kind: "", at: 0 });
    if (next === "people" || next === "org-chart") chooseStaffView(next === "people" ? "list" : "chart");
    const setTab = { homework: setAcademicsView, fees: setFeesView, calendar: setPlannerView, employees: setStaffTab, requests: setInboxView }[page];
    const first = { homework: seesAttendance ? "attendance" : "homework", fees: "overview", calendar: "calendar", employees: "people", requests: "all" }[page];
    if (page === mode) {
      // The lit section again: out of a profile, or back to its first tab
      if (openId !== null) closeProfile();
      if (tab || openId === null) setTab?.(tab ?? first);
      return;
    }
    setMode(page);
    setTab?.(tab ?? first);
    setQuery("");
    setPickedGrades([]);
    setStatusPick("active");
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
    const n = `${(current.length - inactive).toLocaleString("en-IN")} ${isStudents ? (current.length - inactive === 1 ? "student" : "students") : "staff"}${inactive ? ` · ${inactive.toLocaleString("en-IN")} inactive` : ""}`;
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
        setToday({ ...attendanceTotals(rows), rows })
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
          own,
        });
      }).catch(() => {});
    }
  }, [mode, currentSession, viewOnly, leads, todayIso, current]);

  const insHere = isStudents ? insR : insS;
  const filtered = Boolean(query.trim()) || (isStudents && (pickedGrades.length > 0 || needPick || statusPick !== "active"));
  const showInsights = insHere.on && !filtered;
  // Today's attendance for who's showing. The school's numbers are per class,
  // so they narrow by grade but not by a search; a teacher's are per student.
  const todayShown = (() => {
    if (!filtered) return today;
    if (today?.own) {
      const ids = new Set(visible.map((p) => p.id));
      const own = today.own.filter((r) => ids.has(r.student_id));
      return { present: own.filter((r) => r.status === "present" || r.status === "late").length, marked: own.length };
    }
    if (today?.rows && !query.trim() && !needPick && statusPick === "active") return attendanceTotals(today.rows.filter((r) => pickedGrades.includes(r.class)));
    return null;
  })();

  // Tiles at the top of Students and Staff: one number and a word each.
  const overview = (() => {
    // Shown while loading too, so the toolbar under the tiles stays put
    if (isStudents) {
      // One tile: how many students, with who's inactive and today's attendance
      const inactive = visible.filter((p) => p.status === "inactive").length;
      const present = todayShown?.marked ? `${todayShown.present.toLocaleString("en-IN")} present today` : null;
      const who = query.trim() ? "Matching students" : NEEDS[needPick] ? NEEDS[needPick].title : statusPick === "active" ? "Active students" : statusPick === "inactive" ? "Inactive students" : leads ? "Students" : "My students";
      return [
        {
          color: "indigo",
          label: pickedGrades.length && !query.trim() && !needPick ? `${who} in ${gradesText(pickedGrades)}` : who,
          // Active students only, unless the filter asks for inactive ones
          value: loading ? undefined : statusPick === "inactive" ? visible.length : visible.length - inactive,
          note: ((inactive > 0 && statusPick !== "inactive") || present || todayShown?.notMarked > 0) && (
            <span className="sw-facts">
              {inactive > 0 && statusPick !== "inactive" && <span>{inactive.toLocaleString("en-IN")} inactive</span>}
              {present &&
                (seesAttendance ? (
                  <button type="button" className="link-btn" onClick={() => switchMode("attendance")}>
                    {present}
                  </button>
                ) : (
                  <span>{present}</span>
                ))}
              {todayShown?.notMarked > 0 && <span>{todayShown.notMarked.toLocaleString("en-IN")} {todayShown.notMarked === 1 ? "class" : "classes"} not marked</span>}
            </span>
          ),
        },
      ];
    }
    // One tile: how many staff, with who teaches and who's inactive
    const teaching = visible.filter((p) => /teach|prt|tgt|pgt|lecturer|faculty/i.test(`${p.designation ?? ""} ${p.department ?? ""}`)).length;
    const inactive = visible.filter((p) => p.status === "inactive").length;
    return [
      {
        color: "pink",
        label: query.trim() ? "Matching staff" : "Staff",
        value: loading ? undefined : visible.length,
        note: !loading && visible.length > 0 && (
          <span className="sw-facts">
            <span>{teaching.toLocaleString("en-IN")} teaching</span>
            <span>{(visible.length - teaching).toLocaleString("en-IN")} other staff</span>
            {inactive > 0 && <span>{inactive.toLocaleString("en-IN")} inactive</span>}
          </span>
        ),
      },
    ];
  })();
  const screens = listScreens({ isAdmin, isOwner, leads, seesAttendance, canWrite, computerOnly, pendingCount });
  // The top bar has every section, so nothing is more than one row of tabs
  // away (data/screens.js). School settings are in the account menu.
  const sections = [
    ["home", "Home"],
    ["students", "Students"],
    ...(screens.some((s) => s.section === "office") ? [["office", "Office"]] : []),
    ...(isAdmin ? [["fees", "Fees"]] : []),
    ["academics", "Academics"],
    ["planner", "Planner"],
    ["requests", "Inbox", mode === "requests" ? 0 : inboxCount],
    ...(leads ? [["employees", "Staff", isOwner ? pendingCount : 0]] : []),
    ...(isAdmin ? [["transport", "Transport"]] : []),
  ];
  // Phones have room for these; More lists everything else directly.
  const barKeys = ["home", "students", isAdmin ? "fees" : "academics", "requests"];
  const litMode = SECTION_OF[mode] ?? mode;
  // Phones: swipe sideways to the next or previous tab (not on a profile).
  useSwipeTabs(barKeys, litMode, switchMode, !studentPage);
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
      screens={screens}
      onScreen={switchMode}
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
    // New enquiry isn't here: it's a button on Admissions (Office).
    ...(isAdmin && !viewOnly ? [["fee", "Collect fee", "rupee"]] : []),
    // Teachers' daily work: their class register (class in-charges), homework
    // and marks. Owners, admins and the principal see these, not give them.
    ...(role === "teacher" && isClassTeacher && !viewOnly ? [["attendance", "Mark attendance", "register"]] : []),
    ...(role === "teacher" ? [["homework", "Give homework", "book"]] : []),
    ...(role === "teacher" && canWrite ? [["result", "Add result", "chart"]] : []),
    // Exams: teachers for their classes, the office for any class
    ...(role === "teacher" || (isAdmin && !viewOnly) ? [["datesheet", "Add exam", "exam"]] : []),
    ["notice", "Post notice", "notice"],
    ...(isAdmin && !viewOnly ? [["bulk", "Message parents", "users"]] : []),
    ...(isAdmin ? [["event", "Add to calendar", "calendar"]] : []),
  ];
  function runAction(kind) {
    if (kind === "fee") {
      setCollect({});
      return;
    }
    if (kind === "attendance") return switchMode("attendance");
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
    const go = { student: "students", enquiry: "admissions", fee: "fees", homework: "homework", datesheet: "datesheet", staff: "employees", bulk: "requests", result: "marks" }[kind];
    switchMode(go);
    if (kind === "student" || kind === "staff") {
      if (kind === "staff") setStaffTab("people");
      setAdding(true);
    } else {
      setQuick({ kind, at: Date.now() });
    }
  }
  // The assistant: opens as its own history entry, so Back closes it.
  const openAsk = useCallback(() => {
    // This tap unlocks sound on phones, so her greeting can be heard.
    primeVoice();
    setAskPulled(false);
    if (!window.history.state?.avatar) window.history.pushState({ avatar: true }, "", "/avatar");
    setAsking(true);
  }, []);
  const closeAsk = useCallback(() => {
    if (window.history.state?.avatar) window.history.back();
    else setAsking(false);
  }, []);
  // What it asked for: the page, a student, a form or the bus map. Its
  // /avatar entry gives way to the page, so Back doesn't reopen it.
  const askAct = useRef(null);
  askAct.current = ({ type, target, id }) => {
    setAsking(false);
    if (window.history.state?.avatar) window.history.replaceState(null, "", "/");
    if (type === "student") {
      switchMode("students");
      return openStudent(id);
    }
    if (type === "start") return runAction(target);
    if (type === "map") {
      switchMode("transport");
      return setView("map");
    }
    switchMode(target);
  };
  const onAskAct = useCallback((a) => askAct.current(a), []);
  useGoddessSwipe({
    enabled: canAsk,
    atHome: mode === "home" && openId === null,
    open: asking,
    onPeek: (on) => {
      setAskPeek(on);
      if (on) setAskPulled(true);
    },
    onOpen: () => {
      if (!window.history.state?.avatar) window.history.pushState({ avatar: true }, "", "/avatar");
      setAsking(true);
      setAskPeek(false);
    },
    onLeaveStart: () => mode !== "home" && switchMode("home"),
    onLeave: () => onAskAct({ type: "go", target: "home" }),
  });
  // Ready for the first pull: her code, the list of clips and her still.
  useEffect(() => {
    if (!canAsk || !window.matchMedia("(max-width: 760px)").matches) return;
    const t = setTimeout(() => loadConcierge().then((m) => m.preloadConcierge()).catch(() => {}), 2000);
    return () => clearTimeout(t);
  }, [canAsk]);
  // Pages it can open, each once; the chips are the most used of them.
  // What each section's panel in the top bar offers (computers): big links to
  // its screens, then columns of smaller ones. Everything is one click away.
  const openStudents = (status = "active", grade = null) => {
    switchMode("students");
    setStatusPick(status);
    setPickedGrades(grade ? [grade] : []);
    setNeedPick(null);
    setQuery("");
  };
  const actions = (...kinds) => ({
    title: "Quick actions",
    links: plusActions.filter(([k]) => kinds.includes(k)).map(([k, l]) => [l, () => runAction(k)]),
  });
  const screenNow = {
    homework: { attendance: "attendance", homework: "homework", syllabus: "syllabus", results: "marks" }[academicsView],
    fees: { overview: "fees", collection: "collection", class: "class-report", structure: "structure", log: "payment-log" }[feesView],
    calendar: { calendar: "calendar", datesheet: "datesheet", timetable: "timetable", notices: "notices" }[plannerView],
  }[mode];
  const bigLinks = (section, names = {}) => screens.filter((s) => s.section === section).map((s) => [names[s.key] ?? s.label, () => switchMode(s.key), { current: s.key === screenNow }]);
  const menus = {
    home: {
      big: [["Home", () => switchMode("home")], ["My profile", () => switchMode("me")], ...(isAdmin ? [["School settings", () => openOwner("profile")]] : [])],
      columns: [actions(...plusActions.map(([k]) => k))],
    },
    students: {
      big: [
        ["Active", () => openStudents("active"), { current: isStudents && statusPick === "active" }],
        ["Inactive", () => openStudents("inactive"), { current: isStudents && statusPick === "inactive" }],
      ],
      columns: [actions("student", "result"), { title: "Classes", wide: true, links: gradeOptions(searchStudents).map((g) => [gradeLabel(g.value), () => openStudents("active", g.value)]) }],
    },
    // The front office: applicants on their way in, and certificates out.
    office: {
      big: [
        ...(screens.some((s) => s.key === "admissions") ? [["Admissions", () => switchMode("admissions"), { current: mode === "admissions" }]] : []),
        ...(screens.some((s) => s.key === "certificates") ? [["Certificates", () => switchMode("certificates"), { current: mode === "certificates" }]] : []),
      ],
      columns: screens.some((s) => s.key === "admissions") && isAdmin && !viewOnly ? [{ title: "Quick actions", links: [["New enquiry", () => runAction("enquiry")]] }] : [],
    },
    fees: { big: bigLinks("fees", { fees: "Overview", "class-report": "Class-wise", collection: "Collection", structure: "Structure", "payment-log": "Payment log" }), columns: [actions("fee", "bulk")] },
    academics: { big: bigLinks("academics"), columns: [actions("attendance", "homework", "result")] },
    planner: { big: bigLinks("planner"), columns: [actions("event", "datesheet", "notice")] },
    requests: {
      big: [
        ["All messages", () => switchMode("requests"), { current: mode === "requests" && inboxView === "all" }],
        ["Unread", () => switchMode("unread"), { current: mode === "requests" && inboxView === "unread" }],
        ["Requests", () => switchMode("open-requests"), { current: mode === "requests" && inboxView === "requests" }],
      ],
      columns: [],
    },
    employees: {
      big: [
        ["People", () => switchMode("people"), { current: mode === "employees" && staffTab === "people" && staffView === "list" }],
        ["Org chart", () => switchMode("org-chart"), { current: mode === "employees" && staffTab === "people" && staffView === "chart" }],
        ...(isOwner ? [["App access", () => switchMode("access"), { current: mode === "employees" && staffTab === "access", count: pendingCount }]] : []),
      ],
      columns: isAdmin ? [{ title: "Quick actions", links: [["Add staff", () => runAction("staff")]] }] : [],
    },
    transport: {
      big: [
        [
          "Routes and buses",
          () => {
            switchMode("transport");
            setView("routes");
            // They're under the map: go to them, once the page has drawn if coming from elsewhere
            setTimeout(() => document.querySelector(".bus-section")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
          },
          { current: mode === "transport" && view !== "map" },
        ],
        ["Bus map", () => (switchMode("transport"), setView("map")), { current: mode === "transport" && view === "map" }],
      ],
      columns: [],
    },
  };
  // On Certificates, phones get its kinds in that row instead of a list
  if (mode === "certificates" && !wideScreen) {
    menus.office = {
      ...menus.office,
      big: [["", "All"], ...CERT_KINDS.map(([k, l]) => [k, l.replace(" (SLC / TC)", "")])].map(([k, l]) => [l, () => setCertKind(k), { current: certKind === k }]),
    };
  }
  // On Admissions, phones get just its stages in that row (one row at most)
  if (mode === "admissions" && !wideScreen) {
    menus.office = {
      ...menus.office,
      big: [
        ...[["enquiry", "Enquiries"], ["registered", "Registered"], ["admitted", "Admitted"], ["lost", "Not joining"]].map(([k, l]) => [l, () => setAdmissionsView(k), { current: admissionsView === k }]),
      ],
    };
  }
  // Where you are, for the phone's small heading: the section, and the
  // screen in it when that's something else (Office › Certificates).
  const whereSection = mode === "home" ? null : sections.find(([v]) => v === litMode)?.[1] ?? null;
  const wherePageLabel = screens.find((s) => s.key === (screenNow ?? mode))?.label;
  const wherePage = wherePageLabel && wherePageLabel !== whereSection ? wherePageLabel : null;
  const askPages = [...screens.map((s) => [s.key, s.label]), ["me", "My profile"]];
  const askChips = ["attendance", "fees", "students", "requests", "employees", "transport", "calendar", "homework", "notices"]
    .map((k) => askPages.find(([x]) => x === k))
    .filter(Boolean);
  // Figures the app already shows this person, for answers without a lookup.
  const askFacts = useMemo(() => {
    if (!asking) return {};
    const f = { session: currentSession?.name ?? "", students: searchStudents.filter((p) => p.status !== "inactive").length };
    if (isAdmin) {
      const owing = searchStudents.filter((p) => Number(p.fee_due) > 0);
      f.fees = {
        due_rupees: owing.reduce((t, p) => t + Number(p.fee_due), 0),
        students_owing: owing.length,
        students_overdue: searchStudents.filter((p) => p.fee_status === "overdue").length,
      };
      f.bus_routes = routes.length;
    }
    if (today) {
      f.attendance_today = { present: today.present, absent: today.absent, on_leave: today.leave, marked: today.marked };
      if (today.classes) f.attendance_today.classes_not_marked = `${today.notMarked} of ${today.classes}`;
    }
    f.inbox_waiting = inboxCount;
    if (isOwner) f.staff_waiting_for_app_access = pendingCount;
    return f;
  }, [asking, currentSession, searchStudents, isAdmin, isOwner, routes, today, inboxCount, pendingCount]);
  if (needsClasses) {
    return <ClassAllocationGate school={school} session={currentSession} />;
  }

  return (
    <div className={`app${plusActions.length ? " has-plus" : ""}`} data-clarity-mask="True">
      <TopBar
        mode={litMode}
        onMode={switchMode}
        sections={sections}
        barKeys={barKeys}
        screens={screens}
        menus={menus}
        // Owners: the whole school profile. Admins: its contact details for parents.
        onSettings={isAdmin ? () => openOwner("profile") : null}
        onProfile={() => switchMode("me")}
        session={sessions.length > 0 && <SessionSelect sessions={sessions} value={sessionId} current={currentSession} onChange={switchSession} />}
        search={globalSearch}
        onAsk={canAsk ? openAsk : null}
      />
      {/* Quietly shrinks full-size ERP photos in the background (computers, owners/admins). */}
      {!loading && isAdmin && dataMode === "students" && <PhotoUpgrade schoolId={school.id} students={people} onPhoto={patch} />}
      <InstallPrompt />
      <UpdatePrompt />

      {/* A student's page sits in front of the page it opened from, which stays
          as it was (filters, typed marks, scroll) for coming Back. */}
      {studentPage && (
        <main className="page">
        <Suspense fallback={<div className="grid" aria-busy="true"><div className="card card-skeleton" /><div className="card card-skeleton" /><div className="card card-skeleton" /></div>}>
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
        </Suspense>
        </main>
      )}
      <main className="page" hidden={studentPage}>
        {/* Phones: where you are, small at the top (pages hide their titles there). */}
        {!wideScreen && whereSection && (
          <p className="page-where">
            <span>{whereSection}</span>
            {wherePage && (
              <>
                <Icon name="chevronRight" size={12} />
                <b>{wherePage}</b>
              </>
            )}
          </p>
        )}
        <Suspense fallback={<div className="grid" aria-busy="true"><div className="card card-skeleton" /><div className="card card-skeleton" /><div className="card card-skeleton" /></div>}>
        {mode === "me" ? (
          <MyProfile school={school} session={currentSession} email={user.email} googleName={user.displayName} onBack={() => switchMode("home")} />
        ) : mode === "employees" && isOwner && staffTab === "access" ? (
          <>
            <div className="page-header">
              <div className="page-meta">
                <h1 className="page-title">App access</h1>
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
            onGo={switchMode}
            onNeed={(need) => {
              openStudents("active");
              setNeedPick(need);
            }}
          />
        ) : mode === "calendar" ? (
          <>
            <h1 className="sr-only">Planner</h1>
            <CalendarPage
              schoolId={school.id}
              canEdit={isAdmin}
              staff
              adding={calAdding}
              onAdding={setCalAdding}
              onOpenNotices={() => setPlannerView("notices")}
              view={plannerView}
              onView={setPlannerView}
              notices={<NoticeBoard school={school} schoolId={school.id} me={user.email} isAdmin={isAdmin} compose={noticeCompose} onCompose={setNoticeCompose} />}
              noticeAction={
                !viewOnly && (
                  <button className="btn btn-primary" onClick={() => setNoticeCompose(true)}>
                    <Icon name="plus" /> Post notice
                  </button>
                )
              }
              session={currentSession}
              students={current}
              me={user.email}
              dsIsAdmin={isAdmin}
              dsReadOnly={isPrincipal || viewOnly}
              dsCreateAt={quick.kind === "datesheet" ? quick.at : 0}
              ttIsAdmin={isAdmin}
              ttReadOnly={isPrincipal || viewOnly}
            />
          </>
        ) : mode === "team" && isAdmin ? (
          <TeamPage
            view="school"
            school={school}
            session={currentSession}
            me={user.email}
            isOwner={isOwner}
            onSchoolSaved={setSchool}
          />
        ) : mode === "fees" ? (
          <FeesPage
            computerOnly={computerOnly}
            view={feesView}
            onView={setFeesView}
            onCollect={(student) => setCollect({ student })}
            onOpenStudent={(id, tab) => openStudent(id, tab)}
            onOpened={revalidate}
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
        ) : mode === "transport" && isAdmin ? (
          <>
            <h1 className="sr-only">Transport</h1>
            {school.plan !== "premium" && (
              <div className="ai-row">
                <InsightsButton section="transport" label="Transport insights" />
              </div>
            )}
            {(() => {
              // One tile: who's on the bus, with the routes and pinned homes
              const onBus = current.filter((s) => s.uses_bus).length;
              const pinned = current.filter((s) => s.home_lat != null).length;
              const tile = (
                <StatCards
                  items={[
                    {
                      color: "orange",
                      label: "On the bus",
                      value: onBus,
                      note: (
                        <span className="sw-facts">
                          <span>
                            {routes.length.toLocaleString("en-IN")} {routes.length === 1 ? "route" : "routes"}
                          </span>
                          <span>{pinned.toLocaleString("en-IN")} homes pinned</span>
                        </span>
                      ),
                    },
                  ]}
                />
              );
              if (!insT.on) return tile;
              return (
                <AiCard
                  ins={insT}
                  lead={tile}
                  opens={["routes", "buses", "map"]}
                  onOpen={(kind) => {
                    if (kind === "map") setView("map");
                    else document.querySelector(kind === "buses" ? ".bus-section" : ".tr-add")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                />
              );
            })()}
            {/* The map on top: a short preview that opens to full size. */}
            {/* The map card; tapping it opens the map full screen on top. */}
            <Suspense fallback={<div className="card card-skeleton tr-map-skeleton" />}>
              <StudentMap school={school} students={current} allStudents={current} canEdit={canEdit} onOpenStudent={(id) => openStudent(id)} compact onExpand={() => setView("map")} />
            </Suspense>
            <TransportRoutes school={school} routes={routes} students={current} onChanged={loadRoutes} onStudentsChanged={(ids, fields) => ids.forEach((id) => patch(id, fields))} />
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
          <HomeworkPage school={school} session={currentSession} students={current} me={user.email} isAdmin={isAdmin} readOnly={leads} giveAt={quick.kind === "homework" ? quick.at : 0} view={academicsView === "results" && !canWrite ? "homework" : academicsView} onView={setAcademicsView} attIsAdmin={leads} attReadOnly={isPrincipal} onOpenStudent={(id) => openStudent(id)} results={canWrite ? <MarksPage school={school} session={currentSession} students={current} noUpload={computerOnly} onOpenStudent={(id) => openStudent(id)} /> : null} />
        ) : mode === "certificates" && isAdmin ? (
          <CertificatesRegister school={school} kind={certKind} onKind={setCertKind} students={current} sessionId={currentSession?.id} onUpdate={patch} />
        ) : mode === "admissions" && leads ? (
          <AdmissionsPage
            school={school}
            grades={schoolGrades}
            sessions={sessions}
            current={currentSession}
            students={current}
            routes={routes}
            me={user.email}
            readOnly={isPrincipal}
            view={admissionsView}
            onView={setAdmissionsView}
            addAt={quick.kind === "enquiry" ? quick.at : 0}
            onSchoolSaved={setSchool}
            onGradesSaved={loadGrades}
            onSessionsChanged={reloadSessions}
            onAdmitted={reload}
            onOpenStudent={(id) => {
              switchMode("students");
              openStudent(id);
            }}
          />
        ) : mode === "requests" ? (
          <InboxPage
            filter={inboxView}
            onFilter={setInboxView}
            openThread={openThread}
            readOnly={isPrincipal}
            canBulk={isAdmin && !viewOnly}
            bulkAt={quick.kind === "bulk" ? quick.at : 0}
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

        {/* The numbers and her insights first; the toolbar under them stays
            pinned while scrolling. */}
        {!viewOnly && !showInsights && <StatCards items={overview} />}
        {showInsights && (
          <AiCard
            key={insHere.section}
            ins={insHere}
            lead={<StatCards items={overview} />}
            opens={isStudents ? (canWrite ? ["marks"] : []) : isOwner ? ["access"] : []}
            onOpen={(kind) => (kind === "marks" ? switchMode("marks") : setStaffTab("access"))}
            onPerson={(id) => openStudent(id)}
          />
        )}

        {/* Students: search, grades and the actions on one line; the count
            lives in the search box. */}
        {/* One row, pinned under the header while scrolling: search, filters
            and actions (Students and Staff alike). */}
        <div className="toolbar toolbar-students toolbar-sticky">
          {isStudents && (
            <FilterSheet
              grades={gradeChoices}
              picked={pickedGrades}
              onPick={setPickedGrades}
              sort={sort}
              onSort={chooseSort}
              withSort={mode === "students"}
              withFee={isAdmin}
              need={needPick}
              onNeed={isAdmin ? setNeedPick : null}
              status={statusPick}
              onStatus={setStatusPick}
              shown={visible.length}
            />
          )}
          {mode === "students" && <SortArrow sort={sort} onSort={chooseSort} />}
          {/* Past sessions have no tile to show the filtered total */}
          {!loading && viewOnly && filtered && (
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
              {isAdmin && !computerOnly && !loading && <ExportButton school={school} role={role} people={current} preselect={visible} label={`students-${currentLabel}`} />}
              {canEdit && !computerOnly && (
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
        ) : !isStudents && staffView === "chart" && current.length > 0 ? (
          <OrgChart
            staff={current}
            school={school}
            canEdit={canEdit && !viewOnly}
            matches={query.trim() ? new Set(visible.map((p) => p.id)) : null}
            onOpen={(id) => openStudent(id)}
            onPatch={patch}
          />
        ) : visible.length === 0 ? (
          <div className="empty">
            <p className="empty-title">No {mode} found</p>
            <p>
              {query ? `Nothing matches “${query}”` : `No ${statusPick} students`}
              {pickedGrades.length ? ` in ${gradesText(pickedGrades)}` : ""}.
            </p>
          </div>
        ) : (
          <Grid
            items={ordered}
            resetKey={`${mode}|${query}|${pickedGrades.join(",")}|${needPick}|${statusPick}`}
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
        {(asking || askPeek) && canAsk && (
          <Concierge
            dormant={!asking}
            pulled={askPulled}
            school={school}
            sessionId={currentSession?.id}
            seesFees={isAdmin}
            name={user.displayName}
            students={searchStudents}
            facts={askFacts}
            page={mode}
            pages={askPages}
            forms={plusActions.map(([k, l]) => [k, l])}
            chips={askChips}
            onAct={onAskAct}
            onClose={closeAsk}
          />
        )}
        {collect && isAdmin && (
          <CollectFee
            school={school}
            students={dataMode === "students" ? current : searchStudents}
            student={collect.student}
            onClose={() => setCollect(null)}
            onOpenStudent={(id) => {
              setCollect(null);
              if (dataMode !== "students") switchMode("students");
              openStudent(id, "fees");
            }}
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
          viewedSession={selectedSession?.name}
          onClose={() => setImporting(false)}
          onDone={reload}
        />
      )}
      {adding && (
        <AddModal
          mode={mode}
          schoolId={school.id}
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
