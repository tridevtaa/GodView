import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NOTICE_IMAGE_DAYS, clearExpiredNoticeImages, deleteNotice, listNotices, noticeImageUrls, postNotice, removeNoticeImage, updateNotice, uploadNoticeImage } from "../data/api.js";
import { peek, remember, swr } from "../data/cache.js";
import Icon from "./Icon.jsx";

// A notice can be tagged with one of these, for the homepage's achievements
// strip (and a small tag on the noticeboard itself). tone matches the t-*
// colour classes shared across the app (Widgets.jsx, StatCards.jsx).
export const CATEGORIES = [
  ["sports", "Sports", "indigo"],
  ["academic", "Academic", "violet"],
  ["cultural", "Cultural", "pink"],
  ["environment", "Environment", "green"],
  ["other", "Other", "amber"],
];
export const CATEGORY = Object.fromEntries(CATEGORIES.map(([k, label, tone]) => [k, { label, tone }]));

const when = (d) => {
  const t = new Date(d);
  const days = Math.floor((Date.now() - t) / 864e5);
  if (days < 1 && new Date().toDateString() === t.toDateString()) return "Today";
  if (days < 2) return "Yesterday";
  return t.toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(days > 300 ? { year: "numeric" } : {}) });
};

// A notice's date as a little tear-off calendar leaf: month, day, weekday.
export function DateLeaf({ date, small = false }) {
  const d = new Date(`${date}T00:00:00`);
  return (
    <span className={`date-leaf${small ? " is-small" : ""}`} aria-label={d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}>
      <span className="date-leaf-month">{d.toLocaleDateString("en-IN", { month: "short" })}</span>
      <span className="date-leaf-day">{d.getDate()}</span>
      {!small && <span className="date-leaf-week">{d.toLocaleDateString("en-IN", { weekday: "short" })}</span>}
    </span>
  );
}

// A notice's picture is shown for NOTICE_IMAGE_DAYS after posting, then
// removed (even before the clean-up has run, it stops showing).
export const showsImage = (n) => Boolean(n.image_path) && Date.now() - new Date(n.created_at) < NOTICE_IMAGE_DAYS * 864e5;

// Links for the notices' pictures (private), fetched once per session.
export function useImageUrls(notices) {
  const [urls, setUrls] = useState(new Map());
  const paths = (notices ?? []).filter(showsImage).map((n) => n.image_path);
  const key = paths.join("|");
  useEffect(() => {
    if (key) noticeImageUrls(key.split("|")).then(setUrls, () => {});
  }, [key]);
  return urls;
}

// The school's notices, shared by Home (a few) and the Noticeboard page.
// Remembered for the session so Home and the page open filled.
// staff: also clear out expired pictures first (once a visit).
export function useNotices(schoolId, staff = false) {
  const key = `notices:${schoolId}`;
  const [notices, setNotices] = useState(() => peek(key) ?? null);
  useEffect(() => {
    if (!schoolId) return;
    const load = () => listNotices(schoolId);
    swr(key, staff ? () => clearExpiredNoticeImages(schoolId).catch(() => {}).then(load) : load, setNotices).catch(() => setNotices((n) => n ?? []));
  }, [schoolId, key, staff]);
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
  const [notices, setNotices] = useNotices(schoolId, Boolean(me));
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState(null); // picture shown full size
  const urls = useImageUrls(notices);
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
      await deleteNotice(n);
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
            <Notice key={n.id} n={n} image={urls.get(n.image_path)} onView={setViewing} index={i} fresh={Boolean(since && n.created_at > since)} staffView={canPost} manage={canManage(n)} onPin={() => pin(n)} onRemove={() => remove(n)} />
          ))}
        </ul>
      )}
      {viewing && <ImageViewer src={viewing} onClose={() => setViewing(null)} />}
      {compose && <Compose schoolId={schoolId} onClose={() => onCompose(false)} onPosted={(n) => setNotices((all) => sortNotices([n, ...all]))} />}
    </div>
  );
}

