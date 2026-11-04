import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Logo from "./Logo.jsx";
import GlassPill from "./GlassPill.jsx";
import AccountMenu from "./AccountMenu.jsx";
import GoddessFace from "./GoddessFace.jsx";
import Icon from "./Icon.jsx";
import { useBackToClose } from "./Chat.jsx";
import { SECTION_LABEL } from "../data/screens.js";

const ICONS = { home: "home", students: "scholar", academics: "academics", planner: "calendar", fees: "rupee", requests: "plane", employees: "teacher", transport: "bus" };

const useMedia = (query) => {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const change = () => setOn(list.matches);
    change();
    list.addEventListener("change", change);
    return () => list.removeEventListener("change", change);
  }, [query]);
  return on;
};

// sections: [[value, label, badgeCount?], …], already filtered by role.
// Computers: plain titles along the top, with Inbox as an icon beside search;
// pausing on one drops its panel over the page, which blurs (menus: App.jsx).
// Search opens the same way, on a click.
// Phones: barKeys in a bar at the bottom, then Search and More (every other
// screen, directly; screens: data/screens.js). The section's sub-categories
// float above the bar.
// onSettings: School settings (owners and admins), from the account menu.
// session: the session picker, shown beside the logo.
// onAsk: opens the assistant (Premium leads), her portrait beside the account.
export default function TopBar({ mode, onMode, sections, barKeys, screens, menus, onSettings, onProfile, session, search, onAsk }) {
  const [more, setMore] = useState(false);
  const [finding, setFinding] = useState(false);
  const wide = useMedia("(min-width: 761px)");
  const canHover = useMedia("(hover: hover) and (min-width: 761px)");
  const [open, setOpen] = useState(null); // a section, "search" or nothing
  const [height, setHeight] = useState(0);
  const inner = useRef(null);
  const timer = useRef(0);
  // What's in the panel stays there while it closes
  const last = useRef(null);
  if (open) last.current = open;
  const shown = last.current;
  const later = (fn, ms) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  };
  const close = () => (clearTimeout(timer.current), setOpen(null));
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(close, [mode]);

  // The panel is as tall as what's in it, gliding between sections.
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => setHeight(el.scrollHeight);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [shown, wide]);

  useEffect(() => {
    if (open === "search") inner.current?.querySelector(".gsearch input")?.focus();
    else if (inner.current?.contains(document.activeElement)) document.activeElement.blur();
  }, [open]);

  // Escape closes just this; "/" opens search.
  useEffect(() => {
    if (!wide) return;
    const onKey = (e) => {
      if (e.key === "Escape" && open) {
        e.stopPropagation();
        close();
      } else if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement?.tagName ?? "")) {
        setOpen("search");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [wide, open]);

  const bar = sections.filter(([v]) => barKeys.includes(v));
  const rest = sections.filter(([v]) => !barKeys.includes(v));
  const inMore = rest.some(([v]) => v === mode);
  const at = inMore ? bar.length + 1 : bar.findIndex(([v]) => v === mode);
  const waiting = rest.reduce((n, [, , count]) => n + (count || 0), 0);
  const tab = ([value, label, count]) => (
    <button key={value} className={mode === value ? "active" : ""} aria-current={mode === value ? "page" : undefined} aria-label={label} onClick={() => onMode(value)}>
      <Icon name={ICONS[value] ?? "file"} size={22} className="tab-icon" weight={mode === value ? "fill" : "regular"} />
      <span className="tab-label">{label}</span>
      {count > 0 && <span className="seg-count">{count > 99 ? "99+" : count}</span>}
    </button>
  );
  const title = ([value, label, count]) => (
    <button
      key={value}
      className={`${mode === value ? "active" : ""}${open === value ? " is-open" : ""}`}
      aria-current={mode === value ? "page" : undefined}
      aria-label={label}
      aria-expanded={open === value}
      onMouseEnter={() => canHover && open !== "search" && later(() => setOpen(value), open ? 70 : 120)}
      onMouseLeave={() => open !== value && clearTimeout(timer.current)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown") return;
        e.preventDefault();
        setOpen(value);
        setTimeout(() => inner.current?.querySelector(".nav-link")?.focus(), 60);
      }}
      // No hover (touch tablets): a tap opens the panel, the only way to its screens
      onClick={() => (canHover ? (close(), onMode(value)) : setOpen(open === value ? null : value))}
    >
      <Icon name={ICONS[value] ?? "file"} size={20} className="tab-icon" weight={mode === value ? "fill" : "regular"} />
      <span className="tab-label">{label}</span>
      {count > 0 && <span className="seg-count">{count > 99 ? "99+" : count}</span>}
    </button>
  );
  // Inbox has no panel: it opens straight away, its filters are on its page.
  const inboxIcon = ([value, label, count]) => (
    <button
      key={value}
      className={`nav-icon-btn${mode === value ? " active" : ""}`}
      aria-current={mode === value ? "page" : undefined}
      aria-label={label}
      onMouseEnter={() => open && open !== "search" && later(close, 70)}
      onClick={() => (close(), onMode(value))}
    >
      <Icon name={ICONS[value] ?? "file"} size={20} className="tab-icon" weight={mode === value ? "fill" : "regular"} />
      <span className="tab-label">{label}</span>
      {count > 0 && <span className="seg-count">{count > 99 ? "99+" : count}</span>}
    </button>
  );
  const quick = ["attendance", "homework", "fees", "class-report", "notices"].map((k) => screens.find((s) => s.key === k)).filter(Boolean);
  return (
    <>
      <header
        className={`topbar${open ? " has-panel" : ""}`}
        onMouseEnter={() => open !== "search" && clearTimeout(timer.current)}
        onMouseLeave={() => canHover && open !== "search" && later(close, 200)}
      >
        <div className="topbar-inner">
          <span className="topbar-left">
            <Logo />
            {session}
          </span>
          {sections.length > 1 && (
            <nav className="topbar-tabs" aria-label="Section">
              {sections.filter(([v]) => v !== "requests").map((s) => title(s))}
            </nav>
          )}
          <span className="topbar-right">
            {wide && (
              <button type="button" className={`nav-icon-btn${open === "search" ? " is-open" : ""}`} aria-label="Search" aria-expanded={open === "search"} onClick={() => (open === "search" ? close() : setOpen("search"))}>
                <Icon name="search" size={18} />
              </button>
            )}
            {/* Messages sit with search */}
            {wide && sections.some(([v]) => v === "requests") && inboxIcon(sections.find(([v]) => v === "requests"))}
            {onAsk && (
              <button type="button" className="ask-btn" onClick={onAsk} aria-label="Ask Goddess" title="Ask Goddess">
                <GoddessFace />
              </button>
            )}
            <AccountMenu onSettings={onSettings} onProfile={onProfile} />
          </span>
        </div>
        {wide && (
          <div className={`nav-panel${open ? " is-open" : ""}`} style={{ height: open ? height : 0 }}>
            <div className="nav-panel-inner" ref={inner}>
              <div className="nav-search" hidden={shown !== "search"} onClick={(e) => e.target.closest(".gsearch-row") && close()}>
                {search}
                <div className="nav-quick">
                  <h3>Quick links</h3>
                  {quick.map((s) => (
                    <button key={s.key} type="button" className="nav-link" onClick={() => (close(), onMode(s.key))}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              {menus[shown] && <NavColumns key={shown} label={sections.find(([v]) => v === shown)?.[1]} menu={menus[shown]} onPick={close} />}
            </div>
          </div>
        )}
      </header>
      {wide && <div className={`nav-scrim${open ? " is-open" : ""}`} onClick={close} aria-hidden="true" />}
      {sections.length > 1 && (
        <nav className="tabbar" aria-label="Section">
          <GlassPill index={at} count={bar.length + 2} />
          {bar.map(tab)}
          <button aria-haspopup="dialog" onClick={() => setFinding(true)}>
            <Icon name="search" size={22} className="tab-icon" />
            <span className="tab-label">Search</span>
          </button>
          <button className={inMore ? "active" : ""} aria-haspopup="dialog" onClick={() => setMore(true)}>
            <Icon name="grid" size={22} className="tab-icon" weight={inMore ? "fill" : "regular"} />
            <span className="tab-label">More</span>
            {waiting > 0 && <span className="seg-count">{waiting > 99 ? "99+" : waiting}</span>}
          </button>
        </nav>
      )}
      {!wide && mode !== "home" && menus[mode]?.big.length > 1 && <SubNav links={menus[mode].big} />}
      {finding && !wide && (
        <SearchSheet
          search={search}
          onClose={() => setFinding(false)}
        />
      )}
      {more && (
        <MoreSheet
          screens={screens.filter((s) => s.section && !barKeys.includes(s.section))}
          onPick={(key) => {
            setMore(false);
            onMode(key);
          }}
          onClose={() => setMore(false)}
        />
      )}
    </>
  );
}

// One section's panel: its screens large, then columns of smaller links. The
// links come in one after another, top to bottom.
function NavColumns({ label, menu, onPick }) {
  let i = 0;
  const link = ([text, go, { current, count } = {}], cls) => (
    <button key={text} type="button" className={`nav-link${cls}${current ? " is-current" : ""}`} aria-current={current ? "page" : undefined} style={{ "--i": i++ }} onClick={() => (onPick(), go())}>
      {text}
      {count > 0 && <span className="seg-count">{count}</span>}
    </button>
  );
  return (
    <div className="nav-columns">
      <div className="nav-col">
        <h3>{label}</h3>
        {menu.big.map((l) => link(l, " is-big"))}
      </div>
      {menu.columns
        .filter((c) => c.links.length)
        .map((c) => (
          <div key={c.title} className={`nav-col${c.wide ? " is-wide" : ""}`}>
            <h3>{c.title}</h3>
            <div className="nav-col-links">{c.links.map((l) => link(l, ""))}</div>
          </div>
        ))}
    </div>
  );
}

// Phones: where the search bar was, the section's screens. The current one is
// kept in view when they scroll.
function SubNav({ links }) {
  const row = useRef(null);
  const [cut, setCut] = useState(false); // more to the right: it fades out
  const check = () => row.current && setCut(row.current.scrollLeft + row.current.clientWidth < row.current.scrollWidth - 2);
  const current = links.findIndex(([, , o]) => o?.current);
  useEffect(() => {
    row.current?.querySelector(".is-current")?.scrollIntoView({ inline: "center", block: "nearest" });
    check();
  }, [current, links.length]);
  return (
    <nav className="sub-nav" aria-label="In this section">
      <div className="sub-nav-row">
        <div className={`sub-nav-scroll no-swipe${cut ? " is-cut" : ""}`} ref={row} onScroll={check}>
          {links.map(([text, go, o]) => (
            <button key={text} type="button" className={o?.current ? "is-current" : ""} aria-current={o?.current ? "page" : undefined} onClick={go}>
              {text}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}

// Phones: search as a page of its own, with the keyboard up straight away.
function SearchSheet({ search, onClose }) {
  const sheet = useRef(null);
  useBackToClose(true, onClose);
  useLayoutEffect(() => {
    sheet.current?.querySelector(".gsearch input")?.focus();
  }, []);
  return createPortal(
    <section className="search-sheet" role="dialog" aria-modal="true" aria-label="Search" ref={sheet} onClick={(e) => e.target.closest(".gsearch-row") && onClose()}>
      <div className="search-sheet-head">
        {search}
        <button type="button" className="link-btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </section>,
    document.body
  );
}

// Phones: every screen that isn't in the bottom bar, one tap away.
const MORE_TONE = {
  attendance: "green",
  homework: "teal",
  syllabus: "indigo",
  marks: "violet",
  calendar: "pink",
  datesheet: "amber",
  timetable: "violet",
  notices: "orange",
  employees: "indigo",
  "org-chart": "teal",
  access: "amber",
  transport: "orange",
  collection: "green",
  "class-report": "teal",
  structure: "amber",
};

function MoreSheet({ screens, onPick, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const groups = [...new Set(screens.map((s) => s.section))];
  return createPortal(
    <div className="more-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="more-sheet" role="dialog" aria-modal="true" aria-label="More">
        {groups.map((g) => (
          <div key={g} className="more-group">
            <h3>{SECTION_LABEL[g]}</h3>
            <div className="more-grid">
              {screens
                .filter((s) => s.section === g)
                .map((s) => (
                  <button key={s.key} type="button" className="more-item" onClick={() => onPick(s.key)}>
                    <span className={`more-icon t-${MORE_TONE[s.key] ?? "indigo"}`}>
                      <Icon name={s.icon} size={24} weight="fill" />
                    </span>
                    <span>{s.label}</span>
                    {s.count > 0 && <span className="seg-count">{s.count}</span>}
                  </button>
                ))}
            </div>
          </div>
        ))}
      </section>
    </div>,
    document.body
  );
}
