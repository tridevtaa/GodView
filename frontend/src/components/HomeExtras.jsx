import { useEffect, useState } from "react";
import { listBuses, paymentsOn } from "../data/api.js";
import { peek, swr } from "../data/cache.js";
import { METHODS, rupees, rupeesShort } from "../data/money.js";
import { NEEDS } from "../data/needs.js";
import Icon from "./Icon.jsx";
import { Photo } from "./PersonCard.jsx";

// Home widgets for owners and admins (and staff days for the principal too):
// Today's collection, Buses, Records to fix, Staff birthdays & anniversaries.
// Each is a card with a coloured icon, a title, one big number or line, and
// the few rows that matter; the title opens the page behind it.

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const num = (v) => Number(v || 0).toLocaleString("en-IN");

function Card({ tone, icon, title, action, onAction, children }) {
  return (
    <section className={`hx t-${tone}`}>
      <header className="hx-head">
        <span className="hx-icon">
          <Icon name={icon} size={17} />
        </span>
        <h3>{title}</h3>
        {onAction && (
          <button type="button" className="hx-link" onClick={onAction}>
            {action}
            <Icon name="chevronRight" size={14} />
          </button>
        )}
      </header>
      {children}
    </section>
  );
}

// 1. Money taken today: the total, who collected how much (for checking cash
// at closing), and by method.
export function CollectionToday({ schoolId, onOpen }) {
  const day = localDay();
  const key = `home:collection:${schoolId}:${day}`;
  const [rows, setRows] = useState(() => peek(key) ?? null);
  useEffect(() => {
    let live = true;
    const load = () => swr(key, () => paymentsOn(schoolId, day), (r) => live && setRows(r)).catch(() => live && setRows([]));
    load();
    const onShow = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [key, schoolId, day]);

  const ok = (rows ?? []).filter((p) => p.status === "success");
  const cancelled = (rows ?? []).filter((p) => p.status === "cancelled");
  const total = ok.reduce((t, p) => t + Number(p.amount), 0);
  const group = (keyOf) => {
    const m = new Map();
    for (const p of ok) {
      const k = keyOf(p);
      const g = m.get(k) ?? { name: k, amount: 0, count: 0 };
      g.amount += Number(p.amount);
      g.count += 1;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  };
  const people = group((p) => p.collected_by || p.received_by || "Not named");
  const methods = group((p) => METHODS[p.method] ?? p.method);

  return (
    <Card tone="green" icon="rupee" title="Today’s collection" action="Report" onAction={onOpen}>
      {rows === null ? (
        <p className="hx-quiet">Loading…</p>
      ) : (
        <>
          <div className="hx-big">
            <strong>{rupees(total)}</strong>
            <span>
              {num(ok.length)} {ok.length === 1 ? "receipt" : "receipts"}
              {cancelled.length > 0 && <em className="hx-bad"> · {cancelled.length} cancelled</em>}
            </span>
          </div>
          {ok.length === 0 ? (
            <p className="hx-quiet">Nothing collected yet today.</p>
          ) : (
            <>
              <ul className="hx-rows">
                {people.slice(0, 4).map((g) => (
                  <li key={g.name}>
                    <span className="hx-row-main">
                      <strong>{g.name}</strong>
                      <span className="hx-bar">
                        <span style={{ width: `${Math.max(4, Math.round((g.amount / total) * 100))}%` }} />
                      </span>
                    </span>
                    <span className="hx-row-side">
                      <strong>{rupees(g.amount)}</strong>
                      <span>
                        {g.count} {g.count === 1 ? "receipt" : "receipts"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="hx-chips">
                {methods.map((m) => (
                  <span key={m.name} className="hx-chip">
                    {m.name} <strong>{rupeesShort(m.amount)}</strong>
                  </span>
                ))}
              </p>
            </>
          )}
        </>
      )}
    </Card>
  );
}

// 2. Buses: papers running out (or run out) in the next 30 days, then riders
// on each route against the bus's seats.
const PAPERS = [
  ["insurance_until", "Insurance"],
  ["fitness_until", "Fitness"],
  ["puc_until", "Pollution (PUC)"],
  ["permit_until", "Permit"],
  ["tax_until", "Road tax"],
  ["extinguisher_until", "Fire extinguisher"],
  ["licence_until", "Driver’s licence"],
];
export function BusWatch({ schoolId, routes, students, onOpen }) {
  const key = `home:buses:${schoolId}`;
  const [buses, setBuses] = useState(() => peek(key) ?? null);
  useEffect(() => {
    swr(key, () => listBuses(schoolId), setBuses).catch(() => setBuses([]));
  }, [key, schoolId]);

  const today = localDay();
  const days = (d) => Math.round((new Date(`${d}T12:00:00`) - new Date(`${today}T12:00:00`)) / 864e5);
  const active = (buses ?? []).filter((b) => b.status !== "retired");
  const alerts = active
    .flatMap((b) => PAPERS.filter(([f]) => b[f] && days(b[f]) <= 30).map(([f, label]) => ({ bus: b, label, left: days(b[f]) })))
    .sort((a, b) => a.left - b.left);
  const busOf = new Map(active.map((b) => [b.id, b]));
  const stopRoute = new Map(routes.flatMap((r) => r.stops.map((s) => [s.id, r.id])));
  const riders = new Map();
  for (const p of students) {
    if (p.status === "inactive" || !p.uses_bus) continue;
    const r = stopRoute.get(p.bus_stop_id);
    if (r) riders.set(r, (riders.get(r) ?? 0) + 1);
  }
  const lines = routes
    .filter((r) => r.stops.length)
    .map((r) => ({ route: r, bus: busOf.get(r.bus_id), riders: riders.get(r.id) ?? 0 }))
    .sort((a, b) => b.riders - a.riders);
  const totalRiders = [...riders.values()].reduce((t, v) => t + v, 0);
  const when = (left) => (left < 0 ? `ended ${-left} ${left === -1 ? "day" : "days"} ago` : left === 0 ? "ends today" : `ends in ${left} ${left === 1 ? "day" : "days"}`);

  return (
    <Card tone="teal" icon="bus" title="Buses" action="Transport" onAction={onOpen}>
      <div className="hx-big">
        <strong>{num(totalRiders)}</strong>
        <span>
          on {lines.length} {lines.length === 1 ? "route" : "routes"}
          {active.length > 0 && ` · ${active.length} ${active.length === 1 ? "bus" : "buses"}`}
        </span>
      </div>
      {buses !== null && active.length === 0 ? (
        <p className="hx-note">Add each bus with its insurance, fitness and permit dates in Transport to be warned before they run out.</p>
      ) : alerts.length > 0 ? (
        <ul className="hx-alerts">
          {alerts.slice(0, 4).map((a) => (
            <li key={`${a.bus.id}-${a.label}`} className={a.left < 0 ? "is-bad" : a.left <= 7 ? "is-soon" : ""}>
              <Icon name="bell" size={14} />
              <span>
                <strong>{a.bus.number}</strong> {a.label} {when(a.left)}
              </span>
            </li>
          ))}
          {alerts.length > 4 && <li className="hx-more">+{alerts.length - 4} more in Transport</li>}
        </ul>
      ) : (
        buses !== null && <p className="hx-good">All bus papers are valid for the next 30 days.</p>
      )}
      {lines.length > 0 && (
        <ul className="hx-rows">
          {lines.slice(0, 4).map(({ route, bus, riders: n }) => {
            const seats = Number(bus?.seats) || 0;
            const over = seats > 0 && n > seats;
            return (
              <li key={route.id}>
                <span className="hx-row-main">
                  <strong>
                    {route.name}
                    {bus && <span className="hx-dim"> · {bus.number}</span>}
                  </strong>
                  {seats > 0 && (
                    <span className={`hx-bar${over ? " is-over" : ""}`}>
                      <span style={{ width: `${Math.min(100, Math.round((n / seats) * 100))}%` }} />
                    </span>
                  )}
                </span>
                <span className="hx-row-side">
                  <strong className={over ? "hx-bad" : ""}>{seats > 0 ? `${n}/${seats}` : n}</strong>
                  <span>{seats > 0 ? "seats" : "riders"}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// 3. Records to fix: active students missing a photo, parent phone, Aadhaar
// or bus stop, and SLCs pending. Each line opens that list.
export function RecordsToFix({ students, onOpen }) {
  const active = students.filter((p) => (p.status || "active") === "active");
  const rows = Object.entries(NEEDS)
    .map(([key, n]) => ({ key, label: n.title, count: active.filter(n.test).length }))
    .filter((r) => r.count > 0);
  const total = rows.reduce((t, r) => t + r.count, 0);
  return (
    <Card tone="amber" icon="edit" title="Records to fix">
      {rows.length === 0 ? (
        <p className="hx-good">Every active student’s record is complete.</p>
      ) : (
        <>
          <div className="hx-big">
            <strong>{num(total)}</strong>
            <span>things to fill in</span>
          </div>
          <ul className="hx-rows hx-tap">
            {rows.map((r) => (
              <li key={r.key}>
                <button type="button" onClick={() => onOpen(r.key)}>
                  <span className="hx-row-main">
                    <strong>{r.label}</strong>
                  </span>
                  <span className="hx-row-side">
                    <strong>{num(r.count)}</strong>
                  </span>
                  <Icon name="chevronRight" size={14} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

// 4. Staff birthdays and work anniversaries in the next 7 days.
export function StaffDays({ staff, onOpen }) {
  const today = new Date(`${localDay()}T12:00:00`);
  const inDays = (md) => {
    const [m, d] = md;
    let next = new Date(today.getFullYear(), m - 1, d, 12);
    if (next < today) next = new Date(today.getFullYear() + 1, m - 1, d, 12);
    return Math.round((next - today) / 864e5);
  };
  const people = (staff ?? []).filter((p) => (p.status || "active") === "active");
  const events = [];
  for (const p of people) {
    if (p.dob) {
      const [, m, d] = p.dob.split("-").map(Number);
      const left = inDays([m, d]);
      if (left <= 7) events.push({ p, left, kind: "birthday", text: "Birthday" });
    }
    if (p.joining_date) {
      const [y, m, d] = p.joining_date.split("-").map(Number);
      const left = inDays([m, d]);
      const years = today.getFullYear() + (new Date(today.getFullYear(), m - 1, d, 12) < today ? 1 : 0) - y;
      if (left <= 7 && years >= 1) events.push({ p, left, kind: "anniversary", text: `${years} ${years === 1 ? "year" : "years"} at school` });
    }
  }
  events.sort((a, b) => a.left - b.left || a.p.name.localeCompare(b.p.name));
  const noDob = people.length > 0 && !people.some((p) => p.dob);
  const dayText = (left) =>
    left === 0 ? "Today" : left === 1 ? "Tomorrow" : new Date(today.getTime() + left * 864e5).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

  return (
    <Card tone="pink" icon="cake" title="Staff birthdays & anniversaries" action="Staff" onAction={onOpen}>
      {staff === null ? (
        <p className="hx-quiet">Loading…</p>
      ) : events.length === 0 ? (
        <p className="hx-quiet">None in the next 7 days.</p>
      ) : (
        <ul className="hx-people">
          {events.slice(0, 5).map((e) => (
            <li key={`${e.p.id}-${e.kind}`} className={e.left === 0 ? "is-today" : ""}>
              <Photo person={e.p} className="hx-photo" />
              <span className="hx-row-main">
                <strong>{e.p.name}</strong>
                <span>
                  {e.kind === "birthday" ? "🎂 " : "🎉 "}
                  {e.text}
                </span>
              </span>
              <span className="hx-when">{dayText(e.left)}</span>
            </li>
          ))}
        </ul>
      )}
      {noDob && <p className="hx-note">Add staff dates of birth in their profiles to see birthdays here.</p>}
    </Card>
  );
}
