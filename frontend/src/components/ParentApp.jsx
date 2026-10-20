import { useCallback, useEffect, useMemo, useState } from "react";
import { useDismiss } from "./useDismiss.js";
import {
  createParentRequest,
  listGrades,
  listResults,
  logoUrl,
  markParentSeen,
  parentFamily,
  parentFees,
  childHomework,
  childDatesheet,
  childSyllabus,
  parentUnread,
  attendanceMonth,
  setParentPassword,
  parentHasOwnPassword,
} from "../data/api.js";
import { METHODS, rupees } from "../data/money.js";
import { logOut } from "./AuthGate.jsx";
import { LogoMark } from "./Logo.jsx";
import { Photo, gradeLabel, setGradeLabels, tintFor } from "./PersonCard.jsx";
import Receipt from "./Receipt.jsx";
import InstallPrompt from "./InstallPrompt.jsx";
import { NotifyMenuItem, NotifyPrompt } from "./Notify.jsx";
import { onNotificationOpen, syncPush } from "../pwa/push.js";
import { onFresh } from "../pwa/fresh.js";
import Icon from "./Icon.jsx";
import Chat, { useBackToClose } from "./Chat.jsx";
import GlassPill from "./GlassPill.jsx";
import NoticeBoard from "./NoticeBoard.jsx";
import CalendarPage, { ComingUp } from "./CalendarPage.jsx";
import { PriorityCard, Tile, WideTile } from "./Widgets.jsx";
import "./parent.css";

const TABS = [
  ["home", "Home", "home"],
  ["fees", "Fees", "rupee"],
  ["results", "Results", "chart"],
  ["homework", "Homework", "book"],
  ["datesheet", "Datesheet", "exam"],
  ["inbox", "Messages", "plane"],
];
// Local date (India), not UTC: before 5:30 am UTC is still yesterday.
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dateText = (d, opts = { day: "numeric", month: "short", year: "numeric" }) =>
  d ? new Date(d).toLocaleDateString("en-IN", opts) : "";
const showPhone = (p = "") => p.replace(/^\+?91(\d{5})(\d{5})$/, "+91 $1 $2");

