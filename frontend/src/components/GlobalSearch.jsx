import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadEmployees, staffInbox } from "../data/api.js";
import { useDismiss } from "./useDismiss.js";
import { Photo, gradeLabel } from "./PersonCard.jsx";
import Icon from "./Icon.jsx";

const norm = (v) => String(v ?? "").toLowerCase();
const digits = (v) => String(v ?? "").replace(/\D/g, "");

// One search for the whole app: students, staff and conversations, grouped.
// In the header on computers; a bar above the tab bar on phones. Staff and
// conversations load the first time it's used.
// students: the session's students. seesStaff: owners, admins, principal.
export default function GlobalSearch({ school, students, seesStaff, onStudent, onStaff, onThread }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [staff, setStaff] = useState(null);
  const [threads, setThreads] = useState(null);
  const ref = useDismiss(open, useCallback(() => setOpen(false), []));
  const input = useRef(null);

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
    return {
      students: students
        .filter((s) => s.status !== "left" && hit([s.name, s.parent_name, s.mother_name, s.admission_no, s.parent_phone, s.srn]))
        .slice(0, 8),
      staff: (staff ?? []).filter((p) => hit([p.name, p.designation, p.department, p.employee_no, p.phone])).slice(0, 5),
      threads: (threads ?? [])
        .filter((t) => {
          const s = byId.get(t.student_id);
          return hit([s?.name, s?.parent_name, t.last_body]);
        })
        .slice(0, 5)
        .map((t) => ({ ...t, student: byId.get(t.student_id) })),
    };
  }, [term, students, staff, threads]);
  const none = results && !results.students.length && !results.staff.length && !results.threads.length;

  const pick = (fn) => () => {
    fn();
    setQ("");
    setOpen(false);
    input.current?.blur();
  };

  return (
    <div className="gsearch" ref={ref}>
      <label className="search gsearch-box">
        <Icon name="search" />
        <input
          ref={input}
          type="search"
          placeholder="Search students, staff, messages"
          aria-label="Search students, staff and messages"
          value={q}
          onFocus={() => (warm(), typing(true))}
          // A short wait so tapping a result still lands before the bar returns.
          onBlur={() => setTimeout(() => typing(false), 150)}
          onChange={(e) => (setQ(e.target.value), warm())}
          onKeyDown={(e) => e.key === "Escape" && (setQ(""), setOpen(false), input.current?.blur())}
        />
      </label>

      {open && results && (
        <div className="gsearch-panel" role="listbox">
          {none && <p className="row-sub gsearch-empty">Nothing matches “{q}”.</p>}

          {results.students.length > 0 && (
            <section>
              <h4>Students</h4>
              {results.students.map((s) => (
                <button key={s.id} className="gsearch-row" onClick={pick(() => onStudent(s.id))}>
                  <Photo person={s} className="inbox-photo gsearch-photo" />
                  <span className="inbox-main">
                    <strong>{s.name}</strong>
                    <span className="row-sub">
                      {[gradeLabel(s.class), s.section, s.parent_name].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              ))}
            </section>
          )}

          {results.staff.length > 0 && (
            <section>
              <h4>Staff</h4>
              {results.staff.map((p) => (
                <button key={p.id} className="gsearch-row" onClick={pick(() => onStaff(p.id))}>
                  <Photo person={p} className="inbox-photo gsearch-photo" />
                  <span className="inbox-main">
                    <strong>{p.name}</strong>
                    <span className="row-sub">{[p.designation, p.department].filter(Boolean).join(" · ")}</span>
                  </span>
                </button>
              ))}
            </section>
          )}

          {results.threads.length > 0 && (
            <section>
              <h4>Messages</h4>
              {results.threads.map((t) => (
                <button key={t.student_id} className="gsearch-row" onClick={pick(() => onThread(t.student_id))}>
                  <span className="gsearch-icon">
                    <Icon name="plane" size={18} />
                  </span>
                  <span className="inbox-main">
                    <strong>{t.student?.name ?? "Conversation"}</strong>
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
