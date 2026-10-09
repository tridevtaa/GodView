import { formatINR } from "./PersonCard.jsx";

export default function FeeSummary({ students, scope }) {
  const due = students.filter((s) => s.fee_due > 0);
  const pending = due.reduce((sum, s) => sum + s.fee_due, 0);
  const withPayments = students.filter((s) => typeof s.fee_paid === "number");
  const received = withPayments.reduce((sum, s) => sum + s.fee_paid, 0);
  const asOf = students.find((s) => s.fee_as_of)?.fee_as_of;

  return (
    <section className="fee-summary" aria-label="Fee summary">
      <div className="fee-stat">
        <span className="fee-stat-label">Total pending · {scope}</span>
        <span className="fee-stat-value pending">{formatINR(pending)}</span>
        <span className="fee-stat-note">
          {due.length} students{asOf ? ` · as of ${asOf}` : ""}
        </span>
      </div>
      <div className="fee-stat">
        <span className="fee-stat-label">Total received till date · {scope}</span>
        {withPayments.length > 0 ? (
          <>
            <span className="fee-stat-value received">{formatINR(received)}</span>
            <span className="fee-stat-note">{withPayments.length} students</span>
          </>
        ) : (
          <>
            <span className="fee-stat-value muted">None yet</span>
            <span className="fee-stat-note">No payment records imported yet</span>
          </>
        )}
      </div>
    </section>
  );
}