// Home for a signed-in parent: their children, and for each one the fees,
// results, notes the school shared, and requests to the school.
export default function ParentApp({ phone }) {
  const [children, setChildren] = useState(null);
  const [error, setError] = useState("");
  const [childId, setChildId] = useState(null);
  // Parents land on Home: everything about the child at a glance.
  const [tab, setTab] = useState("home");
  const [pwOpen, setPwOpen] = useState(false);
  // First sign-in (still on the child's name + birth year): choose a
  // password before anything else. null while checking.
  const [mustSetPw, setMustSetPw] = useState(null);
  useEffect(() => {
    parentHasOwnPassword().then(
      (own) => setMustSetPw(!own),
      () => setMustSetPw(false)
    );
  }, []);
  // "<child>:<section>" -> { unread, seen_at }, from the database.
  const [unread, setUnread] = useState(new Map());
  // When the open section was last seen before this visit, to mark items New.
  const [since, setSince] = useState(null);

  const loadUnread = useCallback(
    () =>
      parentUnread().then(
        (rows) => setUnread(new Map(rows.map((r) => [`${r.student_id}:${r.section}`, { unread: Number(r.unread), seen_at: r.seen_at }]))),
        () => {}
      ),
    []
  );

  // Refresh the dots when the parent comes back to the app or a
  // notification comes in, and every minute.
  useEffect(() => {
    loadUnread();
    const stop = onFresh(loadUnread);
    const t = setInterval(loadUnread, 60000);
    return () => {
      stop();
      clearInterval(t);
    };
  }, [loadUnread]);

  useEffect(() => {
    parentFamily()
      .then(async (kids) => {
        // The school's own grade names ("KG 1", "Class 5"…), best effort.
        if (kids[0]) await listGrades(kids[0].school_id).then(setGradeLabels, () => {});
        setChildren(kids);
        setChildId((id) => (kids.some((k) => k.id === id) ? id : kids[0]?.id ?? null));
      })
      .catch(() => setError("Couldn’t load your children’s details. Check your connection and reload."));
  }, []);

  // Notifications: keep this device's subscription current, and open what
  // a tapped notification is about (a conversation, the noticeboard, or a
  // section for the everyday ones: fees, homework, calendar).
  useEffect(() => {
    syncPush().catch(() => {});
    return onNotificationOpen(({ thread, notice, go, child }) => {
      if (notice) return setTab("notices");
      if (go) {
        if (child) setChildId(child);
        return setTab(go);
      }
      setChildId(thread);
      setTab("inbox");
    });
  }, []);

  const child = children?.find((c) => c.id === childId);
  const school = child?.school ?? children?.[0]?.school;
  // New-item counts, shown like the Owner page's red number badges.
  const count = (id, section) => unread.get(`${id}:${section}`)?.unread ?? 0;
  const childCount = (id) => TABS.reduce((t, [v]) => t + count(id, v), 0);
  const badge = (n, label) =>
    n > 0 && (
      <span className="seg-count" aria-label={`${n} new ${label}`}>
        {n > 99 ? "99+" : n}
      </span>
    );

  // The noticeboard opens from Home, so Home stays lit there.
  const lit = tab === "notices" || tab === "calendar" ? "home" : tab;

  // Opening a section marks it seen; keep the previous time to show "New".
  useEffect(() => {
    if (!childId || tab === "home") return;
    const key = `${childId}:${tab}`;
    setSince(unread.get(key)?.seen_at ?? null);
    if (!unread.has(key)) return; // dots not loaded yet
    if (unread.get(key).unread === 0 && unread.get(key).seen_at) return;
    markParentSeen(childId, tab).then(
      () => setUnread((m) => new Map(m).set(key, { unread: 0, seen_at: new Date().toISOString() })),
      () => {}
    );
  }, [childId, tab, unread.size]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="pa" data-clarity-mask="True">
      <header className="pa-top">
        <div className="pa-top-inner">
          <span className="pa-brand">
            {/* Just the school's logo (else its name); Godview only before it loads */}
            {!school ? (
              <LogoMark size={24} />
            ) : school.logo_path ? (
              <img className="pa-school-logo" src={logoUrl(school.logo_path)} alt={school.short_name || school.name} style={{ "--logo-scale": school.logo_scale ?? 1 }} />
            ) : (
              <span className="pa-school-name">{school.short_name || school.name}</span>
            )}
          </span>
          <ParentMenu phone={phone} onPassword={() => setPwOpen(true)} />
        </div>
      </header>

      <InstallPrompt />
      <main className="pa-main">
        {mustSetPw ? (
          <ChangePassword required onDone={() => setMustSetPw(false)} />
        ) : (
        <>
        {pwOpen && <ChangePassword onDone={() => setPwOpen(false)} />}
        {error && <p className="notice notice-error">{error}</p>}
        {!children && !error && <div className="pa-hero pa-skeleton" aria-busy="true" />}
        {children && !children.length && <NotLinked phone={phone} />}

        {children?.length > 1 && (
          <nav className="pa-kids" aria-label="Your children">
            {children.map((c) => (
              <button key={c.id} className={c.id === childId ? "is-on" : ""} onClick={() => setChildId(c.id)}>
                <Photo person={c} className="pa-kid-photo" />
                <span>{c.name.split(" ")[0]}</span>
                {c.id !== childId && badge(childCount(c.id), "updates")}
              </button>
            ))}
          </nav>
        )}

        {child && (
          <>
            {/* The child, like the staff student page: round photo, name,
                class (section quieter), today's attendance. No card. */}
            <section className="pa-hero" style={{ "--tint": tintFor(child) }}>
              <Photo person={child} className="pa-hero-photo" />
              <div className="pa-hero-text">
                <h1>{child.name}</h1>
                <p className="pa-class">
                  {child.class && gradeLabel(child.class)}
                  {child.section && <span className="pa-section"> · {child.section}</span>}
                </p>
                {child.admission_no && <p className="pa-adm">#{child.admission_no}</p>}
                <TodayAttendance key={child.id} child={child} />
              </div>
            </section>

            <nav className="ig-tabs pa-tabs" aria-label="Sections">
              {TABS.map(([v, l, icon]) => (
                <button key={v} className={lit === v ? "is-on" : ""} onClick={() => setTab(v)} aria-current={lit === v ? "page" : undefined}>
                  <span className="pa-tab-icon">
                    <Icon name={icon} size={20} weight={lit === v ? "fill" : "regular"} />
                    {lit !== v && badge(count(child.id, v), l.toLowerCase())}
                  </span>
                  <span>{l}</span>
                </button>
              ))}
            </nav>

            {/* Phones: the same sections in a bottom bar, like the staff app. */}
            <nav className="tabbar" aria-label="Sections">
              <GlassPill index={Math.max(0, TABS.findIndex(([v]) => v === lit))} count={TABS.length} />
              {TABS.map(([v, l, icon]) => (
                <button key={v} className={lit === v ? "active" : ""} aria-current={lit === v ? "page" : undefined} onClick={() => setTab(v)}>
                  <Icon name={icon} size={22} className="tab-icon" weight={lit === v ? "fill" : "regular"} />
                  <span className="tab-label">{l}</span>
                  {lit !== v && count(child.id, v) > 0 && <span className="seg-count">{count(child.id, v) > 99 ? "99+" : count(child.id, v)}</span>}
                </button>
              ))}
            </nav>

            {tab === "calendar" && (
              <>
                <div className="pa-page-head">
                  <button className="back-btn" onClick={() => setTab("home")} aria-label="Back to Home" title="Back">
                    <Icon name="chevronLeft" size={22} />
                  </button>
                  <h2 className="nb-page-title">
                    <Icon name="calendar" /> Calendar
                  </h2>
                </div>
                <CalendarPage schoolId={child.school_id} onOpenNotices={() => setTab("notices")} />
              </>
            )}
            {tab === "notices" && (
              <>
                <div className="pa-page-head">
                  <button className="back-btn" onClick={() => setTab("home")} aria-label="Back to Home" title="Back">
                    <Icon name="chevronLeft" size={22} />
                  </button>
                  <h2 className="nb-page-title">
                    <Icon name="notice" /> Noticeboard
                  </h2>
                </div>
                <NoticeBoard schoolId={child.school_id} since={since} />
              </>
            )}
            {tab === "home" && <NotifyPrompt text="Get notified about school messages and notices." />}
            {tab === "home" && <ParentHome key={child.id} child={child} news={(v) => count(child.id, v)} onGo={setTab} />}
            {tab === "fees" && <FeesTab key={child.id} child={child} since={since} />}
            {tab === "results" && <ResultsTab key={child.id} child={child} since={since} />}
            {tab === "homework" && <HomeworkTab key={child.id} child={child} since={since} />}
            {tab === "datesheet" && <DatesheetTab key={child.id} child={child} since={since} />}
            {tab === "inbox" && <MessagesTab key={child.id} child={child} phone={phone} onClose={() => setTab("home")} />}
          </>
        )}
        </>
        )}
      </main>
    </div>
  );
}

// ----------------------------------------------------------------- home ---

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};
const plural = (k, word) => `${k} ${word}${k === 1 ? "" : "s"}`;

