import { useEffect, useRef, useState } from "react";
import { listHomework, loadEmployees, staffInbox, withPhotoUrls } from "../data/api.js";
import { peek, swr } from "../data/cache.js";
import { rupeesShort } from "../data/money.js";
import { CountUp } from "./StatCards.jsx";
import { Tile } from "./Widgets.jsx";
import { ComingUp } from "./CalendarPage.jsx";
import { CATEGORY, showsImage, useImageUrls, useNotices } from "./NoticeBoard.jsx";
import Icon from "./Icon.jsx";

const n = (v) => Number(v || 0).toLocaleString("en-IN");
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};
const dateText = (d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

// Home, like phone widgets: a greeting, today's attendance next to the
// noticeboard as a banner to swipe through, a colourful tile
// for each part of the app (one number and one word), students' wins
// (News & Achievements), then what's coming up beside a small calendar,
// and quick actions. Anything waiting on this
// person shows as a red badge on its tile (overdue fees, open requests,
// staff waiting for access…). Uses the same remembered data as the pages,
// so it's quick and the pages open already filled.
// Nothing shows twice: a notice is either in the banner or among the wins,
// and the quick actions are the + menu's (computers only; phones have the +).
// Each role sees what it acts on: owners and admins get numbers and tasks
// (notices are a tile for them, wins live on the Noticeboard); the
// principal also gets the notice banner; teachers get the banner and the
// students' wins.
export default function HomePage({ school, me, name, role, students, loading, session, today, pendingCount, actions = [], onAction, onGo }) {
  const isAdmin = role === "owner" || role === "admin";
  const leads = isAdmin || role === "principal";
  const isOwner = role === "owner";
  const showBanner = !isAdmin;
  const showWins = role === "teacher";
  const [threads, setThreads] = useState(() => peek(`inbox:${school.id}`) ?? null);
  const [homework, setHomework] = useState(() => (session ? peek(`homework:${session.id}`) ?? null : null));
  const staffKey = `people:employees:${school.id}:`;
  const [staff, setStaff] = useState(() => peek(staffKey) ?? null);
  const [notices] = useNotices(school.id);
  const urls = useImageUrls(notices);
  const wins = (notices ?? []).filter(isWin);
  const plain = (notices ?? []).filter((x) => !isWin(x));

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

  // One tile per part of the app: a number and a word. badge: what's
  // waiting on this person there; hot: something new, the tile glows.
  const go = (to) => () => onGo(to);
  const tiles = [
    {
      key: "inbox",
      icon: "plane",
      tone: "violet",
      label: "Unread Messages",
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
      label: "New Homework",
      value: homework === null ? undefined : thisWeek,
      badge: leads ? 0 : dueTomorrow,
      badgeLabel: `${dueTomorrow} due tomorrow`,
      onClick: go("homework"),
    },
    leads && {
      key: "staff",
      icon: "idcard",
      tone: "pink",
      label: "Staff Members",
      value: staff === null ? undefined : staff.length,
      badge: isOwner ? pendingCount : 0,
      badgeLabel: `${pendingCount} waiting for access`,
      onClick: go(isOwner && pendingCount ? "access" : "employees"),
    },
    { key: "students", icon: "scholar", tone: "indigo", label: leads ? "Students" : "My students", value: loading ? undefined : students.length, onClick: go("students") },
    isAdmin && {
      key: "fees",
      icon: "rupee",
      tone: due > 0 ? "amber" : "green",
      label: "Fees Due",
      value: loading ? undefined : due,
      format: rupeesShort,
      badge: overdue,
      badgeLabel: `${n(overdue)} students overdue`,
      onClick: go("fees"),
    },
    isAdmin && { key: "notices", icon: "notice", tone: "orange", label: "Notices", value: notices === null ? undefined : notices.length, onClick: go("notices") },
  ].filter(Boolean);

  // Today's attendance: green, amber or red by how many are in; indigo
  // (and glowing) while it still needs marking.
  const showToday = leads || today;
  const unmarked = today && today.marked === 0;
  const attTone = attPct === null ? "indigo" : attPct >= 90 ? "green" : attPct >= 75 ? "amber" : "red";
  const left = today?.notMarked ?? 0;

  // The + menu's actions, less what a card above already offers.
  const quickActions = actions.filter(([key]) => !(key === "attendance" && showToday));
  // The banner shows while there are plain notices (or they're loading).
  const banner = showBanner && (notices === null || plain.length > 0);

  const first = (name || me || "").split(/[\s@]/)[0];
  return (
    <div className="home hw home-staff">
      <header className="home-hero">
        <p className="home-date">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1>
          {greeting()}
          {first ? `, ${first.charAt(0).toUpperCase()}${first.slice(1)}` : ""}
        </h1>
      </header>

      {(showToday || banner) && (
        <div className={`home-row1${showToday && banner ? "" : " is-solo"}`}>
          {showToday && (
            <AttendanceCard
              tone={attTone}
              hot={unmarked || left > 0}
              marked={today === null ? null : today?.marked}
              present={today?.present}
              pct={attPct}
              left={left}
              onClick={go("attendance")}
            />
          )}
          {banner && <NoticeBanner notices={notices === null ? null : plain} urls={urls} onOpenNotices={go("notices")} />}
        </div>
      )}

      {/* Tiles fill whole rows: all in one row on wide screens, two even rows on smaller ones */}
      <div className="hw-grid" style={{ "--n": tiles.length, "--half": Math.ceil(tiles.length / 2) }}>
        {tiles.map((t, i) => (
          <Tile key={t.key} {...t} index={i} />
        ))}
      </div>

      {showWins && <AchievementsStrip items={wins} urls={urls} viewAll={!banner} onOpenNotices={go("notices")} />}

      <div className={`home-bottom-row${quickActions.length ? "" : " is-solo"}`}>
        <ComingUp schoolId={school.id} staff calendar withNotices={false} limit={4} onOpenCalendar={go("calendar")} onOpenNotices={go("notices")} />
        <QuickActionsPanel actions={quickActions} onAction={onAction} />
      </div>
    </div>
  );
}

// Today's attendance: a card beside the notice banner, or a slim strip when
// it's alone in the row. marked: null while loading, 0 while nothing's in yet.
function AttendanceCard({ tone, hot, marked, present, pct, left, onClick }) {
  return (
    <div className={`home-att t-${tone}${hot ? " is-hot" : ""}`}>
      <span className="home-att-icon">
        <Icon name="register" size={20} weight="fill" />
      </span>
      <span className="home-att-text">
        <strong className="home-att-title">
          {marked === null ? "…" : marked ? (
            <>
              <CountUp to={present} /> present
            </>
          ) : (
            "Today’s Attendance"
          )}
        </strong>
        <span className="home-att-sub">{marked === null ? "" : !marked ? "Not marked yet" : left ? `${left} class${left === 1 ? "" : "es"} left to mark` : "All classes marked"}</span>
        {marked > 0 && (
          <span className="home-att-bar">
            <span className="home-att-bar-fill" style={{ width: `${pct ?? 0}%` }} />
          </span>
        )}
      </span>
      <button type="button" className="home-att-cta" onClick={onClick}>
        {marked ? "View attendance" : "Take attendance"}
        <Icon name="arrowRight" size={14} />
      </button>
    </div>
  );
}

// The noticeboard, as a banner to swipe through (one notice at a time, with
// its picture if it has one). Autoplays gently; tapping it, the arrows, or
// a dot all work the same way phone banners do. notices: null while loading.
function NoticeBanner({ notices, urls, onOpenNotices }) {
  const slides = (notices ?? []).slice(0, 6);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (idx >= slides.length) setIdx(0);
  }, [slides.length, idx]);
  useEffect(() => {
    if (slides.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % slides.length), 6000);
    return () => clearInterval(t);
  }, [slides.length]);

  const current = slides[idx];
  const image = current && showsImage(current) ? urls.get(current.image_path) : null;
  const shift = (by, e) => {
    e.stopPropagation();
    setIdx((i) => (i + by + slides.length) % slides.length);
  };

  return (
    <section className="home-notice">
      <header className="home-notice-head">
        <span className="home-notice-icon">
          <Icon name="notice" size={18} weight="fill" />
        </span>
        <span className="home-notice-text">
          <strong>Notice Board</strong>
        </span>
        <button type="button" className="home-section-all home-notice-cta" onClick={onOpenNotices}>
          View all <Icon name="arrowRight" size={13} />
        </button>
      </header>

      {notices === null ? (
        <div className="home-notice-slide is-empty">
          <div className="nb-skeleton" aria-busy="true" />
        </div>
      ) : (
        <div className="home-notice-wrap">
          {slides.length > 1 && (
            <button type="button" className="home-notice-nav is-prev" onClick={(e) => shift(-1, e)} aria-label="Previous notice">
              <Icon name="chevronLeft" size={16} />
            </button>
          )}
          <div className="home-notice-slide" onClick={onOpenNotices} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpenNotices()} role="button" tabIndex={0}>
            <div className="home-notice-copy">
              {current.event_on && <span className="home-notice-date">{dateText(current.event_on)}</span>}
              <strong>{current.title}</strong>
              {current.body && <p>{current.body}</p>}
            </div>
            {image ? (
              <img className="home-notice-pic" src={image} alt="" loading="lazy" />
            ) : (
              <span className="home-notice-pic home-notice-pic-icon">
                <Icon name="notice" size={34} />
              </span>
            )}
          </div>
          {slides.length > 1 && (
            <button type="button" className="home-notice-nav is-next" onClick={(e) => shift(1, e)} aria-label="Next notice">
              <Icon name="chevronRight" size={16} />
            </button>
          )}
        </div>
      )}
      {slides.length > 1 && (
        <div className="home-notice-dots">
          {slides.map((s, i) => (
            <span key={s.id} className={i === idx ? "is-on" : ""} />
          ))}
        </div>
      )}
    </section>
  );
}

