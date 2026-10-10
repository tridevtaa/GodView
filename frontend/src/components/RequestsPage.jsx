import { useCallback, useEffect, useState } from "react";
import { answerRequest, listRequests } from "../data/api.js";

const KIND = { leave: "Leave", certificate: "Certificate", message: "Message" };
const STATUS = {
  open: ["Open", "badge-warning"],
  approved: ["Approved", "badge-success"],
  rejected: ["Not approved", "badge-danger"],
  resolved: ["Resolved", "badge-success"],
  cancelled: ["Withdrawn", "badge-neutral"],
};
const fmt = (d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const showPhone = (p) => p.replace(/^\+91(\d{5})(\d{5})$/, "+91 $1 $2");
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000) + 1;

// Requests from parents. Owners/admins see all; teachers see their classes'.
export default function RequestsPage({ school, me, onOpenStudent, onChanged, readOnly = false }) {
  const [filter, setFilter] = useState("open");
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setRequests(await listRequests(school.id, { status: filter }));
      setError("");
    } catch {
      setError("Couldn’t load requests.");
    }
  }, [school.id, filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function answer(r, status, response) {
    try {
      await answerRequest(r.id, status, response, me);
      await load();
      onChanged?.();
    } catch {
      setError("Couldn’t save that. Try again.");
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="sr-only">Requests</h1>
          <div className="page-meta">
            <span className="page-count">Requests</span>
            <nav className="segmented segmented-sm" aria-label="Filter">
              {[
                ["open", "Open"],
                ["all", "All"],
              ].map(([v, l]) => (
                <button key={v} className={filter === v ? "active" : ""} onClick={() => setFilter(v)}>
                  {l}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </div>

      {error && <p className="notice notice-error">{error}</p>}

      {requests === null ? (
        <p className="row-sub">Loading…</p>
      ) : requests.length === 0 ? (
        <div className="empty">
          <p className="empty-title">{filter === "open" ? "No open requests" : "No requests yet"}</p>
          <p>Leave and certificate requests from parents land here.</p>
        </div>
      ) : (
        <div className="request-list">
          {requests.map((r) => (
            <RequestCard key={r.id} request={r} onAnswer={answer} onOpenStudent={onOpenStudent} readOnly={readOnly} />
          ))}
        </div>
      )}
    </>
  );
}

function RequestCard({ request: r, onAnswer, onOpenStudent, readOnly }) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [label, tone] = STATUS[r.status];
  // The principal sees requests but doesn't answer them.
  const open = r.status === "open" && !readOnly;

  const act = (status) => async () => {
    setBusy(true);
    await onAnswer(r, status, reply);
    setBusy(false);
  };

  return (
    <article className="request-card">
      {/* Who and when on one line; the kind only when the subject doesn't say it. */}
      <header>
        <button className="link-btn request-student" onClick={() => onOpenStudent(r.student?.id)}>
          {r.student?.name ?? "Student"}
        </button>
        <span className="row-sub">
          {r.guardian ? `${r.guardian.name || showPhone(r.guardian.phone)} · ` : ""}
          {fmt(r.created_at)}
        </span>
        {r.status !== "open" && <span className={`badge ${tone}`}>{label}</span>}
      </header>
      <h3>
        {r.subject?.trim().toLowerCase() === KIND[r.kind].toLowerCase() || !r.subject ? KIND[r.kind] : `${KIND[r.kind]}: ${r.subject}`}
      </h3>
      {r.kind === "leave" && r.leave_from && (
        <p className="request-dates">
          {fmt(r.leave_from)}
          {r.leave_to !== r.leave_from ? ` to ${fmt(r.leave_to)}` : ""} · {days(r.leave_from, r.leave_to)} day
          {days(r.leave_from, r.leave_to) > 1 ? "s" : ""}
        </p>
      )}
      {r.kind === "certificate" && r.certificate_type && <p className="request-dates">{r.certificate_type}</p>}
      {r.body && <p className="request-body">{r.body}</p>}

      {r.response && !open && (
        <p className="request-response">
          <strong>Reply:</strong> {r.response}
          {r.handled_by ? <span className="row-sub"> · {r.handled_by}</span> : null}
        </p>
      )}

      {open && (
        <div className="request-actions">
          <input
            className="input"
            placeholder="Reply (optional)"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            maxLength={2000}
          />
          {r.kind === "message" ? (
            <button className="btn btn-primary btn-sm" onClick={act("resolved")} disabled={busy}>
              Mark resolved
            </button>
          ) : (
            <>
              <button className="btn btn-secondary btn-sm" onClick={act("rejected")} disabled={busy}>
                Decline
              </button>
              <button className="btn btn-primary btn-sm" onClick={act("approved")} disabled={busy}>
                Approve
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}
