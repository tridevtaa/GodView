import { useEffect, useMemo, useState } from "react";
import { listSessions } from "../data/api.js";
import { rupees } from "../data/money.js";
import Icon from "./Icon.jsx";

// Payments grouped by the session they were received in, newest first, each
// with its total (cancelled ones stay listed but don't count). Dates decide,
// since old imported payments aren't linked to any due. A date no session
// covers still gets its April to March year.
const yearName = (day) => {
  const y = Number(day.slice(0, 4));
  const start = Number(day.slice(5, 7)) >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
};

export function groupBySession(payments, sessions) {
  const groups = new Map();
  for (const p of payments) {
    const s = sessions.find((x) => x.starts_on && x.ends_on && x.starts_on <= p.paid_on && p.paid_on <= x.ends_on);
    const name = s?.name ?? yearName(p.paid_on);
    if (!groups.has(name)) groups.set(name, { name, total: 0, received: 0, payments: [] });
    const g = groups.get(name);
    g.payments.push(p);
    if (p.status === "success") {
      g.total += Number(p.amount);
      g.received += 1;
    }
  }
  return [...groups.values()].sort((a, b) => b.payments[0].paid_on.localeCompare(a.payments[0].paid_on));
}

// The newest session starts open; older ones show their total until tapped.
// row(payment): one row, inside a <ul className={listClass}>.
export default function PaymentHistory({ schoolId, payments, listClass, row }) {
  const [sessions, setSessions] = useState([]);
  useEffect(() => {
    listSessions(schoolId).then(setSessions, () => {});
  }, [schoolId]);
  const groups = useMemo(() => groupBySession(payments, sessions), [payments, sessions]);
  const [toggled, setToggled] = useState(() => new Set());
  const flip = (name) =>
    setToggled((t) => {
      const next = new Set(t);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  return (
    <div className="pay-sessions">
      {groups.map((g, i) => {
        const open = (i === 0) !== toggled.has(g.name);
        return (
          <section key={g.name} className={`pay-session${open ? " is-open" : ""}`}>
            <button type="button" className="pay-session-head" onClick={() => flip(g.name)} aria-expanded={open}>
              <span className="pay-session-name">{g.name}</span>
              <span className="pay-session-count">
                {g.received} {g.received === 1 ? "payment" : "payments"}
              </span>
              <strong>{rupees(g.total)}</strong>
              <Icon name="chevronDown" size={16} />
            </button>
            {open && <ul className={listClass}>{g.payments.map(row)}</ul>}
          </section>
        );
      })}
    </div>
  );
}
