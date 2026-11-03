import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadEmployees, staffInbox } from "../data/api.js";
import { useDismiss } from "./useDismiss.js";
import { Photo, gradeLabel } from "./PersonCard.jsx";
import Icon from "./Icon.jsx";
import { SECTION_LABEL } from "../data/screens.js";
import { useWide } from "./HomeTrend.jsx";

const norm = (v) => String(v ?? "").toLowerCase();
const digits = (v) => String(v ?? "").replace(/\D/g, "");

// Phones: the search is a page of its own. Before typing, what was opened
// lately and the everyday screens; while typing, filters by kind.
const SHORTCUTS = [
  ["attendance", "green"],
  ["homework", "teal"],
  ["fees", "amber"],
  ["timetable", "violet"],
  ["calendar", "pink"],
  ["notices", "orange"],
];
const FILTERS = [
  ["students", "Students"],
  ["staff", "Staff"],
  ["threads", "Messages"],
  ["screens", "Screens"],
];
const RECENT_MAX = 5;

// Only ids and kinds are kept on the device.
const readRecent = (key) => {
  try {
    const list = JSON.parse(localStorage.getItem(key));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};
const writeRecent = (key, list) => {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* private window: it just isn't remembered */
  }
};

// The part that matched, picked out on phones (App.css)
function Hit({ text, term }) {
  const t = String(text ?? "");
  const at = term ? t.toLowerCase().indexOf(term) : -1;
  if (at < 0) return t;
  return (
    <>
      {t.slice(0, at)}
      <mark className="gsearch-hit">{t.slice(at, at + term.length)}</mark>
      {t.slice(at + term.length)}
    </>
  );
}

