// Every screen and how to get there, for the top bar's panels, the More sheet
// (phones) and the common search. Pages have no tabs of their own: these are
// the way to each screen.

// A screen that's a tab: [page, tab]. Anything else here is a page of its own,
// opening on its first tab.
export const SCREEN_AT = {
  academics: ["homework"],
  planner: ["calendar"],
  attendance: ["homework", "attendance"],
  homework: ["homework", "homework"],
  syllabus: ["homework", "syllabus"],
  marks: ["homework", "results"],
  collection: ["fees", "collection"],
  "class-report": ["fees", "class"],
  structure: ["fees", "structure"],
  calendar: ["calendar", "calendar"],
  datesheet: ["calendar", "datesheet"],
  timetable: ["calendar", "timetable"],
  notices: ["calendar", "notices"],
  access: ["employees", "access"],
  people: ["employees", "people"],
  "org-chart": ["employees", "people"],
  achievements: ["calendar", "wins"],
  unread: ["requests", "unread"],
  "open-requests": ["requests", "requests"],
};

// The top bar section a page lights up
export const SECTION_OF = { homework: "academics", calendar: "planner" };

// section: which top bar section it's under, for the More sheet's groups
// computerOnly: an owner or admin on a phone, without the reports and fee
// structure (App.jsx)
export function listScreens({ isAdmin, isOwner, leads, seesAttendance, canWrite, computerOnly = false, pendingCount = 0 }) {
  return [
    { key: "home", label: "Home", icon: "home", words: "dashboard" },
    { key: "students", label: "Students", icon: "scholar", words: "admissions" },
    { key: "requests", label: "Inbox", icon: "plane", words: "messages parents chat" },
    ...(isAdmin
      ? [
          { key: "fees", label: "Fees", icon: "rupee", section: "fees", words: "dues overdue pending overview" },
          ...(computerOnly
            ? []
            : [
                { key: "collection", label: "Collection report", icon: "chart", section: "fees", words: "fee collected payments modes cash" },
                { key: "class-report", label: "Class-wise report", icon: "table", section: "fees", words: "fee dues concession collected" },
              ]),
        ]
      : []),
    ...(isOwner && !computerOnly ? [{ key: "structure", label: "Fee structure", icon: "settings", section: "fees", words: "heads plans" }] : []),
    ...(seesAttendance ? [{ key: "attendance", label: "Attendance", icon: "register", section: "academics", words: "register present absent" }] : []),
    { key: "homework", label: "Homework", icon: "book", section: "academics" },
    { key: "syllabus", label: "Syllabus", icon: "academics", section: "academics" },
    ...(canWrite ? [{ key: "marks", label: "Results", icon: "chart", section: "academics", words: "marks exam test" }] : []),
    { key: "calendar", label: "Calendar", icon: "calendar", section: "planner", words: "planner holidays events" },
    { key: "datesheet", label: "Datesheet", icon: "exam", section: "planner", words: "planner exams" },
    { key: "timetable", label: "Timetable", icon: "table", section: "planner", words: "planner periods schedule" },
    { key: "notices", label: "Notices", icon: "notice", section: "planner", words: "noticeboard circulars" },
    { key: "achievements", label: "News & Achievements", icon: "trophy", section: "planner", words: "wins awards" },
    { key: "unread", label: "Unread", icon: "mail", section: "requests", words: "messages" },
    { key: "open-requests", label: "Requests", icon: "plane", section: "requests", words: "leave parents" },
    ...(leads ? [{ key: "employees", label: "Staff", icon: "teacher", section: "school", words: "teachers employees" }] : []),
    ...(leads ? [{ key: "org-chart", label: "Org chart", icon: "users", section: "school", words: "staff hierarchy" }] : []),
    ...(isOwner ? [{ key: "access", label: "App access", icon: "lock", section: "school", words: "staff login invite", count: pendingCount }] : []),
    ...(isAdmin ? [{ key: "transport", label: "Transport", icon: "bus", section: "school", words: "bus routes map stops" }] : []),
  ];
}

export const SECTION_LABEL = { academics: "Academics", fees: "Fees", planner: "Planner", requests: "Inbox", school: "School" };
