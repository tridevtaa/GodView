// The overview row at the top of a page: up to three key numbers.
// items: [{ label, value, note?, tone?: "paid" | "due" | "overdue", onClick? }]
// value undefined shows a placeholder while it loads.
export default function StatCards({ items }) {
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return (
    <section className="stat-cards" style={{ "--n": shown.length }}>
      {shown.map(({ label, value, note, tone, onClick }) => {
        const body = (
          <>
            <span className="stat-label">{label}</span>
            <strong className={tone ? `is-${tone}` : ""}>{value === undefined ? "…" : value}</strong>
            {note && <span className="row-sub">{note}</span>}
          </>
        );
        return onClick ? (
          <button type="button" key={label} className="stat-card is-link" onClick={onClick}>
            {body}
          </button>
        ) : (
          <div key={label} className="stat-card">
            {body}
          </div>
        );
      })}
    </section>
  );
}
