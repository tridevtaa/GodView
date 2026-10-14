import { useEffect, useState } from "react";
import { listHomework, loadEmployees, staffInbox, withPhotoUrls } from "../data/api.js";
import { peek, swr } from "../data/cache.js";
import { rupeesShort } from "../data/money.js";
import { CountUp } from "./StatCards.jsx";
import { Tile, WideTile } from "./Widgets.jsx";
import { ComingUp } from "./CalendarPage.jsx";

const n = (v) => Number(v || 0).toLocaleString("en-IN");
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

// Home, like phone widgets: a greeting, today's attendance in one wide
// tile, then a colourful tile for each part of the app with one number
// and one word. Anything waiting on this person shows as a red badge on
// its tile (overdue fees, open requests, staff waiting for access…).
// Then what's coming up, to swipe through. Uses the same remembered data
// as the pages, so it's quick and the pages open already filled.
export default function HomePage({ school, me, name, role, students, loading, session, today, pendingCount, onGo }) {
  const isAdmin = role === "owner" || role === "admin";
  const leads = isAdmin || role === "principal";
  const isOwner = role === "owner";
  const [threads, setThreads] = useState(() => peek(`inbox:${school.id}`) ?? null);
  const [homework, setHomework] = useState(() => (session ? peek(`homework:${session.id}`) ?? null : null));
  const staffKey = `people:employees:${school.id}:`;
  const [staff, setStaff] = useState(() => peek(staffKey) ?? null);

  useEffect(() => {
    swr(`inbox:${school.id}`, () => staffInbox(school.id), setThreads).catch(() => setThreads([]));
    if (leads) swr(staffKey, () => loadEmployees(school.id).then(withPhotoUrls), setStaff, { persist: true, maxAge: 120000 }).catch(() => {});
  }, [school.id, leads, staffKey]);
  useEffect(() => {
    if (!session) return;
    swr(`homework:${session.id}`, () => listHomework(school.id, session.id), setHomework).catch(() => setHomework([]));
  }, [school.id, session]);

  // Numbers
  const unread = (threads ?? []).filter((t) => Number(t.unread) > 0).length;
  const requests = (threads ?? []).filter((t) => Number(t.open_requests) > 0).length;
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const dueTomorrow = (homework ?? []).filter((h) => h.due_date === tomorrow).length;
  const thisWeek = (homework ?? []).filter((h) => h.created_at >= weekAgo).length;
  const owing = students.filter((p) => Number(p.fee_due) > 0);
  const overdue = students.filter((p) => p.fee_status === "overdue").length;
  const due = owing.reduce((t, p) => t + Number(p.fee_due), 0);
  const attPct = today?.marked ? Math.round((today.present / today.marked) * 100) : null;
  const onBus = students.filter((p) => p.uses_bus).length;

  // One tile per part of the app: a number and a word. badge: what's
  // waiting on this person there; hot: something new, the tile glows.
  const go = (to) => () => onGo(to);
  const tiles = [
    { key: "students", icon: "scholar", tone: "indigo", label: leads ? "Students" : "My students", value: loading ? undefined : students.length, onClick: go("students") },
    isAdmin && {
      key: "fees",
      icon: "rupee",
      tone: due > 0 ? "amber" : "green",
      label: "Fees due",
      value: loading ? undefined : due,
      format: rupeesShort,
      badge: overdue,
      badgeLabel: `${n(overdue)} students overdue`,
      onClick: go("fees"),
    },
    {
      key: "inbox",
      icon: "plane",
      tone: "violet",
      label: "Unread",
      value: threads === null ? undefined : unread,
      badge: requests,
      badgeLabel: `${requests} request${requests === 1 ? "" : "s"} waiting`,
      hot: unread > 0,
      onClick: go("requests"),
    },
    {
      key: "homework",
      icon: "book",
      tone: "teal",
      label: "Homework",
      value: homework === null ? undefined : thisWeek,
      badge: leads ? 0 : dueTomorrow,
      badgeLabel: `${dueTomorrow} due tomorrow`,
      onClick: go("homework"),
    },
    leads && {
      key: "staff",
      icon: "teacher",
      tone: "pink",
      label: "Staff",
      value: staff === null ? undefined : staff.length,
      badge: isOwner ? pendingCount : 0,
      badgeLabel: `${pendingCount} waiting for access`,
      onClick: go(isOwner && pendingCount ? "access" : "employees"),
    },
    isAdmin && { key: "bus", icon: "bus", tone: "orange", label: "On the bus", value: loading ? undefined : onBus, onClick: go("transport") },
  ].filter(Boolean);

  // Today's attendance: green, amber or red by how many are in; indigo
  // (and glowing) while it still needs marking.
  const showToday = leads || today;
  const unmarked = today && today.marked === 0;
  const attTone = attPct === null ? "indigo" : attPct >= 90 ? "green" : attPct >= 75 ? "amber" : "red";
  const left = today?.notMarked ?? 0;

  const first = (name || me || "").split(/[\s@]/)[0];
  return (
    <div className="home hw">
      <header className="home-hero">
        <p className="home-date">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1>
          {greeting()}
          {first ? `, ${first.charAt(0).toUpperCase()}${first.slice(1)}` : ""}
        </h1>
      </header>

      <div className="hw-grid">
        {showToday && (
          <WideTile
            tone={attTone}
            hot={unmarked || left > 0}
            kicker="Today"
            title={
              today === null ? "…" : today.marked ? (
                <>
                  <CountUp to={today.present} /> present
                </>
              ) : (
                "Attendance"
              )
            }
            sub={today === null ? "" : !today.marked ? "Not marked yet" : left ? `${left} class${left === 1 ? "" : "es"} left to mark` : "All classes marked"}
            pct={attPct}
            icon="register"
            onClick={go("attendance")}
          />
        )}
        {tiles.map((t, i) => (
          <Tile key={t.key} {...t} index={i} />
        ))}
      </div>

      <ComingUp schoolId={school.id} staff onOpenCalendar={() => onGo("calendar")} onOpenNotices={() => onGo("notices")} />
    </div>
  );
}

