import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { answerRequest, cancelParentRequest, loadThread, markThreadRead, sendMessage } from "../data/api.js";
import Icon from "./Icon.jsx";
import { onFresh } from "../pwa/fresh.js";
import { haptic } from "../pwa/haptics.js";

const KIND = { leave: "Leave", certificate: "Certificate", message: "Message" };
const STATUS = {
  open: ["Waiting", "badge-warning"],
  approved: ["Approved", "badge-success"],
  rejected: ["Declined", "badge-danger"],
  resolved: ["Done", "badge-success"],
  cancelled: ["Withdrawn", "badge-neutral"],
};
const ROLE = { owner: "Office", admin: "Office", principal: "Principal", teacher: "Teacher", father: "Father", mother: "Mother", guardian: "Guardian" };

const time = (iso) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const short = (d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
function dayLabel(iso) {
  const d = new Date(iso);
  const t = new Date();
  const y = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === t.getFullYear() ? undefined : "numeric" });
}

// A child's conversation, like a messaging app: parents, the child's
// teachers and the office in one thread. Leave and certificate requests show
// as cards; staff approve or decline them here.
//
// The messages scroll inside the conversation and the box sits under them,
// so the page itself never moves. With screen, phones show it as a screen
// of its own (the part of the screen the keyboard leaves, see
// pwa/viewport.js) over the tab bar, with head as its top bar; Back closes
// it (onClose). On computers it fills whatever box it is put in.
//
// viewer: "staff" or "parent". me: staff email or parent phone (+91…).
// canSend: may write. canAnswer: staff who may approve requests.
// actions: extra buttons beside the box (the parent's Leave / Certificate).
// head: the top bar (who this is about); headOnPhone: only on phones.
export default function Chat({ studentId, viewer, me, canSend = true, canAnswer = false, actions, refreshKey = 0, onRead, head, headOnPhone = false, screen = false }) {
  const [items, setItems] = useState(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const scroller = useRef(null);
  const box = useRef(null);
  // Follow new messages only while reading the newest (not when scrolled up
  // to read older ones), and always after sending.
  const atEnd = useRef(true);
  const stick = useRef(true);

  const load = useCallback(async () => {
    try {
      const rows = await loadThread(studentId);
      // Keep messages still being sent (not saved yet) at the end.
      setItems((x) => [...rows, ...(x ?? []).filter((m) => m.pending)]);
      setError("");
      if (viewer === "staff") markThreadRead(studentId).then(onRead, () => {});
    } catch {
      setError("Couldn’t load the conversation. Check your connection.");
    }
  }, [studentId, viewer, onRead]);

  // Load now, when asked, when the app comes back on screen or a
  // notification comes in, and every 15 seconds while the screen is on.
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 15000);
    const stop = onFresh(load);
    return () => {
      clearInterval(t);
      stop();
    };
  }, [load, refreshKey]);

  // Newest at the bottom, in view.
  const toEnd = () => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  };
  useLayoutEffect(() => {
    if (items && (stick.current || atEnd.current)) toEnd();
    stick.current = false;
  }, [items]);
  // The keyboard opening (or the box growing) makes the list shorter: stay
  // at the newest message if that's where the reader was.
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => atEnd.current && toEnd());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const onScroll = () => {
    const el = scroller.current;
    atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // The box grows with what's typed, up to a few lines.
  const grow = () => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };
  useLayoutEffect(grow, [text]);

  // Shown at once, marked as sending; replaced by the saved message.
  async function send(e) {
    e?.preventDefault();
    const body = text.trim();
    if (!body) return;
    const temp = {
      id: `sending-${Date.now()}`,
      type: "message",
      pending: true,
      body,
      author: me,
      from_parent: viewer === "parent",
      created_at: new Date().toISOString(),
    };
    stick.current = true;
    setItems((x) => [...(x ?? []), temp]);
    setText("");
    setError("");
    try {
      const saved = await sendMessage(studentId, body);
      haptic("success");
      setItems((x) => {
        const list = x ?? [];
        if (list.some((m) => m.id === saved.id)) return list.filter((m) => m.id !== temp.id);
        return list.some((m) => m.id === temp.id) ? list.map((m) => (m.id === temp.id ? saved : m)) : [...list, saved];
      });
    } catch {
      setItems((x) => (x ?? []).filter((m) => m.id !== temp.id));
      setText((t) => t || body);
      setError("Couldn’t send. Try again.");
    }
  }

  async function answer(r, status) {
    try {
      await answerRequest(r.id, status, null, me);
      await load();
    } catch {
      setError("Couldn’t update the request. Try again.");
    }
  }

  async function withdraw(r) {
    try {
      await cancelParentRequest(r.id);
    } catch {
      // Already answered; the reload shows it.
    }
    load();
  }

  const mine = (m) => (viewer === "staff" ? !m.from_parent && m.author === me : m.from_parent && m.author === me);

  return (
    <div className={`chat${screen ? " is-screen" : ""}`}>
      {head && <header className={`chat-head${headOnPhone ? " is-phone-only" : ""}`}>{head}</header>}
      <div className="chat-scroll" ref={scroller} onScroll={onScroll}>
        {items === null && !error && <p className="row-sub chat-empty">Loading…</p>}
        {items?.length === 0 && (
          <p className="row-sub chat-empty">
            {viewer === "staff" ? "No messages yet. Write to the parents below." : "No messages yet. Write to the school below."}
          </p>
        )}
        <ol className="chat-list">
          {items?.map((m, i) => {
            const prev = items[i - 1];
            const newDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at);
            const sameAuthor = prev && !newDay && prev.type === "message" && m.type === "message" && prev.author === m.author;
            return (
              <li key={`${m.type}-${m.id}`} className={`chat-item${sameAuthor ? " is-same" : ""}`}>
                {newDay && <div className="chat-day">{dayLabel(m.created_at)}</div>}
                {m.type === "request" ? (
                  <RequestCard
                    r={m}
                    canAnswer={canAnswer}
                    canWithdraw={viewer === "parent" && m.status === "open"}
                    onAnswer={(status) => answer(m, status)}
                    onWithdraw={() => withdraw(m)}
                  />
                ) : (
                  <div className={`bubble-row${mine(m) ? " is-mine" : ""}${m.from_parent ? " is-parent" : ""}${m.pending ? " is-pending" : ""}`}>
                    <div className="bubble">
                      {!mine(m) && !sameAuthor && (
                        <span className="bubble-who">
                          {m.author_name || (m.from_parent ? "Parent" : "School")}
                          {ROLE[m.author_role] && <span> · {ROLE[m.author_role]}</span>}
                        </span>
                      )}
                      <p>{m.body}</p>
                      <time dateTime={m.created_at}>{m.pending ? "Sending…" : time(m.created_at)}</time>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      {error && <p className="field-error chat-error">{error}</p>}
      {canSend && (
        <form className="chat-compose" onSubmit={send}>
          {actions}
          <div className="chat-box">
            <textarea
              ref={box}
              className="chat-input"
              rows={1}
              maxLength={2000}
              placeholder="Message"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends on a computer; Shift+Enter for a new line.
                if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer: coarse)").matches) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            {/* Keeps the keyboard up: tapping Send doesn't take focus from the box. */}
            <button className="chat-send" disabled={!text.trim()} aria-label="Send" onPointerDown={(e) => e.preventDefault()}>
              <Icon name="send" size={18} />
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// Phones: an open conversation is a screen of its own, so the phone's Back
// (or the arrow in its top bar) closes it instead of leaving the page under
// it. Returns close() for that arrow.
export function useBackToClose(active, onClose) {
  const pushed = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!active || !matchMedia("(max-width: 760px)").matches) return;
    window.history.pushState({ ...window.history.state, chat: true }, "");
    pushed.current = true;
    const onPop = () => {
      if (window.history.state?.chat) return;
      pushed.current = false;
      closeRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Closed some other way: this entry no longer opens anything.
      if (pushed.current) {
        pushed.current = false;
        const { chat, ...rest } = window.history.state ?? {};
        window.history.replaceState(rest, "");
      }
    };
  }, [active]);
  return useCallback(() => {
    if (pushed.current) window.history.back();
    else closeRef.current();
  }, []);
}

function RequestCard({ r, canAnswer, canWithdraw, onAnswer, onWithdraw }) {
  const [label, tone] = STATUS[r.status] ?? [r.status, "badge-neutral"];
  const title = r.kind === "certificate" && r.certificate_type ? r.certificate_type : KIND[r.kind];
  return (
    <div className={`chat-request is-${r.status}`}>
      <div className="chat-request-head">
        <span className="chat-request-icon">
          <Icon name={r.kind === "leave" ? "register" : "file"} size={16} />
        </span>
        <strong>{title}</strong>
        <span className={`badge ${tone}`}>{label}</span>
      </div>
      {r.kind === "leave" && r.leave_from && (
        <p className="chat-request-dates">
          {short(r.leave_from)}
          {r.leave_to !== r.leave_from ? ` to ${short(r.leave_to)}` : ""}
        </p>
      )}
      {r.subject && !/^(leave|.*certificate) for /i.test(r.subject) && <p className="chat-request-subject">{r.subject}</p>}
      {r.body && <p>{r.body}</p>}
      {r.response && <p className="chat-request-reply">School: {r.response}</p>}
      <div className="chat-request-foot">
        <time dateTime={r.created_at}>{time(r.created_at)}</time>
        {canAnswer && r.status === "open" && (
          <span className="chat-request-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => onAnswer("rejected")}>
              Decline
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => onAnswer("approved")}>
              Approve
            </button>
          </span>
        )}
        {canWithdraw && (
          <button className="link-btn" onClick={onWithdraw}>
            Withdraw
          </button>
        )}
      </div>
    </div>
  );
}
