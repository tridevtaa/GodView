import { formatINR } from "./PersonCard.jsx";

// Compact stat strip above the student list; follows the grade filter.
export default function FeeSummary({ students }) {
  const due = students.filter((s) => s.fee_due > 0);
  const pending = due.reduce((sum, s) => sum + s.fee_due, 0);
  const withPayments = students.filter((s) => typeof s.fee_paid === "number");
  const received = withPayments.reduce((sum, s) => sum + s.fee_paid, 0);
  const asOf = students.find((s) => s.fee_as_of)?.fee_as_of;

  return (
    <section className="stats" aria-label="Summary">
      <div className="stat">
        <span className="stat-label">Students</span>
        <span className="stat-value">{students.length.toLocaleString("en-IN")}</span>
        <span className="stat-note">{students.filter((s) => s.status === "inactive").length} inactive</span>
      </div>
      <div className="stat">
        <span className="stat-label">Fees pending</span>
        <span className="stat-value">{formatINR(pending)}</span>
        <span className="stat-note">
          {due.length ? `${due.length} students${asOf ? ` · as of ${asOf}` : ""}` : "No due list imported"}
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">Fees received</span>
        <span className="stat-value">{withPayments.length ? formatINR(received) : "—"}</span>
        <span className="stat-note">
          {withPayments.length ? `${withPayments.length} students` : "No payment records yet"}
        </span>
      </div>
    </section>
  );
}
