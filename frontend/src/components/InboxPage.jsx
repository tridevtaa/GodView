import { useCallback, useEffect, useMemo, useState } from "react";
import { staffInbox } from "../data/api.js";
import Chat from "./Chat.jsx";
import { Photo, gradeLabel } from "./PersonCard.jsx";
import Icon from "./Icon.jsx";

const FILTERS = [
  ["all", "All"],
  ["unread", "Unread"],
  ["requests", "Requests"],
];

function when(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
const classLine = (s) => (s ? `${gradeLabel(s.class)}${s.section ? ` · ${s.section}` : ""}` : "");

// Staff inbox: one conversation per child, newest first, like a messaging
// app. On wide screens the list and the open conversation sit side by side;
// on phones the conversation opens full screen.
// students: the session's students (names, photos, classes).
// readOnly: the principal reads but doesn't write.
export default function InboxPage({ school, students, me, readOnly = false, canAnswer = true, onOpenStudent, onCount }) {
  const [threads, setThreads] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const byId = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  const load = useCallback(
    () =>
      staffInbox(school.id).then(
        (rows) => {
          setThreads(rows);
          setError("");
          onCount?.(rows.filter((t) => Number(t.unread) > 0 || Number(t.open_requests) > 0).length);
        },
        () => setError("Couldn’t load the inbox. Check your connection.")
      ),
    [school.id, onCount]
  );

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 30000);
    return () => clearInterval(t);
  }, [load]);

  const shown = (threads ?? []).filter(
    (t) => filter === "all" || (filter === "unread" ? Number(t.unread) > 0 : Number(t.open_requests) > 0)
  );
  const counts = {
    unread: (threads ?? []).filter((t) => Number(t.unread) > 0).length,
    requests: (threads ?? []).filter((t) => Number(t.open_requests) > 0).length,
  };
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return students.filter((s) => s.status !== "left" && `${s.name} ${s.parent_name ?? ""} ${s.admission_no ?? ""}`.toLowerCase().includes(q)).slice(0, 8);
  }, [query, students]);
  const openStudent = open ? byId.get(open) : null;

  function start(id) {
    setOpen(id);
    setPicking(false);
    setQuery("");
  }

  return (
    <div className={`inbox${open ? " has-open" : ""}`}>
      <section className="inbox-list">
        <div className="inbox-head">
          <h1 className="page-count">Inbox</h1>
          {!readOnly && (
            <button className="btn btn-primary btn-sm" onClick={() => setPicking((p) => !p)}>
              <Icon name="plus" /> New
            </button>
          )}
        </div>

        {picking && (
          <div className="inbox-pick">
            <label className="search">
              <Icon name="search" />
              <input autoFocus placeholder="Which student?" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            {matches.map((s) => (
              <button key={s.id} className="inbox-row" onClick={() => start(s.id)}>
                <Photo person={s} className="inbox-photo" />
                <span className="inbox-main">
                  <strong>{s.name}</strong>
                  <span className="row-sub">{classLine(s)}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        <nav className="segmented segmented-sm inbox-filter" aria-label="Show">
          {FILTERS.map(([v, l]) => (
            <button key={v} className={filter === v ? "active" : ""} onClick={() => setFilter(v)}>
              {l}
              {counts[v] > 0 && <span className="seg-count">{counts[v]}</span>}
            </button>
          ))}
        </nav>

        {error && <p className="notice notice-error">{error}</p>}
        {threads === null && !error && <div className="card card-skeleton inbox-skeleton" />}
        {threads && shown.length === 0 && (
          <p className="row-sub inbox-empty">
            {filter === "all" ? "No conversations yet. Parents and staff write to each other here." : "Nothing here."}
          </p>
        )}
        <ul className="inbox-threads">
          {shown.map((t) => {
            const s = byId.get(t.student_id);
            const unread = Number(t.unread);
            return (
              <li key={t.student_id}>
                <button className={`inbox-row${open === t.student_id ? " is-on" : ""}${unread ? " is-unread" : ""}`} onClick={() => start(t.student_id)}>
                  <Photo person={s ?? { id: t.student_id, name: "?" }} className="inbox-photo" />
                  <span className="inbox-main">
                    <span className="inbox-top">
                      <strong>{s?.name ?? "Student"}</strong>
                      <time>{when(t.last_at)}</time>
                    </span>
                    <span className="inbox-bottom">
                      <span className="inbox-last">
                        {Number(t.open_requests) > 0 && <span className="inbox-req">Request</span>}
                        {t.last_body}
                      </span>
                      {unread > 0 && <span className="seg-count">{unread}</span>}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="inbox-chat">
        {open ? (
          <>
            <header className="inbox-chat-head">
              <button className="btn-icon inbox-back" onClick={() => setOpen(null)} aria-label="Back to inbox">
                <Icon name="arrowLeft" size={18} />
              </button>
              <button className="inbox-who" onClick={() => onOpenStudent?.(open)} title="Open the student's page">
                <Photo person={openStudent ?? { id: open, name: "?" }} className="inbox-photo" />
                <span className="inbox-main">
                  <strong>{openStudent?.name ?? "Student"}</strong>
                  <span className="row-sub">
                    {classLine(openStudent)}
                    {openStudent?.parent_name ? ` · ${openStudent.parent_name}` : ""}
                  </span>
                </span>
              </button>
            </header>
            <Chat key={open} studentId={open} viewer="staff" me={me} canSend={!readOnly} canAnswer={!readOnly && canAnswer} onRead={load} />
          </>
        ) : (
          <p className="row-sub inbox-pick-hint">Pick a conversation.</p>
        )}
      </section>
    </div>
  );
}