// Students' wins, posted the same way as any notice (just tagged with a
// category and a picture). Nothing to show yet: the section just stays
// off the page, rather than taking up room with an empty box. viewAll:
// only when the banner (which has its own) is off the page.
const isWin = (x) => Boolean(x.category) && showsImage(x);

function AchievementsStrip({ items, urls, viewAll, onOpenNotices }) {
  const rowRef = useRef(null);
  if (!items.length) return null;
  const scroll = (dir) => rowRef.current?.scrollBy({ left: dir * 280, behavior: "smooth" });

  return (
    <section className="home-news">
      <header className="home-notice-head">
        <span className="home-news-icon">
          <Icon name="trophy" size={18} weight="fill" />
        </span>
        <span className="home-notice-text">
          <strong>News &amp; Achievements</strong>
        </span>
        {viewAll && (
          <button type="button" className="home-section-all" onClick={onOpenNotices}>
            View all <Icon name="arrowRight" size={13} />
          </button>
        )}
      </header>
      <div className="home-news-wrap">
        {items.length > 2 && (
          <button type="button" className="home-news-arrow is-prev" onClick={() => scroll(-1)} aria-label="Scroll left">
            <Icon name="chevronLeft" size={16} />
          </button>
        )}
        <div className="home-news-row" ref={rowRef}>
          {items.map((it, i) => {
            const cat = CATEGORY[it.category];
            return (
              <button type="button" key={it.id} className="home-news-card" style={{ "--d": `${i * 50}ms` }} onClick={onOpenNotices}>
                <img src={urls.get(it.image_path)} alt="" loading="lazy" />
                <span className="home-news-meta">
                  {cat && <span className={`achv-tag t-${cat.tone}`}>{cat.label}</span>}
                  <span className="row-sub">{dateText(it.created_at)}</span>
                </span>
                <strong className="home-news-title">{it.title}</strong>
                {it.body && <p className="home-news-body">{it.body}</p>}
              </button>
            );
          })}
        </div>
        {items.length > 2 && (
          <button type="button" className="home-news-arrow is-next" onClick={() => scroll(1)} aria-label="Scroll right">
            <Icon name="chevronRight" size={16} />
          </button>
        )}
      </div>
    </section>
  );
}

// Everyday shortcuts, next to Upcoming Events: the + menu's actions, as
// [key, label, icon]. Hidden when there's nothing this person can do, and
// on phones, where the + beside the search does the same job.
const ACTION_TONE = { student: "indigo", fee: "amber", attendance: "green", homework: "teal", result: "violet", datesheet: "pink", notice: "orange", event: "violet" };

function QuickActionsPanel({ actions, onAction }) {
  if (!actions.length) return null;
  return (
    <section className="home-quick">
      <header className="home-notice-head">
        <span className="home-quick-icon">
          <Icon name="lightning" size={18} weight="fill" />
        </span>
        <span className="home-notice-text">
          <strong>Quick Actions</strong>
        </span>
      </header>
      <div className="home-quick-row">
        {actions.map(([key, label, icon]) => (
          <button type="button" key={key} className="home-quick-btn" onClick={() => onAction(key)}>
            <span className={`home-quick-badge t-${ACTION_TONE[key] ?? "indigo"}`}>
              <Icon name={icon} size={18} weight="fill" />
            </span>
            <span>{label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
