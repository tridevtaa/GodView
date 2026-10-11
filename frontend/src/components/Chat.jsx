import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { answerRequest, cancelParentRequest, loadThread, markThreadRead, sendMessage } from "../data/api.js";
import Icon from "./Icon.jsx";

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
// viewer: "staff" or "parent". me: staff email or parent phone (+91…).
// canSend: may write. canAnswer: staff who may approve requests.
// actions: extra buttons beside the box (the parent's Leave / Certificate).
export default function Chat({ studentId, viewer, me, canSend = true, canAnswer = false, actions, refreshKey = 0, onRead }) {
  const [items, setItems] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const end = useRef(null);
  const box = useRef(null);
  const count = useRef(0);

  const load = useCallback(async () => {
    try {
      const rows = await loadThread(studentId);
      setItems(rows);
      setError("");
      if (viewer === "staff") markThreadRead(studentId).then(onRead, () => {});
    } catch {
      setError("Couldn’t load the conversation. Check your connection.");
    }
  }, [studentId, viewer, onRead]);

  // Load now, when asked, and every 15 seconds while the screen is on.
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 15000);
    return () => clearInterval(t);
  }, [load, refreshKey]);

  // Keep the latest message in view.
  useLayoutEffect(() => {
    if (items && items.length !== count.current) {
      end.current?.scrollIntoView({ block: "end" });
      count.current = items.length;
    }
  }, [items]);

  async function send(e) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError("");
    try {
      const saved = await sendMessage(studentId, body);
      setItems((x) => [...(x ?? []), saved]);
      setText("");
      box.current?.focus();
    } catch {
      setError("Couldn’t send. Try again.");
    } finally {
      setBusy(false);
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
    <div className="chat">
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
            <li key={`${m.type}-${m.id}`} className="chat-item">
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
                <div className={`bubble-row${mine(m) ? " is-mine" : ""}${m.from_parent ? " is-parent" : ""}`}>
                  <div className="bubble">
                    {!mine(m) && !sameAuthor && (
                      <span className="bubble-who">
                        {m.author_name || (m.from_parent ? "Parent" : "School")}
                        {ROLE[m.author_role] && <span> · {ROLE[m.author_role]}</span>}
                      </span>
                    )}
                    <p>{m.body}</p>
                    <time dateTime={m.created_at}>{time(m.created_at)}</time>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {error && <p className="field-error">{error}</p>}
      {canSend && (
        <form className="chat-compose" onSubmit={send}>
          {actions}
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
          <button className="chat-send" disabled={busy || !text.trim()} aria-label="Send">
            <Icon name="send" size={18} />
          </button>
        </form>
      )}
      <div ref={end} className="chat-end" />
    </div>
  );
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