// One search for the whole app: screens, students, staff and conversations,
// grouped. Typing "class" goes straight to the Class-wise report.
// In the header on computers; a bar above the tab bar on phones. Staff and
// conversations load the first time it's used.
// students: the session's students. seesStaff: owners, admins, principal.
// screens: data/screens.js.
export default function GlobalSearch({ school, students, seesStaff, screens, onScreen, onStudent, onStaff, onThread }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [staff, setStaff] = useState(null);
  const [threads, setThreads] = useState(null);
  const ref = useDismiss(open, useCallback(() => setOpen(false), []));
  const input = useRef(null);
  const phone = !useWide();
  const [filter, setFilter] = useState("all");
  const recentKey = `godview.search.${school.id}`;
  const [recent, setRecent] = useState(() => readRecent(recentKey));

  function warm() {
    setOpen(true);
    if (seesStaff && staff === null) loadEmployees(school.id).then(setStaff, () => setStaff([]));
    if (threads === null) staffInbox(school.id).then(setThreads, () => setThreads([]));
  }

  // While typing, the tab bar steps aside (phones): the keyboard lifts
  // everything fixed, and the search should sit right above it.
  const typing = (on) => document.documentElement.classList.toggle("is-typing", on);
  useEffect(() => () => typing(false), []);

  // "/" focuses the search on computers.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement?.tagName ?? "")) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const term = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!term) return null;
    const num = digits(term);
    const byId = new Map(students.map((s) => [s.id, s]));
    const hit = (fields) => fields.some((f) => norm(f).includes(term)) || (num.length >= 4 && fields.some((f) => digits(f).includes(num)));
    const startsWord = (text) => ` ${norm(text).replace(/-/g, " ")}`.includes(` ${term.replace(/-/g, " ")}`);
    return {
      screens:
        term.length < 2
          ? []
          : screens
              .filter((s) => startsWord(`${s.label} ${SECTION_LABEL[s.section] ?? ""} ${s.words ?? ""}`))
              .sort((a, b) => startsWord(b.label) - startsWord(a.label)),
      students: students.filter((s) => s.status !== "left" && hit([s.name, s.parent_name, s.mother_name, s.admission_no, s.parent_phone, s.srn])),
      staff: (staff ?? []).filter((p) => hit([p.name, p.designation, p.department, p.employee_no, p.phone])),
      threads: (threads ?? [])
        .filter((t) => {
          const s = byId.get(t.student_id);
          return hit([s?.name, s?.parent_name, t.last_body]);
        })
        .map((t) => ({ ...t, student: byId.get(t.student_id) })),
    };
  }, [term, screens, students, staff, threads]);
  const none = results && !results.screens.length && !results.students.length && !results.staff.length && !results.threads.length;

  // Still loading what could match: not "nothing" yet
  const stillLoading = (seesStaff && staff === null) || threads === null;
  const kinds = results ? FILTERS.filter(([k]) => results[k].length > 0) : [];
  const active = filter !== "all" && results?.[filter]?.length ? filter : "all";
  const showing = (kind) => active === "all" || active === kind;
  // One kind picked on a phone: everything of it, not just the first few
  const room = (kind, few) => (phone && active === kind ? 60 : few);

  const pick = (fn, item) => () => {
    fn();
    setQ("");
    setFilter("all");
    setOpen(false);
    input.current?.blur();
    if (item) {
      const next = [item, ...recent.filter((r) => r.kind !== item.kind || r.id !== item.id)].slice(0, RECENT_MAX);
      setRecent(next);
      writeRecent(recentKey, next);
    }
  };

  const screenRow = (s, item) => (
    <button key={s.key} className="gsearch-row" onClick={pick(() => onScreen(s.key), item)}>
      <span className="gsearch-icon">
        <Icon name={s.icon} size={18} />
      </span>
      <span className="inbox-main">
        <strong>
          <Hit text={s.label} term={term} />
        </strong>
        {s.section && s.label !== SECTION_LABEL[s.section] && <span className="row-sub">{SECTION_LABEL[s.section]}</span>}
      </span>
    </button>
  );
  const studentRow = (s) => (
    <button key={s.id} className="gsearch-row" onClick={pick(() => onStudent(s.id), { kind: "student", id: s.id })}>
      <Photo person={s} className="inbox-photo gsearch-photo" />
      <span className="inbox-main">
        <strong>
          <Hit text={s.name} term={term} />
        </strong>
        <span className="row-sub">{[gradeLabel(s.class), s.section, s.parent_name].filter(Boolean).join(" · ")}</span>
      </span>
    </button>
  );
  const staffRow = (p) => (
    <button key={p.id} className="gsearch-row" onClick={pick(() => onStaff(p.id), { kind: "staff", id: p.id })}>
      <Photo person={p} className="inbox-photo gsearch-photo" />
      <span className="inbox-main">
        <strong>
          <Hit text={p.name} term={term} />
        </strong>
        <span className="row-sub">{[p.designation, p.department].filter(Boolean).join(" · ")}</span>
      </span>
    </button>
  );

  const recentRows = recent
    .map((r) => {
      if (r.kind === "student") {
        const s = students.find((x) => x.id === r.id);
        return s && studentRow(s);
      }
      if (r.kind === "staff") {
        const p = staff?.find((x) => x.id === r.id);
        return p && staffRow(p);
      }
      const sc = screens.find((x) => x.key === r.id);
      return sc && screenRow(sc, r);
    })
    .filter(Boolean);
  const shortcuts = SHORTCUTS.map(([key, tone]) => [screens.find((x) => x.key === key), tone]).filter(([x]) => x);

  return (
    <div className="gsearch" ref={ref}>
      <label className="search gsearch-box">
        <Icon name="search" />
        <input
          ref={input}
          type="search"
          placeholder={phone ? "Students, staff, screens" : "Search anything"}
          aria-label="Search students, staff, messages and screens"
          value={q}
          onFocus={() => (warm(), typing(true))}
          // A short wait so tapping a result still lands before the bar returns.
          onBlur={() => setTimeout(() => typing(false), 150)}
          onChange={(e) => (setQ(e.target.value), warm())}
          onKeyDown={(e) => e.key === "Escape" && (setQ(""), setOpen(false), input.current?.blur())}
        />
        {phone && q && (
          <button
            type="button"
            className="gsearch-clear"
            aria-label="Clear search"
            onClick={(e) => {
              e.preventDefault();
              setQ("");
              setFilter("all");
              input.current?.focus();
            }}
          >
            <Icon name="x" size={14} />
          </button>
        )}
      </label>

      {phone && !results && (
        <div className="gsearch-panel" onTouchMove={() => input.current?.blur()}>
          {recentRows.length > 0 && (
            <section>
              <h4>
                Recent
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setRecent([]);
                    writeRecent(recentKey, []);
                  }}
                >
                  Clear
                </button>
              </h4>
              {recentRows}
            </section>
          )}
          {shortcuts.length > 0 && (
            <section>
              <h4>Go to</h4>
              <div className="gsearch-tiles">
                {shortcuts.map(([x, tone]) => (
                  <button key={x.key} className="gsearch-row gsearch-tile" onClick={pick(() => onScreen(x.key), { kind: "screen", id: x.key })}>
                    <span className={`home-quick-badge t-${tone}`}>
                      <Icon name={x.icon} size={18} weight="fill" />
                    </span>
                    <span>{x.label}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {(open || phone) && results && (
        <div className="gsearch-panel" role="listbox" onTouchMove={() => phone && input.current?.blur()}>
          {none && <p className="row-sub gsearch-empty">{stillLoading ? "Searching…" : `Nothing matches “${q}”.`}</p>}

          {phone && kinds.length > 1 && (
            <div className="gsearch-filters" role="group" aria-label="Show">
              {[["all", "All"], ...kinds].map(([k, label]) => (
                <button key={k} type="button" className={`gsearch-filter${active === k ? " is-on" : ""}`} aria-pressed={active === k} onClick={() => setFilter(k)}>
                  {label}
                  {k !== "all" && <span>{results[k].length}</span>}
                </button>
              ))}
            </div>
          )}

          {showing("screens") && results.screens.length > 0 && (
            <section className="gsearch-screens">
              <h4>Go to</h4>
              <div className="gsearch-screens-row">{results.screens.slice(0, room("screens", 4)).map((s) => screenRow(s, { kind: "screen", id: s.key }))}</div>
            </section>
          )}

          {showing("students") && results.students.length > 0 && (
            <section>
              <h4>Students</h4>
              {results.students.slice(0, room("students", 8)).map(studentRow)}
            </section>
          )}

          {showing("staff") && results.staff.length > 0 && (
            <section>
              <h4>Staff</h4>
              {results.staff.slice(0, room("staff", 5)).map(staffRow)}
            </section>
          )}

          {showing("threads") && results.threads.length > 0 && (
            <section>
              <h4>Messages</h4>
              {results.threads.slice(0, room("threads", 5)).map((t) => (
                <button key={t.student_id} className="gsearch-row" onClick={pick(() => onThread(t.student_id))}>
                  <span className="gsearch-icon">
                    <Icon name="plane" size={18} />
                  </span>
                  <span className="inbox-main">
                    <strong>
                      <Hit text={t.student?.name ?? "Conversation"} term={term} />
                    </strong>
                    <span className="row-sub gsearch-last">{t.last_body}</span>
                  </span>
                </button>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
