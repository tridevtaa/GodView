import { useEffect, useState } from "react";
import { feeSessionSummary, listHomework, loadEmployees, staffInbox, withPhotoUrls } from "../data/api.js";
import { peek, swr } from "../data/cache.js";
import { rupeesShort } from "../data/money.js";
import { CountUp, Ring } from "./StatCards.jsx";
import Icon from "./Icon.jsx";

const n = (v) => Number(v || 0).toLocaleString("en-IN");
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

// Home: everything this person can reach, at a glance. A greeting, what
// needs them now (tap to go there), and a tile for each part of the app
// with its key number. Uses the same remembered data as the pages, so it's
// quick and the pages open already filled.
export default function HomePage({ school, me, name, role, students, loading, session, today, pendingCount, routes, onGo }) {
  const isAdmin = role === "owner" || role === "admin";
  const leads = isAdmin || role === "principal";
  const isOwner = role === "owner";
  const [threads, setThreads] = useState(() => peek(`inbox:${school.id}`) ?? null);
  const [homework, setHomework] = useState(() => (session ? peek(`homework:${session.id}`) ?? null : null));
  const [fees, setFees] = useState(() => (session ? peek(`fees:summary:${session.id}`) ?? null : null));
  const staffKey = `people:employees:${school.id}:`;
  const [staff, setStaff] = useState(() => peek(staffKey) ?? null);

  useEffect(() => {
    swr(`inbox:${school.id}`, () => staffInbox(school.id), setThreads).catch(() => setThreads([]));
    if (leads) swr(staffKey, () => loadEmployees(school.id).then(withPhotoUrls), setStaff, { persist: true, maxAge: 120000 }).catch(() => {});
  }, [school.id, leads, staffKey]);
  useEffect(() => {
    if (!session) return;
    swr(`homework:${session.id}`, () => listHomework(school.id, session.id), setHomework).catch(() => setHomework([]));
    if (isAdmin) swr(`fees:summary:${session.id}`, () => feeSessionSummary(session.id), setFees).catch(() => {});
  }, [school.id, session, isAdmin]);

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
  const billed = Number(fees?.billed) || students.reduce((t, p) => t + (Number(p.fee_billed) || 0), 0);
  const collected = Number(fees?.collected) || students.reduce((t, p) => t + (Number(p.fee_paid) || 0), 0);
  const attPct = today?.marked ? Math.round((today.present / today.marked) * 100) : null;
  const onBus = students.filter((p) => p.uses_bus).length;

  // What needs this person now
  const needs = [
    unread > 0 && { key: "unread", icon: "plane", text: `${unread} unread conversation${unread === 1 ? "" : "s"}`, go: "requests", tone: "due" },
    requests > 0 && { key: "req", icon: "file", text: `${requests} request${requests === 1 ? "" : "s"} waiting`, go: "requests", tone: "overdue" },
    leads && today?.notMarked > 0 && { key: "att", icon: "register", text: `${today.notMarked} class${today.notMarked === 1 ? "" : "es"} not marked today`, go: "attendance", tone: "due" },
    !leads && today && today.marked === 0 && role === "teacher" && { key: "mark", icon: "register", text: "Today’s attendance isn’t marked", go: "attendance", tone: "due" },
    isOwner && pendingCount > 0 && { key: "access", icon: "teacher", text: `${pendingCount} staff waiting for access`, go: "access", tone: "due" },
    isAdmin && overdue > 0 && { key: "overdue", icon: "rupee", text: `${n(overdue)} students overdue on fees`, go: "fees", tone: "overdue" },
    !leads && dueTomorrow > 0 && { key: "hw", icon: "book", text: `${dueTomorrow} homework due tomorrow`, go: "homework" },
  ].filter(Boolean);

  const tiles = [
    {
      key: "students",
      icon: "scholar",
      label: leads ? "Students" : "My students",
      value: loading ? undefined : students.length,
      line: `${n(students.filter((p) => p.gender === "M").length)} boys · ${n(students.filter((p) => p.gender === "F").length)} girls`,
      go: "students",
    },
    (leads || today) && {
      key: "attendance",
      icon: "register",
      label: "Attendance today",
      value: today === null ? undefined : today.marked ? today.present : "–",
      line: today?.marked ? `of ${n(today.marked)} present · ${n(today.absent)} absent` : "Not marked yet",
      ring: attPct,
      tone: attPct === null ? undefined : attPct >= 90 ? "paid" : attPct >= 75 ? "due" : "overdue",
      go: "attendance",
    },
    isAdmin && {
      key: "fees",
      icon: "rupee",
      label: "Fees due now",
      value: loading ? undefined : due,
      format: rupeesShort,
      line: `${n(owing.length)} owe · ${rupeesShort(collected)} collected`,
      bar: billed ? collected / billed : null,
      tone: due > 0 ? "due" : "paid",
      go: "fees",
    },
    {
      key: "inbox",
      icon: "plane",
      label: "Inbox",
      value: threads === null ? undefined : unread,
      line: threads === null ? "" : `unread · ${requests} request${requests === 1 ? "" : "s"} waiting`,
      tone: unread ? "due" : undefined,
      go: "requests",
    },
    {
      key: "homework",
      icon: "book",
      label: "Homework",
      value: homework === null ? undefined : thisWeek,
      line: `this week · ${dueTomorrow} due tomorrow`,
      go: "homework",
    },
    leads && {
      key: "staff",
      icon: "teacher",
      label: "Staff",
      value: staff === null ? undefined : staff.length,
      line: isOwner && pendingCount ? `${pendingCount} waiting for access` : "in the team",
      tone: isOwner && pendingCount ? "due" : undefined,
      go: "employees",
    },
    isAdmin && {
      key: "transport",
      icon: "bus",
      label: "Transport",
      value: loading ? undefined : onBus,
      line: `on the bus · ${routes.length} route${routes.length === 1 ? "" : "s"}`,
      bar: students.length ? onBus / students.length : null,
      go: "transport",
    },
  ].filter(Boolean);

  const first = (name || me || "").split(/[\s@]/)[0];
  return (
    <div className="home">
      <header className="home-hero">
        <p className="home-date">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1>
          {greeting()}
          {first ? `, ${first.charAt(0).toUpperCase()}${first.slice(1)}` : ""}
        </h1>
        <p className="home-sub">{needs.length ? `${needs.length} thing${needs.length === 1 ? "" : "s"} need${needs.length === 1 ? "s" : ""} you today` : "All caught up"}</p>
      </header>

      {needs.length > 0 ? (
        <ul className="home-needs">
          {needs.map((x, i) => (
            <li key={x.key} style={{ "--d": `${i * 50}ms` }}>
              <button className={`home-need is-${x.tone ?? "info"}`} onClick={() => onGo(x.go)}>
                <span className="home-need-icon">
                  <Icon name={x.icon} size={18} />
                </span>
                <span>{x.text}</span>
                <Icon name="arrowRight" size={16} className="home-need-go" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="home-clear">
          <Icon name="check" size={18} /> Nothing waiting on you. Nice.
        </p>
      )}

      <section className="home-tiles">
        {tiles.map((t, i) => (
          <button key={t.key} className={`home-tile is-${t.key}`} onClick={() => onGo(t.go)} style={{ "--d": `${i * 45}ms` }}>
            <span className="home-tile-top">
              <span className="home-tile-icon">
                <Icon name={t.icon} size={20} />
              </span>
              <span className="home-tile-label">{t.label}</span>
            </span>
            <span className="home-tile-body">
              <strong className={t.tone ? `is-${t.tone}` : ""}>
                {t.value === undefined ? "…" : typeof t.value === "number" ? <CountUp to={t.value} format={t.format} /> : t.value}
              </strong>
              {t.ring !== undefined && t.ring !== null && <Ring pct={t.ring} tone={t.tone} />}
            </span>
            {t.bar !== undefined && t.bar !== null && (
              <span className="stat-bar">
                <span className="stat-bar-fill" style={{ "--to": `${Math.min(100, t.bar * 100)}%` }} />
              </span>
            )}
            <span className="home-tile-line">{t.line}</span>
          </button>
        ))}
      </section>
    </div>
  );
}
