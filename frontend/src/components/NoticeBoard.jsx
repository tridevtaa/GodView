import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NOTICE_IMAGE_DAYS, clearExpiredNoticeImages, deleteNotice, listNotices, logoUrl, noticeImageUrls, postNotice, removeNoticeImage, updateNotice, uploadNoticeImage } from "../data/api.js";
import { peek, remember, swr } from "../data/cache.js";
import Icon from "./Icon.jsx";
import { haptic } from "../pwa/haptics.js";

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

const longDate = (d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

// A letter's text, formatted from plain typing: a line starting with - is a
// point; a line ending in : with points under it is a heading.
const POINT = /^\s*[-•*]\s+/;
export function LetterBody({ text }) {
  const lines = String(text ?? "").split("\n").map((l) => l.trimEnd());
  const nextFilled = (i) => lines.slice(i + 1).find((l) => l.trim());
  return (
    <div className="letter-body">
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="letter-gap" />;
        if (POINT.test(line)) return <p key={i} className="letter-point">{line.replace(POINT, "")}</p>;
        if (/:$/.test(line.trim()) && POINT.test(nextFilled(i) ?? "")) return <p key={i} className="letter-heading">{line.trim()}</p>;
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

// The notice as the school's letter: its logo and name, the title, the date,
// the greeting, the text and the sign-off.
export function LetterPage({ school, title, body, forParents, signedBy, date, preview = false }) {
  const address = [school?.address, school?.city, school?.state, school?.pincode].filter(Boolean).join(", ");
  return (
    <article className={`receipt cert letter${preview ? " has-mark" : ""}`} data-mark={preview ? "PREVIEW" : undefined}>
      <header className="letter-head">
        {school?.logo_path && <img src={logoUrl(school.logo_path)} alt="" />}
        <h2>{school?.name}</h2>
        {address && <p>{address}</p>}
      </header>
      <h3 className="cert-title">{title}</h3>
      <p className="letter-date">Date: {longDate(date)}</p>
      <p className="letter-greeting">{forParents ? "Dear Parents," : "Dear Staff,"}</p>
      <LetterBody text={body} />
      <p className="letter-sign">
        Regards,
        <br />
        <strong>{signedBy || "Principal"}</strong>
      </p>
    </article>
  );
}

// A letter opened from the noticeboard, to read and to print or save.
function LetterView({ school, notice, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop receipt-backdrop" onClick={onClose}>
      <section className="modal receipt-modal cert-modal" onClick={(e) => e.stopPropagation()} aria-label={notice.title}>
        <div className="receipt-tools no-print">
          <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
            <Icon name="file" /> Print / Save PDF
          </button>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>
        <LetterPage school={school} title={notice.title} body={notice.body} forParents={notice.for_parents} signedBy={notice.signed_by} date={notice.created_at} />
      </section>
    </div>,
    document.body
  );
}

// The Noticeboard page: news, updates and circulars. Staff post (and their
// own, or any for owners/admins, can be pinned or removed); parents read.
// me: the signed-in staff email (none for parents). since: last visit, to
// mark notices New.
// only: which show, for staff, whose top bar chooses. Parents switch here.
// school: its name and logo, for notices on the letterhead.
export default function NoticeBoard({ school, schoolId, me, isAdmin = false, compose, onCompose, since }) {
  const [notices, setNotices] = useNotices(schoolId, Boolean(me));
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState(null); // picture shown full size
  const [letter, setLetter] = useState(null); // notice opened as a letter
  const urls = useImageUrls(notices);
  // All, or only the students' wins (notices tagged with a category).
  const [picked, setOnly] = useState("all");
  const hasWins = (notices ?? []).some((n) => n.category);
  const only = hasWins ? picked : "all";
  const shown = only === "wins" ? notices?.filter((n) => n.category) : notices;
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
      {hasWins && (
        <nav className="segmented segmented-sm nb-filter" aria-label="Show">
          {[
            ["all", "All"],
            ["wins", "News & Achievements"],
          ].map(([v, l]) => (
            <button key={v} className={only === v ? "active" : ""} onClick={() => setOnly(v)}>
              {l}
            </button>
          ))}
        </nav>
      )}
      {shown?.length > 0 && (
        <ul className="nb-list">
          {shown.map((n, i) => (
            <Notice key={n.id} n={n} image={urls.get(n.image_path)} onView={setViewing} onLetter={setLetter} index={i} fresh={Boolean(since && n.created_at > since)} staffView={canPost} manage={canManage(n)} onPin={() => pin(n)} onRemove={() => remove(n)} />
          ))}
        </ul>
      )}
      {viewing && <ImageViewer src={viewing} onClose={() => setViewing(null)} />}
      {letter && <LetterView school={school} notice={letter} onClose={() => setLetter(null)} />}
      {compose && <Compose school={school} isAdmin={isAdmin} schoolId={schoolId} onClose={() => onCompose(false)} onPosted={(n) => setNotices((all) => sortNotices([n, ...all]))} />}
    </div>
  );
}

// One notice. Long text is cut to four lines with Read more, only when it
// really is cut (measured, so wide screens don't offer it for nothing).
function Notice({ n, image, onView, onLetter, index, fresh, staffView, manage, onPin, onRemove }) {
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
      {n.letterhead ? (
        <button className="link-btn nb-more nb-letter-open" onClick={() => onLetter(n)}>
          <Icon name="file" size={15} /> View letter
        </button>
      ) : (
        (cut || expanded) && (
          <button className="link-btn nb-more" onClick={() => setExpanded((e) => !e)}>
            {expanded ? "Show less" : "Read more"}
          </button>
        )
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
function Compose({ school, isAdmin, schoolId, onClose, onPosted }) {
  const [form, setForm] = useState({ title: "", body: "", for_parents: true, event_on: "", category: "", letterhead: false, signed_by: "Principal" });
  // On the letterhead: check it as a letter before it goes out
  const [previewing, setPreviewing] = useState(false);
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

  const ready = form.title.trim() && (!form.letterhead || form.body.trim());
  async function post(e) {
    e.preventDefault();
    if (!ready) return;
    if (form.letterhead && !previewing) return setPreviewing(true);
    setBusy(true);
    setError("");
    let image_path = null;
    try {
      if (picture) image_path = await uploadNoticeImage(schoolId, picture.file);
      onPosted(await postNotice(schoolId, { ...form, image_path, category: form.category || null }));
      haptic("success");
      onClose();
    } catch {
      removeNoticeImage(image_path); // don't leave an unused picture behind
      setError(picture && !image_path ? "Couldn’t upload the picture. Try a different one." : "Couldn’t post. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className={`modal nb-compose${previewing ? " modal-lg" : ""}`} onClick={(e) => e.stopPropagation()} onSubmit={post} aria-label="New notice">
        <header className="modal-header">
          <h2>
            <Icon name="notice" /> New notice
          </h2>
          <button type="button" className="icon-btn-sm" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        {previewing && (
          <div className="modal-body">
            <LetterPage school={school} title={form.title.trim()} body={form.body.trim()} forParents={form.for_parents} signedBy={form.signed_by.trim()} date={new Date()} preview />
            {error && <p className="field-error">{error}</p>}
          </div>
        )}
        <div className="modal-body nb-form" hidden={previewing}>
          <input className="textarea nb-title-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title, e.g. Sports day on Friday" maxLength={140} required autoFocus />
          <textarea className="textarea nb-body-input" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder={form.letterhead ? "Write the notice" : "Details (optional)"} maxLength={4000} rows={form.letterhead ? 9 : 5} />
          {form.letterhead && <p className="row-sub nb-letter-hint">Start a line with - for a point. End the line above points with : to make it a heading.</p>}
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
            {isAdmin && (
              <button
                type="button"
                className={`nb-chip${form.letterhead ? " is-set" : ""}`}
                aria-pressed={form.letterhead}
                onClick={() => {
                  setForm({ ...form, letterhead: !form.letterhead, category: "" });
                  setPicture(null);
                }}
              >
                <Icon name="certificate" size={16} /> School letterhead
              </button>
            )}
            {!picture && !form.letterhead && (
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
          {form.letterhead && (
            <label className="nb-signed">
              <span className="row-sub">Signed by</span>
              <input className="textarea" value={form.signed_by} onChange={(e) => setForm({ ...form, signed_by: e.target.value })} maxLength={80} placeholder="Principal" />
            </label>
          )}
          <div className="nb-category" role="radiogroup" aria-label="A milestone to celebrate? (optional)" hidden={form.letterhead}>
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
          <button type="button" className="btn" onClick={() => (previewing ? setPreviewing(false) : onClose())}>
            {previewing ? "Back" : "Cancel"}
          </button>
          <button className="btn btn-primary" disabled={busy || !ready}>
            {form.letterhead && !previewing ? (
              <>
                Preview <Icon name="arrowRight" />
              </>
            ) : (
              <>
                <Icon name="send" /> {busy ? "Posting…" : "Post"}
              </>
            )}
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

// Shared by the staff and parent Homes.
// Students' wins, posted the same way as any notice (just tagged with a
// category and a picture). Nothing to show yet: the section just stays
// off the page, rather than taking up room with an empty box. viewAll:
// only when the banner (which has its own) is off the page.
export const isWin = (x) => Boolean(x.category) && showsImage(x);

export function AchievementsStrip({ items, urls, viewAll, onOpenNotices }) {
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
                  <span className="row-sub">{new Date(it.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
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
