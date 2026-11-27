import { useEffect, useMemo, useState } from "react";
import { transportBalances } from "../data/api.js";
import { peek, swr } from "../data/cache.js";
import { rupees, rupeesShort } from "../data/money.js";
import { gradeLabel } from "./PersonCard.jsx";

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Open transport dues for the session, per student: due now (and late),
// later, and in all. refreshAt: reload after a payment.
export function useTransportPending(school, session, students, refreshAt = 0) {
  const key = session ? `fees:transport:${session.id}` : null;
  const [rows, setRows] = useState(() => (key ? peek(key) ?? null : null));
  useEffect(() => {
    if (!key) return;
    swr(key, () => transportBalances(school.id, session.id), setRows).catch(() => setRows([]));
  }, [key, school.id, session, refreshAt]);

  return useMemo(() => {
    if (rows === null) return null;
    const today = localDay();
    const byId = new Map(students.map((p) => [p.id, p]));
    const per = new Map();
    for (const d of rows) {
      const p = byId.get(d.student_id);
      if (!p) continue;
      const t = per.get(p.id) ?? { student: p, now: 0, later: 0, late: false, months: [] };
      const bal = Number(d.balance);
      const now = !d.due_date || d.due_date <= today;
      if (now) t.now += bal;
      else t.later += bal;
      if (d.due_date && d.due_date < today) t.late = true;
      t.months.push({ label: d.label, now });
      per.set(p.id, t);
    }
    const list = [...per.values()];
    return {
      list,
      now: list.reduce((s, t) => s + t.now, 0),
      later: list.reduce((s, t) => s + t.later, 0),
      owingNow: list.filter((t) => t.now > 0).length,
      late: list.filter((t) => t.late).length,
    };
  }, [rows, students]);
}

// The Fees overview's Transport tab: totals by route, then everyone who
// owes transport, with Collect. Due now first; "All pending" adds what's due
// later.
// Who the Transport tab lists (and its Export downloads): in scope ("now" or
// "all"), on the picked route, late first then most owed. Also the route
// totals for the route buttons.
export function transportShownRows(pending, routes, scope, routeId) {
  const stopOf = new Map(routes.flatMap((r) => r.stops.map((s) => [s.id, { route: r, stop: s }])));
  const amount = (t) => (scope === "now" ? t.now : t.now + t.later);
  const inScope = (pending?.list ?? []).filter((t) => amount(t) > 0);
  const routeKey = (t) => stopOf.get(t.student.bus_stop_id)?.route.id ?? "none";
  const shown = inScope
    .filter((t) => !routeId || routeKey(t) === routeId)
    .sort((a, b) => Number(b.late) - Number(a.late) || amount(b) - amount(a));
  return { stopOf, amount, inScope, routeKey, shown };
}

// filtered: the Overview's Filter is on (so an empty list says so).
// scope/onScope ("now" | "all") and routeId/onRoute live on the page, so its
// Export downloads exactly this list.
export default function FeesTransport({ pending, routes, filtered = false, scope, onScope: setScope, routeId, onRoute: setRouteId, onOpenStudent, onCollect }) {
  if (!pending || !pending.list.length)
    return (
      <section className="panel ftp" id="fees-transport">
        <div className="panel-title">
          <h2>Transport fees pending</h2>
        </div>
        <p className="row-sub panel-empty">{!pending ? "Loading…" : filtered ? "Nobody matches the filter." : "No transport fees pending. 🎉"}</p>
      </section>
    );

  const { stopOf, amount, inScope, routeKey, shown } = transportShownRows(pending, routes, scope, routeId);
  const byRoute = new Map();
  for (const t of inScope) {
    const k = routeKey(t);
    const g = byRoute.get(k) ?? { id: k, name: k === "none" ? "No stop" : stopOf.get(t.student.bus_stop_id).route.name, total: 0, count: 0 };
    g.total += amount(t);
    g.count += 1;
    byRoute.set(k, g);
  }
  const groups = [...byRoute.values()].sort((a, b) => (a.id === "none") - (b.id === "none") || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const total = shown.reduce((s, t) => s + amount(t), 0);

  return (
    <section className="panel ftp" id="fees-transport">
      <div className="panel-title panel-title-row">
        <h2>
          Transport fees pending <span className="badge badge-danger">{shown.length}</span>
        </h2>
        <div className="segmented segmented-sm" role="radiogroup" aria-label="Which dues">
          {[
            ["now", "Due now"],
            ["all", "All pending"],
          ].map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={scope === v} className={scope === v ? "active" : ""} onClick={() => setScope(v)}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {groups.length > 1 && (
        <div className="ftp-routes" role="group" aria-label="Route">
          <button type="button" className={`ftp-route${!routeId ? " is-on" : ""}`} onClick={() => setRouteId(null)}>
            <span>All routes</span>
            <strong>{rupeesShort(inScope.reduce((s, t) => s + amount(t), 0))}</strong>
          </button>
          {groups.map((g) => (
            <button key={g.id} type="button" className={`ftp-route${routeId === g.id ? " is-on" : ""}`} onClick={() => setRouteId(routeId === g.id ? null : g.id)}>
              <span>
                {g.name} · {g.count}
              </span>
              <strong>{rupeesShort(g.total)}</strong>
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="row-sub panel-empty">Nothing due {scope === "now" ? "right now" : "on transport"}.</p>
      ) : (
        <>
          <ul className="dues-list">
            {shown.slice(0, 300).map((t) => {
              const s = t.student;
              const at = stopOf.get(s.bus_stop_id);
              return (
                <li key={s.id}>
                  <div className="dues-row">
                    <button type="button" className="dues-open" onClick={() => onOpenStudent?.(s.id, "fees")}>
                      <strong>{s.name}</strong>
                      <span className="row-sub">
                        {[s.admission_no, gradeLabel(s.class) + (s.section ? ` · ${s.section}` : ""), at ? `${at.route.name} · ${at.stop.name}` : "No stop", t.months.filter((m) => scope === "all" || m.now).map((m) => m.label).join(", ")]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </button>
                    <span className={`badge ${t.late ? "badge-danger" : "badge-warning"}`}>{rupees(amount(t))}</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => onCollect(s)}>
                      Collect
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="row-sub ftp-total">
            {shown.length} {shown.length === 1 ? "student" : "students"} · {rupees(total)}
            {shown.length > 300 && " · showing the first 300"}
          </p>
        </>
      )}
    </section>
  );
}
