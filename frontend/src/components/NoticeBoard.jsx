import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { deleteNotice, listNotices, postNotice, updateNotice } from "../data/api.js";
import { peek, remember, swr } from "../data/cache.js";
import Icon from "./Icon.jsx";

const when = (d) => {
  const t = new Date(d);
  const days = Math.floor((Date.now() - t) / 864e5);
  if (days < 1 && new Date().toDateString() === t.toDateString()) return "Today";
  if (days < 2) return "Yesterday";
  return t.toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(days > 300 ? { year: "numeric" } : {}) });
};

// The school's notices, shared by Home (a few) and the Noticeboard page.
// Remembered for the session so Home and the page open filled.
export function useNotices(schoolId) {
  const key = `notices:${schoolId}`;
  const [notices, setNotices] = useState(() => peek(key) ?? null);
  useEffect(() => {
    if (schoolId) swr(key, () => listNotices(schoolId), setNotices).catch(() => setNotices((n) => n ?? []));
  }, [schoolId, key]);
  const update = (fn) =>
    setNotices((n) => {
      const next = fn(n ?? []);
      remember(key, next);
      return next;
    });
  return [notices, update];
}

// The Noticeboard page: news, updates and circulars. Staff post (and their
// own, or any for owners/admins, can be pinned or removed); parents read.
// me: the signed-in staff email (none for parents). since: last visit, to
// mark notices New.
export default function NoticeBoard({ schoolId, me, isAdmin = false, compose, onCompose, since }) {
  const [notices, setNotices] = useNotices(schoolId);
  const [error, setError] = useState("");
  const canPost = Boolean(me);
  const canManage = (n) => canPost && (isAdmin || n.created_by === me);

  async function pin(n) {
    setError("");
    try {
      const saved = await updateNotice(n.id, { pinned: !n.pinned });
      setNotices((all) => sortNotices(all.map((x) => (x.id === n.id ? saved : x))));
    } catch {
      setError("Couldn’t change that. Check your connection.");
    }
  }
  async function remove(n) {
    setError("");
    try {
      await deleteNotice(n.id);
      setNotices((all) => all.filter((x) => x.id !== n.id));
    } catch {
      setError("Couldn’t remove that. Check your connection.");
    }
  }

  return (
    <div className="notices">
      {error && <p className="notice notice-error">{error}</p>}
      {notices === null && <div className="nb-skeleton" aria-busy="true" />}
      {notices?.length === 0 && (
        <div className="nb-empty">
          <span className="nb-empty-icon">
            <Icon name="notice" size={26} />
          </span>
          <strong>No notices yet</strong>
          <span className="row-sub">{canPost ? "Post news, updates and circulars for the school here." : "News and circulars from the school show up here."}</span>
          {canPost && (
            <button className="btn btn-primary" onClick={() => onCompose(true)}>
              <Icon name="plus" /> Post a notice
            </button>
          )}
        </div>
      )}
      {notices?.length > 0 && (
        <ul className="nb-list">
          {notices.map((n, i) => (
            <Notice key={n.id} n={n} index={i} fresh={Boolean(since && n.created_at > since)} staffView={canPost} manage={canManage(n)} onPin={() => pin(n)} onRemove={() => remove(n)} />
          ))}
        </ul>
      )}
      {compose && <Compose schoolId={schoolId} onClose={() => onCompose(false)} onPosted={(n) => setNotices((all) => sortNotices([n, ...all]))} />}
    </div>
  );
}

