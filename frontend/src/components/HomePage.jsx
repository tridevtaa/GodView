import { useEffect, useRef, useState } from "react";
import { listHomework } from "../data/api.js";
import { peek, swr } from "../data/cache.js";
import { rupeesShort } from "../data/money.js";
import { PriorityCard, Tile, arrangeTiles } from "./Widgets.jsx";
import { Caption, MiniRing, Thumb } from "./TileVisuals.jsx";
import { ComingUp } from "./CalendarPage.jsx";
import { CATEGORY, showsImage, useImageUrls, useNotices } from "./NoticeBoard.jsx";
import Icon from "./Icon.jsx";
import { NotifyPrompt } from "./Notify.jsx";
import { homeworkTrend, useAttendanceTrend, useFeeTrend, useWide } from "./HomeTrend.jsx";
import { hintFor, useInsights } from "./AiInsights.jsx";

const n = (v) => Number(v || 0).toLocaleString("en-IN");
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};
// "5m ago", "3h ago", "2d ago", then the date
const ago = (t) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(t)) / 6e4));
  return m < 60 ? `${m || 1}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : m < 7 * 1440 ? `${Math.round(m / 1440)}d ago` : dateText(t);
};
const dateText = (d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

// Home, like phone widgets: a greeting, today's attendance next to the
// noticeboard as a banner to swipe through, colourful tiles for what
// has no tab of its own (one number and one word), students' wins
// (News & Achievements), then what's coming up beside a small calendar,
// and quick actions. Anything waiting on this
// person shows as a red badge on its tile or tab (overdue fees, open
// requests, staff waiting for access…). Uses the same remembered data as the pages,
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
  const [homework, setHomework] = useState(() => (session ? peek(`homework:${session.id}`) ?? null : null));
  const [notices] = useNotices(school.id);
  const urls = useImageUrls(notices);
  const wins = (notices ?? []).filter(isWin);
  const plain = (notices ?? []).filter((x) => !isWin(x));

  useEffect(() => {
    if (!session) return;
    swr(`homework:${session.id}`, () => listHomework(school.id, session.id), setHomework).catch(() => setHomework([]));
  }, [school.id, session]);

  // Numbers
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const dueTomorrow = (homework ?? []).filter((h) => h.due_date === tomorrow).length;
  const thisWeek = (homework ?? []).filter((h) => h.created_at >= weekAgo).length;
  const owing = students.filter((p) => Number(p.fee_due) > 0);
  const overdue = students.filter((p) => p.fee_status === "overdue").length;
  const due = owing.reduce((t, p) => t + Number(p.fee_due), 0);
  const attPct = today?.marked ? Math.round((today.present / today.marked) * 100) : null;
  const unmarked = today && today.marked === 0;
  const left = today?.notMarked ?? 0;
  const needsMarking = Boolean(unmarked || left > 0);
  const attTone = needsMarking ? "red" : attPct === null ? "indigo" : attPct >= 90 ? "green" : attPct >= 75 ? "amber" : "red";

  // The top card is this person's priority: pending fees for owners and
  // admins, today's attendance for the principal and class teachers,
  // homework for other teachers.
  const prio = isAdmin ? "fees" : leads || today ? "attendance" : "homework";
  // Premium: the AI's one line for today, on the fees card
  const insF = useInsights(school, "fees", isAdmin);

  // On computers the top card is bigger: a few numbers and this period
  // against the last one.
  const wide = useWide();
  const feeTrend = useFeeTrend(school.id, wide && prio === "fees");
  const attTrend = useAttendanceTrend(session?.id, leads, students, today, wide && prio === "attendance" && !loading);
  const trend = !wide ? null : prio === "fees" ? feeTrend : prio === "attendance" ? attTrend : homeworkTrend(homework);

  // The latest notice, for a line under its tile
  const lastNotice = (notices ?? [])[0];

  // Tiles only for what has no tab of its own (Students, Homework, Inbox
  // and Staff are a tap away below): the office gets attendance and
  // notices. badge: what's waiting on this person; hot: the tile glows.
  const go = (to) => () => onGo(to);
  const rawTiles = [
    // The office's top card is fees, so attendance becomes a tile for them
    isAdmin && {
      key: "attendance",
      icon: "register",
      tone: attTone,
      label: "Present Today",
      value: today === null ? undefined : today?.marked ? today.present : "–",
      badge: left,
      badgeLabel: `${left} class${left === 1 ? "" : "es"} left to mark`,
      sub: today === null ? null : left ? `${left} class${left === 1 ? "" : "es"} not marked yet` : today?.marked ? `${attPct}% of the school in` : null,
      visual: today?.classes > 0 && (
        <>
          <MiniRing pct={((today.classes - left) / today.classes) * 100} />
          <Caption>classes marked</Caption>
        </>
      ),
      onClick: go("attendance"),
    },
    isAdmin && {
      key: "notices",
      icon: "notice",
      tone: "orange",
      label: "Notices",
      value: notices === null ? undefined : notices.length,
      sub: lastNotice && `${lastNotice.title} · ${ago(lastNotice.created_at)}`,
      fresh: lastNotice?.created_at,
      visual: lastNotice && showsImage(lastNotice) && <Thumb src={urls.get(lastNotice.image_path)} />,
      onClick: go("notices"),
    },
  ].filter(Boolean);

  const { tiles, spans } = arrangeTiles(rawTiles);

  // Owners: anyone waiting for app access comes first, beside the fees
  const access =
    isOwner && pendingCount > 0
      ? {
          tone: "violet",
          urgent: true,
          icon: "idcard",
          label: "App access",
          title: `${pendingCount} waiting`,
          sub: "Approve them and pick their classes",
          cta: "Review",
          onClick: go("access"),
        }
      : null;
  const priority =
    prio === "fees"
      ? {
          tone: overdue ? "red" : due > 0 ? "amber" : "green",
          urgent: overdue > 0,
          icon: "rupee",
          label: due > 0 || loading ? "Fees pending" : "Fees",
          title: loading ? "…" : due > 0 ? rupeesShort(due) : "All collected",
          status: loading ? "" : overdue ? `${n(overdue)} students overdue` : due > 0 ? `${n(owing.length)} students owe fees` : "Nothing pending",
          cta: "View fees",
          hint: hintFor(insF, "home"),
          onClick: go("fees"),
        }
      : prio === "attendance"
      ? {
          tone: attTone,
          urgent: needsMarking,
          icon: "register",
          label: "Today’s attendance",
          title: today === null ? "…" : today?.marked ? `${n(today.present)} present` : "Not marked yet",
          status: today === null ? "" : left ? `${left} class${left === 1 ? "" : "es"} left to mark` : today?.marked ? "All classes marked" : "",
          pct: today?.marked ? attPct : null,
          cta: today?.marked ? "View attendance" : "Take attendance",
          onClick: go("attendance"),
        }
      : {
          tone: dueTomorrow ? "amber" : "teal",
          icon: "book",
          label: "Homework",
          title: homework === null ? "…" : dueTomorrow ? `${dueTomorrow} due tomorrow` : thisWeek ? `${thisWeek} set this week` : "None set this week",
          status: homework !== null && dueTomorrow && thisWeek ? `${thisWeek} set this week` : "",
          cta: actions.some(([k]) => k === "homework") ? "Give homework" : "See homework",
          onClick: actions.some(([k]) => k === "homework") ? () => onAction("homework") : go("homework"),
        };

  // The + menu's actions, less what the top card already offers.
  const quickActions = actions.filter(([key]) => !(key === "attendance" && prio === "attendance") && !(key === "homework" && prio === "homework"));
  // The banner shows while there are plain notices (or they're loading).
  const banner = showBanner && (notices === null || plain.length > 0);

  const first = (name || me || "").split(/[\s@]/)[0];
  return (
    <div className="home hw home-roomy">
      <header className="home-hero">
        <p className="home-date">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1>
          {greeting()}
          {first ? `, ${first.charAt(0).toUpperCase()}${first.slice(1)}` : ""}
        </h1>
      </header>

      <NotifyPrompt text="Get notified when parents write." />

      <div className={`home-row1${access ? " is-pair" : banner ? "" : " is-solo"}${trend ? " has-trend" : ""}`}>
        {access && <PriorityCard {...access} />}
        <PriorityCard {...priority} trend={trend} />
        {banner && <NoticeBanner notices={notices === null ? null : plain} urls={urls} onOpenNotices={go("notices")} />}
      </div>

      {/* Tiles in two even rows on computers */}
      {tiles.length > 0 && (
        <div className="hw-grid" style={{ "--half": spans / 2 }}>
          {tiles.map((t, i) => (
            <Tile key={t.key} {...t} index={i} />
          ))}
        </div>
      )}

      {showWins && <AchievementsStrip items={wins} urls={urls} viewAll={!banner} onOpenNotices={go("notices")} />}

      <div className={`home-bottom-row${quickActions.length ? "" : " is-solo"}`}>
        <ComingUp schoolId={school.id} session={session} staff calendar withNotices={false} limit={4} onOpenCalendar={go("calendar")} onOpenNotices={go("notices")} />
        <QuickActionsPanel actions={quickActions} onAction={onAction} />
      </div>
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
              <Icon name={icon} size={22} weight="fill" />
            </span>
            <span>{label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