// Home for a parent, like the staff Home: what needs them now (tap to go
// there) and a card per part of the child's school life. Each card fills in
// as its data arrives.
function ParentHome({ child, news, onGo }) {
  const [fees, setFees] = useState(null);
  const [results, setResults] = useState(null);
  const [homework, setHomework] = useState(null);
  useEffect(() => {
    parentFees(child.id, child.school_id).then(setFees, () => setFees(false));
    (child.session ? listResults(child.id, child.session.id) : Promise.resolve([])).then(setResults, () => setResults(false));
    childHomework(child.id).then(setHomework, () => setHomework(false));
  }, [child.id, child.school_id, child.session]);

  const now = today();
  // Fees
  const open = fees ? fees.dues.filter((d) => Number(d.balance) > 0.009) : [];
  const dueNow = open.filter((d) => !d.due_date || d.due_date <= now);
  const overdue = dueNow.filter((d) => d.due_date && d.due_date < now);
  const dueTotal = dueNow.reduce((t, d) => t + Number(d.balance), 0);
  const next = open.filter((d) => d.due_date && d.due_date > now).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  const paid = fees ? fees.payments.filter((p) => p.status === "success").reduce((t, p) => t + Number(p.amount), 0) : 0;
  const openTotal = open.reduce((t, d) => t + Number(d.balance), 0);

  // Latest exam
  const exam = useMemo(() => {
    if (!results || !results.length) return null;
    const m = new Map();
    for (const row of results) m.set(row.exam, [...(m.get(row.exam) ?? []), row]);
    const [name, rows] = [...m].sort(
      (a, b) => Math.max(...b[1].map((x) => Date.parse(x.updated_at) || 0)) - Math.max(...a[1].map((x) => Date.parse(x.updated_at) || 0))
    )[0];
    const scored = rows.filter((x) => x.marks != null && Number(x.max_marks) > 0).map((x) => ({ ...x, pct: (Number(x.marks) / Number(x.max_marks)) * 100 }));
    const got = scored.reduce((t, x) => t + Number(x.marks), 0);
    const max = scored.reduce((t, x) => t + Number(x.max_marks), 0);
    const sorted = [...scored].sort((a, b) => b.pct - a.pct);
    return { name, pct: max ? Math.round((got / max) * 100) : null, best: sorted[0], low: sorted.length > 1 ? sorted[sorted.length - 1] : null };
  }, [results]);

  // Homework
  const hw = homework || [];
  const hwToday = hw.filter((h) => h.due_date === now).length;
  const tomorrow = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const hwTomorrow = hw.filter((h) => h.due_date === tomorrow).length;
  const hwUpcoming = hw.filter((h) => h.due_date && h.due_date >= now).length;

  const unread = news("inbox");
  const go = (to) => () => onGo(to);

  // Fees, the wide tile: what's due now (red when overdue, amber when due,
  // green when all paid) and a ring of how much of the year is paid.
  const overdueTotal = overdue.reduce((t, d) => t + Number(d.balance), 0);
  const paidPct = paid + openTotal > 0 ? Math.round((paid / (paid + openTotal)) * 100) : null;
  const feeTone = overdue.length ? "red" : dueTotal ? "amber" : "green";

  // The top card: what this parent should do next. Overdue fees first,
  // then homework due today or tomorrow, then fees due now. Whatever it
  // shows leaves the tiles below, so nothing repeats.
  const hwSoon = hwToday + hwTomorrow;
  const prio = overdue.length ? "fees" : hwSoon ? "homework" : dueTotal ? "fees" : null;
  const priority =
    prio === "fees"
      ? {
          tone: overdue.length ? "red" : "amber",
          urgent: overdue.length > 0,
          icon: "rupee",
          title: overdue.length ? `${rupees(overdueTotal)} overdue` : `${rupees(dueTotal)} due`,
          sub: next ? `Next: ${rupees(next.balance)} on ${dateText(next.due_date, { day: "numeric", month: "short" })}` : plural(dueNow.length, "fee"),
          pct: paidPct,
          cta: "View fees",
          onClick: go("fees"),
        }
      : prio === "homework"
      ? {
          tone: "teal",
          icon: "book",
          title: hwToday ? `${hwToday} homework due today` : `${hwTomorrow} homework due tomorrow`,
          sub: hwToday && hwTomorrow ? `${hwTomorrow} more due tomorrow` : `${hwUpcoming} still to hand in`,
          cta: "See homework",
          onClick: go("homework"),
        }
      : null;

  // One tile each, with a red badge for anything new or waiting.
  const tiles = [
    results !== false && {
      key: "results",
      icon: "chart",
      tone: "violet",
      label: exam ? exam.name : "Results",
      value: results === null ? undefined : exam?.pct ?? "–",
      format: (v) => `${v}%`,
      badge: news("results"),
      badgeLabel: `${plural(news("results"), "new result")}`,
      onClick: go("results"),
    },
    homework !== false && prio !== "homework" && {
      key: "homework",
      icon: "book",
      tone: "teal",
      label: "Homework",
      value: homework === null ? undefined : hwUpcoming,
      badge: hwToday + hwTomorrow,
      badgeLabel: `${hwToday} due today, ${hwTomorrow} due tomorrow`,
      onClick: go("homework"),
    },
    {
      key: "inbox",
      icon: "plane",
      tone: "indigo",
      label: unread ? "New messages" : "Messages",
      value: unread,
      hot: unread > 0,
      onClick: go("inbox"),
    },
  ].filter(Boolean);

  return (
    <div className="home hw pa-home">
      <header className="home-hero">
        <p className="home-date">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1>{greeting()}</h1>
      </header>

      {priority && (
        <div className="home-row1 is-solo">
          <PriorityCard {...priority} />
        </div>
      )}

      <div className="hw-grid">
        {fees !== false && prio !== "fees" && (
          <WideTile
            tone={fees === null ? "indigo" : feeTone}
            hot={overdue.length > 0}
            kicker="Fees"
            title={fees === null ? "…" : dueTotal ? `${rupees(dueTotal)} due` : "All paid"}
            sub={
              fees === null
                ? ""
                : overdue.length
                ? `${rupees(overdueTotal)} overdue`
                : next
                ? `Next: ${rupees(next.balance)} on ${dateText(next.due_date, { day: "numeric", month: "short" })}`
                : dueTotal
                ? plural(dueNow.length, "fee")
                : "Nothing due right now"
            }
            pct={paidPct}
            icon="rupee"
            onClick={go("fees")}
          />
        )}
        {tiles.map((t, i) => (
          <Tile key={t.key} {...t} index={i} />
        ))}
      </div>

      <ComingUp schoolId={child.school_id} onOpenCalendar={() => onGo("calendar")} onOpenNotices={() => onGo("notices")} />
    </div>
  );
}

