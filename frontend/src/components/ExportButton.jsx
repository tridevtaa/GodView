import { useCallback, useEffect, useState } from "react";
import { listExportRequests, requestExport, consumeExportRequest } from "../data/api.js";
import { downloadStudentsCsv } from "../data/exportCsv.js";
import { useDismiss } from "./useDismiss.js";
import Icon from "./Icon.jsx";

// Owners export straight away. Admins request; once the owner approves, one
// download is allowed. Teachers don't get this button.
export default function ExportButton({ school, role, people, label }) {
  const [requests, setRequests] = useState([]);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useDismiss(asking, useCallback(() => setAsking(false), []));
  const isOwner = role === "owner";
  const filename = `${school.slug}-${label}-${new Date().toISOString().slice(0, 10)}.csv`;

  const refresh = useCallback(async () => {
    if (isOwner) return;
    try {
      setRequests(await listExportRequests(school.id));
    } catch {
      setRequests([]);
    }
  }, [isOwner, school.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const approved = requests.find((r) => r.status === "approved");
  const pending = requests.find((r) => r.status === "pending");

  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch {
      setError("Couldn’t complete that. Try again.");
    } finally {
      setBusy(false);
      refresh();
    }
  }

  if (isOwner) {
    return (
      <button className="btn btn-secondary" onClick={() => downloadStudentsCsv(people, filename)} disabled={!people.length} aria-label="Export" title="Export">
        <Icon name="file" />
        <span className="btn-label">Export</span>
      </button>
    );
  }

  if (approved) {
    return (
      <button
        className="btn btn-secondary is-active"
        disabled={busy}
        onClick={() =>
          run(async () => {
            if (await consumeExportRequest(approved.id)) downloadStudentsCsv(people, filename);
            else setError("That approval was already used.");
          })
        }
        title="Approved by the owner. Works once."
      >
        <Icon name="file" />
        <span className="btn-label">Download export</span>
      </button>
    );
  }

  if (pending) {
    return (
      <button className="btn btn-secondary" disabled title="Waiting for the owner to approve">
        <Icon name="file" />
        <span className="btn-label">Export requested</span>
      </button>
    );
  }

  return (
    <div className="popover-anchor" ref={ref}>
      <button className="btn btn-secondary" onClick={() => setAsking((a) => !a)} aria-expanded={asking}>
        <Icon name="file" />
        <span className="btn-label">Export</span>
      </button>
      {asking && (
        <form
          className="menu menu-right export-ask"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await requestExport(school.id, reason.trim() || null);
              setAsking(false);
              setReason("");
            });
          }}
        >
          <p className="row-sub">Exports need the owner’s approval. What is it for?</p>
          <input
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Board registration list"
            maxLength={500}
            autoFocus
          />
          <button className="btn btn-primary btn-sm" disabled={busy}>
            Send request
          </button>
          {error && <p className="field-error">{error}</p>}
        </form>
      )}
      {!asking && error && <p className="field-error">{error}</p>}
    </div>
  );
}