// One notice. Long text is cut to four lines with Read more, only when it
// really is cut (measured, so wide screens don't offer it for nothing).
function Notice({ n, image, onView, index, fresh, staffView, manage, onPin, onRemove }) {
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
    <li className={`nb-item${n.pinned ? " is-pinned" : ""}${showsImage(n) ? " has-image" : ""}`} style={{ "--d": `${Math.min(index, 8) * 45}ms` }}>
      {/* The picture as a cover, the date leaf pinned on it */}
      {showsImage(n) && (
        <button className="nb-cover" onClick={() => image && onView(image)} aria-label="View picture">
          {image ? <img src={image} alt="" loading="lazy" onLoad={(e) => e.currentTarget.classList.add("is-in")} /> : <span className="nb-cover-wait" />}
          {n.event_on && <DateLeaf date={n.event_on} />}
        </button>
      )}
      <div className="nb-head">
        {n.event_on && !showsImage(n) && <DateLeaf date={n.event_on} />}
        <h3>{n.title}</h3>
        {n.category && CATEGORY[n.category] && <span className={`achv-tag t-${CATEGORY[n.category].tone}`}>{CATEGORY[n.category].label}</span>}
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
  const [form, setForm] = useState({ title: "", body: "", for_parents: true, event_on: "", category: "" });
  const [picture, setPicture] = useState(null); // { file, preview }
  const fileInput = useRef(null);
  useEffect(() => () => picture && URL.revokeObjectURL(picture.preview), [picture]);
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
    let image_path = null;
    try {
      if (picture) image_path = await uploadNoticeImage(schoolId, picture.file);
      onPosted(await postNotice(schoolId, { ...form, image_path, category: form.category || null }));
      onClose();
    } catch {
      removeNoticeImage(image_path); // don't leave an unused picture behind
      setError(picture && !image_path ? "Couldn’t upload the picture. Try a different one." : "Couldn’t post. Check your connection and try again.");
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
          <textarea className="textarea nb-body-input" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Details (optional)" maxLength={4000} rows={5} />
          {picture && (
            <div className="nb-pick-preview">
              <img src={picture.preview} alt="" />
              <span className="nb-pick-note">Shown for {NOTICE_IMAGE_DAYS} days</span>
              <button type="button" className="nb-pick-remove" onClick={() => setPicture(null)} aria-label="Remove picture">
                <Icon name="x" size={16} />
              </button>
            </div>
          )}
          <div className="nb-extras">
            <label className={`nb-chip${form.event_on ? " is-set" : ""}`}>
              <Icon name="calendar" size={16} />
              {form.event_on ? new Date(`${form.event_on}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) : "Add a date"}
              <input type="date" value={form.event_on} onChange={(e) => setForm({ ...form, event_on: e.target.value })} aria-label="Date (optional)" />
            </label>
            {form.event_on && (
              <button type="button" className="icon-btn-sm" onClick={() => setForm({ ...form, event_on: "" })} aria-label="Remove date">
                <Icon name="x" size={14} />
              </button>
            )}
            {!picture && (
              <button type="button" className="nb-chip" onClick={() => fileInput.current?.click()} title={`Pictures are removed ${NOTICE_IMAGE_DAYS} days after posting`}>
                <Icon name="image" size={16} /> Add a picture
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file?.type.startsWith("image/")) setPicture({ file, preview: URL.createObjectURL(file) });
              }}
            />
          </div>
          <div className="segmented segmented-sm nb-audience" role="radiogroup" aria-label="Who can see it">
            <button type="button" role="radio" aria-checked={form.for_parents} className={form.for_parents ? "active" : ""} onClick={() => setForm({ ...form, for_parents: true })}>
              <Icon name="users" size={16} /> Parents & staff
            </button>
            <button type="button" role="radio" aria-checked={!form.for_parents} className={!form.for_parents ? "active" : ""} onClick={() => setForm({ ...form, for_parents: false })}>
              <Icon name="teacher" size={16} /> Staff only
            </button>
          </div>
          <div className="nb-category" role="radiogroup" aria-label="A milestone to celebrate? (optional)">
            <span className="row-sub">A win to celebrate? (optional, shows on the homepage with a picture)</span>
            <div className="nb-category-chips">
              {CATEGORIES.map(([k, label, tone]) => (
                <button
                  type="button"
                  key={k}
                  role="radio"
                  aria-checked={form.category === k}
                  className={`achv-tag t-${tone}${form.category === k ? " is-on" : ""}`}
                  onClick={() => setForm({ ...form, category: form.category === k ? "" : k })}
                >
                  {label}
                </button>
              ))}
            </div>
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

// A notice's picture, full screen; tap anywhere or Escape to close.
function ImageViewer({ src, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="nb-viewer" onClick={onClose} role="dialog" aria-label="Picture">
      <img src={src} alt="" />
      <button className="nb-viewer-close" aria-label="Close">
        <Icon name="x" size={20} />
      </button>
    </div>,
    document.body
  );
}