// Newer than the parent's last visit to this section (never on a first visit,
// when everything would be "new").
const isNew = (when, since) => Boolean(when && since && when > since);
const NewTag = () => <span className="pa-new-tag">New</span>;

// "Today: Present" and this month's tally, on the child's card.
const MARK_TEXT = { present: "Present", absent: "Absent", late: "Late", leave: "On leave" };
function TodayAttendance({ child }) {
  const [days, setDays] = useState(null);
  useEffect(() => {
    attendanceMonth(child.id, today()).then(setDays, () => setDays([]));
  }, [child.id]);
  if (!days) return null;
  const t = days.find((d) => d.day === today());
  const present = days.filter((d) => d.status === "present" || d.status === "late").length;
  return (
    <div className="pa-att">
      <span className={`pa-att-today is-${t?.status ?? "none"}`}>Today: {t ? MARK_TEXT[t.status] : "Not marked yet"}</span>
      {days.length > 0 && (
        <span className="row-sub">
          {present}/{days.length} days this month
        </span>
      )}
    </div>
  );
}

// Top right: the parent's number, Change password and Log out, in one menu.
function ParentMenu({ phone, onPassword }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, useCallback(() => setOpen(false), []));
  return (
    <div className="popover-anchor" ref={ref}>
      <button className="avatar-btn" aria-label="Account" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="settings" size={18} />
      </button>
      {open && (
        <div className="menu menu-right" role="menu">
          <div className="menu-header">
            <div className="menu-title">{showPhone(phone)}</div>
          </div>
          <button
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              onPassword();
            }}
          >
            <Icon name="edit" />
            Change password
          </button>
          <NotifyMenuItem />
          <button role="menuitem" className="menu-item" onClick={logOut}>
            <Icon name="logout" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

// A parent sets their own password (8+ characters). After this the starting
// password (child's name + birth year) no longer works for them.
// required: the first-sign-in version, which can't be skipped.
function ChangePassword({ onDone, required = false }) {
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function save(e) {
    e.preventDefault();
    if (pw.length < 8) return setError("Use at least 8 characters.");
    if (pw !== again) return setError("The two passwords don’t match.");
    setBusy(true);
    setError("");
    try {
      await setParentPassword(pw);
      setDone(true);
    } catch {
      setError("Couldn’t change the password. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <section className="pa-card pa-pw">
        <p className="pa-pw-done">
          <Icon name="check" size={16} /> {required ? "All set. Use this password next time you log in." : "Password changed. Use your new password next time you log in."}
        </p>
        <button className={`btn btn-sm ${required ? "btn-primary" : "btn-secondary"}`} onClick={onDone}>
          {required ? "Continue" : "Done"}
        </button>
      </section>
    );

  return (
    <form className="pa-card pa-pw pa-form" onSubmit={save}>
      <h2 className="pa-h2">{required ? "Set your password" : "Choose your own password"}</h2>
      <p className="row-sub">
        {required
          ? "You signed in with your child’s name and birth year. Choose your own password to keep your child’s details safe."
          : "Safer than your child’s name and birth year. After this, only the new password works."}
      </p>
      <label>
        <span>New password</span>
        <input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} />
      </label>
      <label>
        <span>Type it again</span>
        <input className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
      </label>
      {error && <p className="field-error">{error}</p>}
      <div className="pa-form-foot">
        {!required && (
          <button type="button" className="btn btn-secondary" onClick={onDone}>
            Cancel
          </button>
        )}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save password"}
        </button>
      </div>
    </form>
  );
}

function NotLinked({ phone }) {
  return (
    <section className="pa-card pa-empty">
      <span className="pa-empty-icon">
        <Icon name="phone" size={22} />
      </span>
      <h1>We couldn’t find your child</h1>
      <p className="row-sub">
        {showPhone(phone)} isn’t linked to a student yet. Ask the school office to add this number as a parent in your
        child’s profile, then log in again.
      </p>
      <button className="btn btn-secondary" onClick={logOut}>
        Use a different number
      </button>
    </section>
  );
}

function useLoad(load) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const run = useCallback(() => {
    load().then(
      (d) => (setData(d), setError("")),
      () => setError("Couldn’t load this. Check your connection and try again.")
    );
  }, [load]);
  useEffect(run, [run]);
  return { data, error, reload: run };
}

// ----------------------------------------------------------------- fees ---

function FeesTab({ child, since }) {
  const load = useCallback(() => parentFees(child.id, child.school_id), [child.id, child.school_id]);
  const { data, error } = useLoad(load);
  const [receipt, setReceipt] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const view = useMemo(() => {
    if (!data) return null;
    const now = today();
    const open = data.dues.filter((d) => Number(d.balance) > 0.009);
    const dueNow = open.filter((d) => !d.due_date || d.due_date <= now);
    const upcoming = open.filter((d) => d.due_date && d.due_date > now);
    const paid = data.payments.filter((p) => p.status === "success");
    const session = child.session;
    const inSession = (d) => !session || ((!session.starts_on || d >= session.starts_on) && (!session.ends_on || d <= session.ends_on));
    return {
      dueNow,
      upcoming,
      payments: data.payments,
      dueTotal: dueNow.reduce((t, d) => t + Number(d.balance), 0),
      paidTotal: paid.filter((p) => inSession(p.paid_on)).reduce((t, p) => t + Number(p.amount), 0),
    };
  }, [data, child.session]);

  if (error) return <p className="notice notice-error">{error}</p>;
  if (!view) return <div className="pa-card pa-skeleton" aria-busy="true" />;

  const later = showAll ? view.upcoming : view.upcoming.slice(0, 3);
  return (
    <>
      {/* Each card carries its own total, so there's no separate summary. */}
      {view.dueNow.length > 0 ? (
        <section className="pa-card">
          <h2 className="pa-h2 pa-h2-total">
            Due now <strong className="is-due">{rupees(view.dueTotal)}</strong>
          </h2>
          <ul className="pa-list">
            {view.dueNow.map((d) => (
              <DueRow key={d.id} due={d} overdue={d.due_date && d.due_date < today()} fresh={isNew(d.created_at, since)} />
            ))}
          </ul>
          <p className="pa-hint">
            <Icon name="check" size={14} /> Pay at the school office for now.
          </p>
        </section>
      ) : (
        <section className="pa-card pa-clear">
          <Icon name="check" size={16} /> Nothing due right now
        </section>
      )}

      {view.upcoming.length > 0 && (
        <section className="pa-card">
          <h2 className="pa-h2">Coming up</h2>
          <ul className="pa-list">
            {later.map((d) => (
              <DueRow key={d.id} due={d} fresh={isNew(d.created_at, since)} />
            ))}
          </ul>
          {view.upcoming.length > 3 && (
            <button className="link-btn pa-more" onClick={() => setShowAll((s) => !s)}>
              {showAll ? "Show fewer" : `Show all ${view.upcoming.length}`}
            </button>
          )}
        </section>
      )}

      {view.payments.length > 0 && (
      <section className="pa-card">
        <h2 className="pa-h2 pa-h2-total">
          Paid {view.paidTotal > 0 && <strong className="is-paid">{rupees(view.paidTotal)}</strong>}
        </h2>
        {view.payments.length ? (
          <ul className="pa-list">
            {view.payments.map((p) => (
              <li key={p.id} className="pa-row">
                <span className="pa-row-icon is-paid">
                  <Icon name="check" size={14} />
                </span>
                <span className="pa-row-main">
                  <strong>
                    {rupees(p.amount)} {isNew(p.created_at, since) && <NewTag />}
                  </strong>
                  <span className="row-sub">
                    {dateText(p.paid_on)} · {METHODS[p.method] ?? p.method} · <span className="pa-nowrap">{p.receipt_no}</span>
                    {p.status === "cancelled" && " · Cancelled"}
                  </span>
                </span>
                <button className="btn btn-secondary btn-sm" onClick={() => setReceipt(p)}>
                  <Icon name="file" /> Receipt
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      )}

      {receipt && <Receipt school={child.school} person={child} payment={receipt} dues={data.dues} onClose={() => setReceipt(null)} />}
    </>
  );
}

function DueRow({ due, overdue, fresh }) {
  return (
    <li className="pa-row">
      <span className={`pa-row-icon${overdue ? " is-overdue" : " is-due"}`}>₹</span>
      <span className="pa-row-main">
        <strong>
          {[due.head_name ?? "Fee", due.label].filter(Boolean).join(" · ")} {fresh && <NewTag />}
        </strong>
        <span className="row-sub">
          {due.due_date ? `Due ${dateText(due.due_date)}` : "Due now"}
          {Number(due.paid) > 0 && ` · ${rupees(due.paid)} paid`}
        </span>
      </span>
      <span className="pa-row-amount">
        {rupees(due.balance)}
        {overdue && <span className="badge badge-danger">Overdue</span>}
      </span>
    </li>
  );
}

// -------------------------------------------------------------- results ---

function ResultsTab({ child, since }) {
  const load = useCallback(() => (child.session ? listResults(child.id, child.session.id) : Promise.resolve([])), [child.id, child.session]);
  const { data, error } = useLoad(load);

  const exams = useMemo(() => {
    const m = new Map();
    for (const r of data ?? []) m.set(r.exam, [...(m.get(r.exam) ?? []), r]);
    return [...m];
  }, [data]);

  if (error) return <p className="notice notice-error">{error}</p>;
  if (!data) return <div className="pa-card pa-skeleton" aria-busy="true" />;
  if (!exams.length) return <Empty icon="edit" title="No results yet" text="Marks appear here once the school enters them." />;

  return exams.map(([exam, rows]) => {
    const scored = rows.filter((r) => r.marks != null && r.max_marks);
    const got = scored.reduce((t, r) => t + Number(r.marks), 0);
    const max = scored.reduce((t, r) => t + Number(r.max_marks), 0);
    const pct = max ? Math.round((got / max) * 1000) / 10 : null;
    return (
      <section key={exam} className="pa-card">
        <div className="pa-exam-head">
          <h2 className="pa-h2">{exam}</h2>
          {pct != null && <span className="pa-pct">{pct}%</span>}
        </div>
        <table className="pa-table">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Marks</th>
              <th>Grade</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.subject} {isNew(r.updated_at, since) && <NewTag />}
                  {r.remarks && <span className="row-sub pa-remark">{r.remarks}</span>}
                </td>
                <td className="pa-num">
                  {r.marks ?? "–"}
                  {r.max_marks ? <span className="row-sub"> / {Number(r.max_marks)}</span> : null}
                </td>
                <td>{r.grade || ""}</td>
              </tr>
            ))}
          </tbody>
          {max > 0 && (
            <tfoot>
              <tr>
                <th>Total</th>
                <th className="pa-num">
                  {got} <span className="row-sub">/ {max}</span>
                </th>
                <th />
              </tr>
            </tfoot>
          )}
        </table>
      </section>
    );
  });
}

// ------------------------------------------------------- homework & syllabus ---

function HomeworkTab({ child, since }) {
  const [view, setView] = useState("homework");
  const loadHomework = useCallback(() => childHomework(child.id), [child.id]);
  const loadSyllabus = useCallback(() => childSyllabus(child.id), [child.id]);
  const hw = useLoad(loadHomework);
  const syll = useLoad(loadSyllabus);
  const { data, error } = view === "homework" ? hw : syll;
  const now = today();
  const due = (d) => (!d ? "" : d < now ? "Was due" : d === now ? "Due today" : `Due ${dateText(d, { weekday: "short", day: "numeric", month: "short" })}`);

  return (
    <>
      <nav className="segmented segmented-sm ds-tabs" aria-label="Homework or syllabus">
        <button className={view === "homework" ? "active" : ""} onClick={() => setView("homework")}>
          <Icon name="book" size={15} /> Homework
        </button>
        <button className={view === "syllabus" ? "active" : ""} onClick={() => setView("syllabus")}>
          <Icon name="academics" size={15} /> Syllabus
        </button>
      </nav>
      {error ? (
        <p className="notice notice-error">{error}</p>
      ) : !data ? (
        <div className="pa-card pa-skeleton" aria-busy="true" />
      ) : !data.length ? (
        view === "homework" ? (
          <Empty icon="book" title="No homework yet" text="Homework from the teachers appears here as soon as it’s given." />
        ) : (
          <Empty icon="academics" title="No syllabus posted yet" text="The syllabus appears here as soon as the teacher posts it." />
        )
      ) : view === "homework" ? (
        <ul className="pa-hw">
          {data.map((h) => (
            <li key={h.id} className={`pa-card pa-hw-item${isNew(h.created_at, since) ? " is-new" : ""}`}>
              <div className="pa-hw-head">
                <strong>{h.subject || "Homework"}</strong>
                {isNew(h.created_at, since) && <NewTag />}
                {h.just_some && <span className="badge badge-brand">Just for {child.name.split(" ")[0]}</span>}
                {h.due_date && <span className={`pa-hw-due${h.due_date <= now ? " is-soon" : ""}`}>{due(h.due_date)}</span>}
              </div>
              <p className="pa-hw-body">{h.body}</p>
              <span className="row-sub">
                Given {dateText(h.created_at, { day: "numeric", month: "short" })}
                {h.author_name ? ` by ${h.author_name}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="pa-hw">
          {data.map((y) => (
            <li key={y.id} className={`pa-card pa-hw-item${isNew(y.created_at, since) ? " is-new" : ""}`}>
              <div className="pa-hw-head">
                <strong>{y.subject}</strong>
                {isNew(y.created_at, since) && <NewTag />}
              </div>
              <p className="pa-hw-body">{y.body}</p>
              {y.author_name && <span className="row-sub">By {y.author_name}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ------------------------------------------------------------- datesheet ---

function DatesheetTab({ child, since }) {
  const load = useCallback(() => childDatesheet(child.id), [child.id]);
  const { data, error } = useLoad(load);
  if (error) return <p className="notice notice-error">{error}</p>;
  if (!data) return <div className="pa-card pa-skeleton" aria-busy="true" />;
  if (!data.length) return <Empty icon="exam" title="No exams on the datesheet yet" text="The exam schedule appears here as soon as the school sets it." />;
  return (
    <ul className="pa-hw">
      {data.map((d) => (
        <li key={d.id} className={`pa-card pa-hw-item${isNew(d.created_at, since) ? " is-new" : ""}`}>
          <div className="pa-hw-head">
            <strong>{d.subject}</strong>
            {isNew(d.created_at, since) && <NewTag />}
            <span className="badge badge-brand">{d.exam_name}</span>
          </div>
          <p className="pa-hw-body">
            {dateText(d.exam_date, { weekday: "short", day: "numeric", month: "short" })}
            {d.start_time ? ` · ${d.start_time}` : ""}
            {d.notes ? ` · ${d.notes}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------- messages ---

const CERTIFICATES = ["Bonafide certificate", "Character certificate", "Transfer certificate", "Fee certificate", "Other"];

// The child's conversation with the school (teachers and office), with
// Leave and Certificate buttons that send a request card into it.
// Phones: a screen of its own (Back returns to Home), with the child at the
// top. Computers: in the page, under the child.
function MessagesTab({ child, phone, onClose }) {
  const [form, setForm] = useState(null); // "leave" | "certificate"
  const [tick, setTick] = useState(0);
  const me = `+91${String(phone).replace(/\D/g, "").slice(-10)}`;
  const close = useBackToClose(true, onClose);
  return (
    <>
      {form && <RequestForm child={child} kind={form} onCancel={() => setForm(null)} onSent={() => (setForm(null), setTick((t) => t + 1))} />}
      <section className="pa-chat">
        <Chat
          screen
          studentId={child.id}
          viewer="parent"
          me={me}
          refreshKey={tick}
          headOnPhone
          head={
            <>
              <button className="btn-icon chat-back" onClick={close} aria-label="Back to Home">
                <Icon name="arrowLeft" size={20} />
              </button>
              <span className="inbox-who">
                <Photo person={child} className="inbox-photo" />
                <span className="inbox-main">
                  <strong>{child.name}</strong>
                  <span className="row-sub">Teachers and school office</span>
                </span>
              </span>
            </>
          }
          actions={
            <span className="chat-actions">
              <button type="button" className="chat-chip" onClick={() => setForm("leave")}>
                <Icon name="plus" size={14} /> Leave
              </button>
              <button type="button" className="chat-chip" onClick={() => setForm("certificate")}>
                <Icon name="plus" size={14} /> Certificate
              </button>
            </span>
          }
        />
      </section>
    </>
  );
}

// Leave or certificate request; it appears in the conversation as a card.
function RequestForm({ child, kind, onCancel, onSent }) {
  const [form, setForm] = useState({ kind, subject: "", body: "", leave_from: today(), leave_to: today(), certificate_type: CERTIFICATES[0] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const first = child.name.split(" ")[0];

  function subjectFor(f) {
    if (f.subject.trim()) return f.subject.trim();
    if (f.kind === "leave") return `Leave for ${first}`;
    if (f.kind === "certificate") return `${f.certificate_type} for ${first}`;
    return "";
  }

  async function submit(e) {
    e.preventDefault();
    const subject = subjectFor(form);
    if (!subject) return setError("Add a subject for your message.");
    if (form.kind === "leave" && form.leave_to < form.leave_from) return setError("The last day can’t be before the first day.");
    setBusy(true);
    setError("");
    try {
      await createParentRequest(child.id, {
        kind: form.kind,
        subject,
        body: form.body.trim(),
        leave_from: form.kind === "leave" ? form.leave_from : null,
        leave_to: form.kind === "leave" ? form.leave_to : null,
        certificate_type: form.kind === "certificate" ? form.certificate_type : null,
      });
      onSent();
    } catch {
      setError("Couldn’t send the request. Please try again.");
      setBusy(false);
    }
  }

  // A sheet over the conversation (phones: from the bottom).
  return (
    <div className="modal-backdrop" onClick={onCancel}>
    <form className="modal pa-card pa-form pa-request-sheet" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
      <h2 className="pa-h2">{kind === "leave" ? `Leave for ${first}` : `Certificate for ${first}`}</h2>
      {form.kind === "leave" && (
        <div className="pa-dates">
          <label>
            <span>From</span>
            <input type="date" className="input" value={form.leave_from} onChange={set("leave_from")} required />
          </label>
          <label>
            <span>To</span>
            <input type="date" className="input" value={form.leave_to} min={form.leave_from} onChange={set("leave_to")} required />
          </label>
        </div>
      )}
      {form.kind === "certificate" && (
        <label>
          <span>Certificate</span>
          <select className="select" value={form.certificate_type} onChange={set("certificate_type")}>
            {CERTIFICATES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      )}
      <label>
        <span>{form.kind === "leave" ? "Reason" : "Details"}</span>
        <textarea className="textarea" rows={3} value={form.body} onChange={set("body")} maxLength={2000} />
      </label>
      {error && <p className="field-error">{error}</p>}
      <div className="pa-form-foot">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
    </div>
  );
}

function Empty({ icon, title, text }) {
  return (
    <section className="pa-card pa-empty">
      <span className="pa-empty-icon">
        <Icon name={icon} size={20} />
      </span>
      <strong>{title}</strong>
      <p className="row-sub">{text}</p>
    </section>
  );
}