// One notice. Long text is cut to four lines with Read more, only when it
// really is cut (measured, so wide screens don't offer it for nothing).
function Notice({ n, index, fresh, staffView, manage, onPin, onRemove }) {
  const [expanded, setExpanded] = useState(false);
  const [cut, setCut] = useState(false);
  const body = useRef(null);
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || expanded) return;
    const fit = () => setCut(el.scrollHeight > el.clientHeight + 1);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [n.body, expanded]);
  return (
    <li className={`nb-item${n.pinned ? " is-pinned" : ""}`} style={{ "--d": `${Math.min(index, 8) * 45}ms` }}>
      <div className="nb-head">
        <h3>{n.title}</h3>
        {n.pinned && !manage && (
          <span className="nb-pin" title="Pinned" aria-label="Pinned">
            <Icon name="pushpin" size={15} weight="fill" />
          </span>
        )}
        {fresh && <span className="pa-new-tag">New</span>}
      </div>
      {n.body && (
        <p ref={body} className={`nb-body${expanded ? "" : " is-clamped"}`}>
          {n.body}
        </p>
      )}
      {(cut || expanded) && (
        <button className="link-btn nb-more" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
      <div className="nb-foot">
        <span className="row-sub">
          {n.author_name ? `${n.author_name} · ` : ""}
          {when(n.created_at)}
        </span>
        {staffView && !n.for_parents && (
          <span className="nb-staff-only" title="Only staff can see this">
            <Icon name="teacher" size={14} /> Staff only
          </span>
        )}
        {manage && (
          <span className="nb-actions">
            <button className={`icon-btn-sm${n.pinned ? " is-on" : ""}`} onClick={onPin} aria-label={n.pinned ? "Unpin" : "Pin to top"} title={n.pinned ? "Unpin" : "Pin to top"}>
              <Icon name="pushpin" size={16} weight={n.pinned ? "fill" : "regular"} />
            </button>
            <RemoveButton onRemove={onRemove} />
          </span>
        )}
      </div>
    </li>
  );
}

const sortNotices = (all) => [...all].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at));

// Tap once to arm, again to remove: no browser dialog.
function RemoveButton({ onRemove }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button className={`icon-btn-sm${armed ? " is-danger" : ""}`} onClick={() => (armed ? onRemove() : setArmed(true))} aria-label={armed ? "Tap again to remove" : "Remove"} title={armed ? "Tap again to remove" : "Remove"}>
      <Icon name="trash" size={16} />
      {armed && <span className="nb-confirm">Remove?</span>}
    </button>
  );
}

// Title, message, and who sees it. Short, so one step.
function Compose({ schoolId, onClose, onPosted }) {
  const [form, setForm] = useState({ title: "", body: "", for_parents: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function post(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setBusy(true);
    setError("");
    try {
      onPosted(await postNotice(schoolId, form));
      onClose();
    } catch {
      setError("Couldn’t post. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal nb-compose" onClick={(e) => e.stopPropagation()} onSubmit={post} aria-label="New notice">
        <header className="modal-header">
          <h2>
            <Icon name="notice" /> New notice
          </h2>
          <button type="button" className="icon-btn-sm" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="modal-body nb-form">
          <input className="textarea nb-title-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title, e.g. Sports day on Friday" maxLength={140} required autoFocus />
          <textarea className="textarea nb-body-input" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Details (optional)" maxLength={4000} rows={6} />
          <div className="segmented segmented-sm nb-audience" role="radiogroup" aria-label="Who can see it">
            <button type="button" role="radio" aria-checked={form.for_parents} className={form.for_parents ? "active" : ""} onClick={() => setForm({ ...form, for_parents: true })}>
              <Icon name="users" size={16} /> Parents & staff
            </button>
            <button type="button" role="radio" aria-checked={!form.for_parents} className={!form.for_parents ? "active" : ""} onClick={() => setForm({ ...form, for_parents: false })}>
              <Icon name="teacher" size={16} /> Staff only
            </button>
          </div>
          {error && <p className="field-error">{error}</p>}
        </div>
        <footer className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !form.title.trim()}>
            <Icon name="send" /> {busy ? "Posting…" : "Post"}
          </button>
        </footer>
      </form>
    </div>
  );
}

// A few notices for Home, with a link to the page.
export function NoticePeek({ schoolId, onOpen, newCount = 0 }) {
  const [notices] = useNotices(schoolId);
  if (!notices?.length) return null;
  const top = notices.slice(0, 2);
  return (
    <section className="nb-peek">
      <button className="nb-peek-head" onClick={onOpen}>
        <span className="home-need-icon">
          <Icon name="notice" size={18} />
        </span>
        <strong>Noticeboard</strong>
        {newCount > 0 && <span className="seg-count">{newCount > 99 ? "99+" : newCount}</span>}
        <span className="nb-peek-all">
          See all <Icon name="arrowRight" size={14} />
        </span>
      </button>
      {top.map((n) => (
        <button key={n.id} className="nb-peek-item" onClick={onOpen}>
          <span className="nb-peek-title">
            {n.pinned && <Icon name="pushpin" size={13} weight="fill" />}
            {n.title}
          </span>
          <span className="row-sub">{when(n.created_at)}</span>
        </button>
      ))}
    </section>
  );
}
