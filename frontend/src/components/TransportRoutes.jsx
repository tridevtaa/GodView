import { useEffect, useMemo, useRef, useState } from "react";
import { addRoute, addStop, deleteRoute, deleteStop, listAreas, listBuses, putOnStop, reorderStops, updateRoute, updateStop } from "../data/api.js";
import { BusForm, BusList, busAlerts, label as busLabel, plate } from "./Buses.jsx";
import { aliasIndex, matchArea } from "../data/areas.js";
import { gradeLabel } from "./PersonCard.jsx";
import { gradeRank } from "./GradeFilter.jsx";
import { peek, swr } from "../data/cache.js";
import { MAP_ID, hasMaps, loadMaps, mapsLink } from "../data/maps.js";
import Icon from "./Icon.jsx";

// Owner: the school's buses and bus routes. Each route has a bus, start
// times and its stops in order (picked from the villages on the map
// above), each with a pickup and drop time. Anything that needs fixing
// (papers running out, too many students for the seats, a route with no
// bus, students with no stop) is listed at the top.
// readOnly: the owner gave this person Transport View (role permissions).
export default function TransportRoutes({ school, routes, students, onChanged, onStudentsChanged, onOpenStudent, readOnly = false }) {
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const areasKey = `areas:${school.id}`;
  const [areas, setAreas] = useState(() => peek(areasKey) ?? null);
  // Fetched again whenever a stop is being added, so villages just added
  // on the map show up.
  const loadAreas = () => swr(areasKey, () => listAreas(school.id), setAreas).catch(() => setAreas((a) => a ?? []));
  useEffect(() => {
    loadAreas();
  }, [areasKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Each student's village (picked on their profile, or matched from
  // their address), for filling a stop with the students who live there.
  const villageOf = useMemo(() => {
    const list = areas ?? [];
    const byAlias = aliasIndex(list);
    const m = new Map();
    students.forEach((s) => {
      const a = list.find((x) => x.id === s.area_id) ?? matchArea(s, byAlias);
      if (a) m.set(s.id, a.name.trim().toLowerCase());
    });
    return m;
  }, [areas, students]);
  const stopById = useMemo(() => {
    const m = new Map();
    routes.forEach((r) => r.stops.forEach((st) => m.set(st.id, { route: r, stop: st })));
    return m;
  }, [routes]);
  const riderList = useMemo(() => students.filter((s) => s.status !== "left" && s.status !== "inactive"), [students]);
  const putOn = async (ids, route, stop) => {
    setError("");
    try {
      const fields = await putOnStop(school.id, ids, route, stop);
      onStudentsChanged?.(ids, fields);
      return true;
    } catch {
      setError("Couldn’t save the students. Try again.");
      return false;
    }
  };
  // Which route each stop name is already on
  const usedOn = useMemo(() => {
    const m = new Map();
    routes.forEach((r) => r.stops.forEach((st) => m.set(st.name.trim().toLowerCase(), r)));
    return m;
  }, [routes]);

  const riders = useMemo(() => {
    const m = new Map();
    students.forEach((s) => s.uses_bus && s.bus_stop_id && m.set(s.bus_stop_id, (m.get(s.bus_stop_id) ?? 0) + 1));
    return m;
  }, [students]);

  // Buses (null while loading; busesMissing: the table isn't there yet)
  const busesKey = `buses:${school.id}`;
  const [buses, setBuses] = useState(() => peek(busesKey) ?? null);
  const [busesMissing, setBusesMissing] = useState(false);
  const [editing, setEditing] = useState(null); // a bus, or "new"
  const [assignTo, setAssignTo] = useState(null); // route getting the new bus
  const loadBuses = () =>
    swr(busesKey, () => listBuses(school.id), setBuses, { persist: true }).catch((err) => {
      setBuses((b) => b ?? []);
      if (err?.code === "PGRST205" || err?.code === "42P01") setBusesMissing(true);
    });
  useEffect(() => {
    loadBuses();
  }, [busesKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const busById = new Map((buses ?? []).map((b) => [b.id, b]));
  const ridersOn = (r) => r.stops.reduce((n, st) => n + (riders.get(st.id) ?? 0), 0);

  // What needs fixing, worst first
  const attention = (() => {
    const out = [];
    (buses ?? []).forEach((b) => busAlerts(b).forEach((a) => out.push({ ...a, onClick: () => setEditing(b) })));
    routes.forEach((r) => {
      const b = busById.get(r.bus_id);
      const n = ridersOn(r);
      if (buses?.length && !b) out.push({ level: "amber", text: `${r.name} has no vehicle set` });
      if (b?.status === "repair") out.push({ level: "amber", text: `${r.name}: ${busLabel(b)} is in repair`, onClick: () => setEditing(b) });
      if (b?.seats && n > b.seats) out.push({ level: "red", text: `${r.name}: ${n} students, but ${busLabel(b)} has ${b.seats} seats` });
    });
    // One bus can't start two routes at the same time
    const starts = new Map();
    routes.forEach((r) => {
      if (!r.bus_id) return;
      ["morning_at", "evening_at"].forEach((k) => {
        if (!r[k]) return;
        const key = `${r.bus_id}|${k}|${r[k].slice(0, 5)}`;
        const other = starts.get(key);
        if (other) out.push({ level: "red", text: `${busLabel(busById.get(r.bus_id))} starts ${other.name} and ${r.name} at ${r[k].slice(0, 5)}` });
        else starts.set(key, r);
      });
    });
    const noStop = riderList.filter((st) => st.uses_bus && !stopById.has(st.bus_stop_id)).length;
    if (noStop) out.push({ level: "amber", text: `${noStop} student${noStop === 1 ? " takes the bus but has" : "s take the bus but have"} no stop. Use Add students on a stop.` });
    return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "red" ? -1 : 1));
  })();

  const act = (fn) => async (...args) => {
    setError("");
    if (readOnly) {
      setError("You can see transport but not change it. The owner can change this in App access.");
      return false;
    }
    try {
      await fn(...args);
      await onChanged();
      return true;
    } catch (err) {
      setError(err?.code === "23505" ? "A route with that name already exists." : err?.code === "PGRST205" ? "Transport isn’t set up in the database yet (npx supabase db push)." : "That didn’t go through. Try again.");
      return false;
    }
  };

  return (
    <>
      {error && <p className="notice notice-error">{error}</p>}

      {attention.length > 0 && (
        <section className="fc tr-attention">
          <h2 className="tr-attention-h">
            <Icon name="bell" size={18} />
            Needs attention
            <span className="tr-attention-n">{attention.length}</span>
          </h2>
          <ul>
            {attention.map((a, i) => (
              <li key={i} className={`is-${a.level}`}>
                {a.onClick && !readOnly ? (
                  <button type="button" className="link-btn" onClick={a.onClick}>
                    {a.text}
                  </button>
                ) : (
                  a.text
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {busesMissing ? (
        <p className="notice">Buses aren’t set up in the database yet (npx supabase db push).</p>
      ) : (
        buses !== null && <BusList buses={buses} routes={routes} onEdit={readOnly ? () => {} : setEditing} onAdd={readOnly ? null : () => setEditing("new")} />
      )}
      {editing && (
        <BusForm
          school={school}
          bus={editing === "new" ? null : editing}
          buses={buses ?? []}
          routes={routes}
          onClose={() => (setEditing(null), setAssignTo(null))}
          onSaved={async (saved, { routesChanged }) => {
            await loadBuses();
            // Added from a route's Bus menu: that route gets it
            if (assignTo && saved?.id) await act(() => updateRoute(assignTo, { bus_id: saved.id }))();
            else if (routesChanged) await onChanged();
          }}
        />
      )}

      {!readOnly && <form
        className="tr-add"
        onSubmit={async (e) => {
          e.preventDefault();
          if (name.trim() && (await act(() => addRoute(school.id, name, routes.length + 1))())) setName("");
        }}
      >
        <span className="fc-add-icon tr-add-icon">
          <Icon name="bus" size={22} />
        </span>
        <input className="tr-add-input" placeholder="Add a route, e.g. Route 3 · Hema Majra" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <button className="btn btn-primary" disabled={!name.trim()}>
          <Icon name="plus" />
          Add route
        </button>
      </form>}

      {routes.map((r) => (
        <RouteCard key={r.id} school={school} route={r} riders={riders} act={act} areas={areas} usedOn={usedOn} onOpenPicker={loadAreas} students={riderList} villageOf={villageOf} stopById={stopById} putOn={putOn} buses={busesMissing ? null : buses} bus={busById.get(r.bus_id)} total={ridersOn(r)} onEditBus={readOnly ? () => {} : setEditing} onAddBus={readOnly ? null : () => (setAssignTo(r.id), setEditing("new"))} readOnly={readOnly} onOpenStudent={onOpenStudent} />
      ))}
    </>
  );
}

const hm = (t) => (t ? t.slice(0, 5) : "");
// "7:10 am"
const clock = (t) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

// The bus (or + Add a bus, which comes back to this route), and the start
// times, saved with their own Save button.
function RouteCard({ school, route: saved, riders, act, areas, usedOn, onOpenPicker, students, villageOf, stopById, putOn, buses, bus, total, onEditBus, onAddBus, readOnly, onOpenStudent }) {
  const [times, setTimes] = useState({ morning: hm(saved.morning_at), evening: hm(saved.evening_at) });
  const [timesSaving, setTimesSaving] = useState(false);
  const [timesSaved, setTimesSaved] = useState(false);
  const timesDirty = times.morning !== hm(saved.morning_at) || times.evening !== hm(saved.evening_at);
  // Pick up times saved elsewhere unless they're being edited
  useEffect(() => {
    if (!timesDirty) setTimes({ morning: hm(saved.morning_at), evening: hm(saved.evening_at) });
  }, [saved.morning_at, saved.evening_at]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!timesSaved) return;
    const t = setTimeout(() => setTimesSaved(false), 2500);
    return () => clearTimeout(t);
  }, [timesSaved]);
  const saveTimes = async (e) => {
    e?.preventDefault();
    setTimesSaving(true);
    const ok = await act(() => updateRoute(saved.id, { morning_at: times.morning || null, evening_at: times.evening || null }))();
    setTimesSaving(false);
    if (ok) setTimesSaved(true);
  };
  const [adding, setAdding] = useState(false);
  const [filling, setFilling] = useState(null); // stop id getting students
  const [editingStop, setEditingStop] = useState(null); // stop id being edited
  const [viewing, setViewing] = useState(null); // stop id whose students are listed
  // A moved stop shows in its new place at once, while it saves
  const [order, setOrder] = useState(null);
  const route = order ? { ...saved, stops: order } : saved;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(route.name);
  const [asking, setAsking] = useState(false);
  const pinned = route.stops.filter((s) => s.lat != null);
  const full = bus?.seats && total > bus.seats;
  // Morning pickups should get later stop by stop
  const pickups = route.stops.map((s) => hm(s.pickup_at)).filter(Boolean);
  const outOfOrder = pickups.some((t, i) => i > 0 && t < pickups[i - 1]);
  const move = async (i, by) => {
    const list = [...route.stops];
    const [st] = list.splice(i, 1);
    list.splice(i + by, 0, st);
    setOrder(list);
    await act(() => reorderStops(list))();
    setOrder(null);
  };
  const ridersAt = (stopId) => students.filter((p) => p.uses_bus && p.bus_stop_id === stopId);

  return (
    <section className="fc tr-route">
      <header className="fc-head">
        <div className="fc-title">
          {renaming ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (name.trim() && name.trim() !== route.name) await act(() => updateRoute(route.id, { name: name.trim() }))();
                setRenaming(false);
              }}
            >
              <input className="fc-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setRenaming(false)} autoFocus maxLength={60} />
            </form>
          ) : (
            <button className="tr-route-name" onClick={() => setRenaming(true)} title="Rename">
              <Icon name="bus" size={20} />
              {route.name}
            </button>
          )}
          <span className={`freq-btn fc-mini-freq${full ? " is-full" : ""}`}>
            {route.stops.length} stop{route.stops.length === 1 ? "" : "s"} · {bus?.seats ? `${total} of ${bus.seats} seats` : `${total} student${total === 1 ? "" : "s"}`}
          </span>
        </div>
        <div className="fc-head-end">
          {asking ? (
            <span className="ft-confirm">
              <span>Remove {route.name} and its stops?</span>
              <button className="link-btn link-danger" onClick={act(() => deleteRoute(route.id))}>
                Remove
              </button>
              <button className="link-btn" onClick={() => setAsking(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button className="icon-btn-sm" onClick={() => setAsking(true)} aria-label="Remove route" title="Remove route">
              <Icon name="trash" size={16} />
            </button>
          )}
        </div>
      </header>

      {buses && (
        <form className="tr-meta" onSubmit={saveTimes}>
          {/* The vehicle that runs this route (number plate, driver, seats).
              None added yet: a button to add one, which comes back here. */}
          {buses.length === 0 ? (
            onAddBus && (
              <div className="tr-meta-field">
                <span>Vehicle</span>
                <button type="button" className="btn btn-secondary tr-add-vehicle" onClick={onAddBus}>
                  <Icon name="plus" size={16} />
                  Add vehicle details
                </button>
              </div>
            )
          ) : (
            <label className="tr-meta-field">
              <span>Vehicle</span>
              <select
                value={route.bus_id ?? ""}
                disabled={readOnly}
                onChange={(e) =>
                  e.target.value === "__new" ? onAddBus?.() : act(() => updateRoute(route.id, { bus_id: e.target.value || null }))()
                }
              >
                <option value="">Not set</option>
                {buses
                  .filter((b) => b.status !== "retired" || b.id === route.bus_id)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {plate(b.number)}
                      {b.name ? ` · ${b.name}` : ""}
                      {b.status === "repair" ? " (in repair)" : ""}
                    </option>
                  ))}
                {onAddBus && <option value="__new">+ Add another vehicle…</option>}
              </select>
            </label>
          )}
          <label className="tr-meta-field">
            <span>Morning pickup starts</span>
            <input type="time" value={times.morning} disabled={readOnly} onChange={(e) => setTimes({ ...times, morning: e.target.value })} />
          </label>
          <label className="tr-meta-field">
            <span>Leaves school</span>
            <input type="time" value={times.evening} disabled={readOnly} onChange={(e) => setTimes({ ...times, evening: e.target.value })} />
          </label>
          {timesDirty && !readOnly && (
            <span className="tr-meta-save">
              <button type="submit" className="btn btn-primary btn-sm" disabled={timesSaving}>
                {timesSaving ? "Saving…" : "Save timings"}
              </button>
              <button
                type="button"
                className="link-btn"
                disabled={timesSaving}
                onClick={() => setTimes({ morning: hm(saved.morning_at), evening: hm(saved.evening_at) })}
              >
                Cancel
              </button>
            </span>
          )}
          {timesSaved && !timesDirty && (
            <span className="tr-meta-saved row-sub">
              <Icon name="check" size={14} /> Timings saved
            </span>
          )}
          {bus && (
            <span className="tr-meta-crew">
              {bus.driver_name ? (
                <a href={bus.driver_phone ? `tel:${bus.driver_phone}` : undefined} className="tr-crew">
                  <Icon name="phone" size={14} />
                  {bus.driver_name}
                  <span className="row-sub"> driver</span>
                </a>
              ) : (
                <button type="button" className="link-btn" onClick={() => onEditBus(bus)}>
                  Add the driver
                </button>
              )}
              {bus.conductor_name && (
                <a href={bus.conductor_phone ? `tel:${bus.conductor_phone}` : undefined} className="tr-crew">
                  <Icon name="phone" size={14} />
                  {bus.conductor_name}
                  <span className="row-sub"> conductor</span>
                </a>
              )}
            </span>
          )}
        </form>
      )}
      {(bus?.status === "repair" || full || outOfOrder) && (
        <p className="tr-warn">
          {[
            bus?.status === "repair" && `${busLabel(bus)} is in repair.`,
            full && `${total} students but ${bus.seats} seats.`,
            outOfOrder && "Pickup times aren’t in stop order.",
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      )}

      <div className={`tr-body${pinned.length && hasMaps ? " has-map" : ""}`}>
        <ol className="tr-stops">
          {route.stops.map((s, i) => [
            <li key={s.id}>
              <span className="tr-num">{i + 1}</span>
              <span className="tr-stop-text">
                <strong>{s.name}</strong>
                <span className="row-sub">
                  {[s.pickup_at && `pickup ${clock(s.pickup_at)}`, s.drop_at && `drop ${clock(s.drop_at)}`]
                    .filter(Boolean)
                    .map((t) => `${t} · `)
                    .join("")}
                  {riders.get(s.id) ? (
                    <button type="button" className="tr-riders" aria-expanded={viewing === s.id} onClick={() => setViewing(viewing === s.id ? null : s.id)}>
                      {riders.get(s.id)} student{riders.get(s.id) === 1 ? "" : "s"}
                      <Icon name={viewing === s.id ? "chevronDown" : "chevronRight"} size={12} />
                    </button>
                  ) : (
                    "0 students"
                  )}
                </span>
              </span>
              {s.lat != null && (
                <a className="link-btn" href={mapsLink(s.lat, s.lng)} target="_blank" rel="noreferrer" title="Open in Google Maps">
                  <Icon name="pin" size={14} />
                </a>
              )}
              {!readOnly && route.stops.length > 1 && (
                <span className="tr-order">
                  <button type="button" className="icon-btn-sm" disabled={i === 0 || Boolean(order)} onClick={() => move(i, -1)} aria-label={`Move ${s.name} up`} title="Move up">
                    <Icon name="arrowUp" size={14} />
                  </button>
                  <button type="button" className="icon-btn-sm" disabled={i === route.stops.length - 1 || Boolean(order)} onClick={() => move(i, 1)} aria-label={`Move ${s.name} down`} title="Move down">
                    <Icon name="arrowDown" size={14} />
                  </button>
                </span>
              )}
              {!readOnly && filling !== s.id && (
                <button className="link-btn tr-fill-btn" onClick={() => setFilling(s.id)} aria-label={`Add students to ${s.name}`} title="Add students">
                  <Icon name="plus" size={13} />
                  <span className="tr-fill-label">Add students</span>
                </button>
              )}
              {!readOnly && (
                <button
                  className="icon-btn-sm"
                  aria-label={`Edit ${s.name}`}
                  title="Times, remove"
                  aria-expanded={editingStop === s.id}
                  onClick={() => setEditingStop(editingStop === s.id ? null : s.id)}
                >
                  <Icon name="edit" size={14} />
                </button>
              )}
            </li>,
            viewing === s.id && (
              <li key={`${s.id}:riders`} className="tr-fill-row">
                <StopRiders list={ridersAt(s.id)} onOpen={onOpenStudent} />
              </li>
            ),
            editingStop === s.id && (
              <li key={`${s.id}:edit`} className="tr-fill-row">
                <StopEdit
                  stop={s}
                  riders={riders.get(s.id) ?? 0}
                  onTime={(k, v) => act(() => updateStop(s.id, { [k]: v || null }))()}
                  onRemove={async () => {
                    if (await act(() => deleteStop(s.id))()) setEditingStop(null);
                  }}
                  onDone={() => setEditingStop(null)}
                />
              </li>
            ),
            filling === s.id && (
              <li key={`${s.id}:fill`} className="tr-fill-row">
                <StopStudents
                  stop={s}
                  students={students}
                  villageOf={villageOf}
                  stopById={stopById}
                  onCancel={() => setFilling(null)}
                  onSave={async (ids) => {
                    if (await putOn(ids, route, s)) setFilling(null);
                  }}
                />
              </li>
            ),
          ])}
          {route.stops.length === 0 && !adding && <li className="row-sub tr-empty">No stops yet. Add them in the order the bus reaches them.</li>}
          <li className="tr-add-stop">
            {adding ? (
              <div className="tr-stop-search">
                <AreaPicker
                  areas={areas}
                  route={route}
                  usedOn={usedOn}
                  onPick={async (area) => {
                    const stop = { name: area.name, lat: area.lat, lng: area.lng };
                    if (await act(() => addStop(school.id, route.id, stop, route.stops.length + 1))()) setAdding(false);
                  }}
                />
                <button className="link-btn" onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  onOpenPicker();
                  setAdding(true);
                }}
              >
                <Icon name="plus" />
                Add stop
              </button>
            )}
          </li>
        </ol>
        {pinned.length > 0 && hasMaps && <RouteMap stops={pinned} />}
      </div>
    </section>
  );
}

// One stop's pickup and drop times, and removing
// it (asks first when students use it; they're left without a stop).
function StopEdit({ stop, riders, onTime, onRemove, onDone }) {
  const [asking, setAsking] = useState(false);
  return (
    <div className="tr-fill tr-stop-edit">
      <div className="tr-stop-edit-row">
        <label className="tr-meta-field">
          <span>Morning pickup</span>
          <input type="time" defaultValue={hm(stop.pickup_at)} onBlur={(e) => e.target.value !== hm(stop.pickup_at) && onTime("pickup_at", e.target.value)} />
        </label>
        <label className="tr-meta-field">
          <span>Afternoon drop</span>
          <input type="time" defaultValue={hm(stop.drop_at)} onBlur={(e) => e.target.value !== hm(stop.drop_at) && onTime("drop_at", e.target.value)} />
        </label>
      </div>
      <div className="tr-fill-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={onDone}>
          Done
        </button>
        {asking ? (
          <span className="ft-confirm">
            <span>
              {riders} student{riders === 1 ? "" : "s"} use{riders === 1 ? "s" : ""} {stop.name}. Remove it?
            </span>
            <button type="button" className="link-btn link-danger" onClick={onRemove}>
              Remove
            </button>
            <button type="button" className="link-btn" onClick={() => setAsking(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button type="button" className="link-btn link-danger" onClick={() => (riders ? setAsking(true) : onRemove())}>
            Remove stop
          </button>
        )}
      </div>
    </div>
  );
}

// Who gets on at a stop, by class. Tap a name for their profile.
function StopRiders({ list, onOpen }) {
  const sorted = [...list].sort((a, b) => gradeRank(a.class ?? "") - gradeRank(b.class ?? "") || (a.section ?? "").localeCompare(b.section ?? "") || a.name.localeCompare(b.name));
  return (
    <ul className="tr-riders-list">
      {sorted.map((p) => (
        <li key={p.id}>
          {onOpen ? (
            <button type="button" className="link-btn" onClick={() => onOpen(p.id)}>
              {p.name}
            </button>
          ) : (
            <span>{p.name}</span>
          )}
          <span className="row-sub">{[gradeLabel(p.class), p.section].filter(Boolean).join(" · ")}</span>
        </li>
      ))}
    </ul>
  );
}

// Students for one stop: everyone from that village who isn't on it yet,
// ticked (unless they're already on another stop), and a search for
// anyone else.
function StopStudents({ stop, students, villageOf, stopById, onCancel, onSave }) {
  const village = stop.name.trim().toLowerCase();
  const fromVillage = useMemo(
    () => students.filter((p) => p.bus_stop_id !== stop.id && villageOf.get(p.id) === village).sort((a, b) => a.name.localeCompare(b.name)),
    [students, villageOf, village, stop.id]
  );
  const [picked, setPicked] = useState(() => new Set(fromVillage.filter((p) => !p.bus_stop_id).map((p) => p.id)));
  const [extra, setExtra] = useState([]); // picked through the search
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const q = query.trim().toLowerCase();
  const shown = new Set([...fromVillage, ...extra].map((p) => p.id));
  const matches = q ? students.filter((p) => p.bus_stop_id !== stop.id && !shown.has(p.id) && p.name.toLowerCase().includes(q)).slice(0, 6) : [];
  const toggle = (id) =>
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const list = [...fromVillage, ...extra];

  const row = (p) => {
    const other = p.bus_stop_id ? stopById.get(p.bus_stop_id) : null;
    return (
      <label key={p.id} className="tr-fill-item">
        <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
        <span>
          <strong>{p.name}</strong>
          <span className="row-sub">
            {[p.class && `${gradeLabel(p.class)}${p.section ? ` ${p.section}` : ""}`, other && `now on ${other.stop.name} (${other.route.name})`].filter(Boolean).join(" · ")}
          </span>
        </span>
      </label>
    );
  };

  return (
    <div className="tr-fill">
      <p className="tr-fill-title">{fromVillage.length ? `Students from ${stop.name} (${fromVillage.length})` : `No other students from ${stop.name}. Search to add anyone.`}</p>
      {list.length > 0 && <div className="tr-fill-list">{list.map(row)}</div>}
      <div className="place">
        <div className="place-search">
          <Icon name="search" />
          <input className="place-input" placeholder="Add another student by name" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search students" autoComplete="off" />
          {matches.length > 0 && (
            <ul className="place-menu" role="listbox">
              {matches.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected="false"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setExtra((prev) => [...prev, p]);
                      setPicked((prev) => new Set(prev).add(p.id));
                      setQuery("");
                    }}
                  >
                    <Icon name="scholar" size={15} />
                    <span>
                      <strong>{p.name}</strong>
                      {p.class && <span className="row-sub">{`${gradeLabel(p.class)}${p.section ? ` ${p.section}` : ""}`}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="tr-fill-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={!picked.size || saving}
          onClick={async () => {
            setSaving(true);
            await onSave([...picked]);
            setSaving(false);
          }}
        >
          {saving ? "Saving…" : picked.size ? `Add ${picked.size} student${picked.size === 1 ? "" : "s"} to this stop` : "Tick students to add"}
        </button>
        <button className="link-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// Search the villages and towns on the map. Ones already on this route
// are left out; ones on another route say which.
function AreaPicker({ areas, route, usedOn, onPick }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(true);
  const onRoute = new Set(route.stops.map((st) => st.name.trim().toLowerCase()));
  const q = query.trim().toLowerCase();
  const items = (areas ?? [])
    .filter((a) => !onRoute.has(a.name.trim().toLowerCase()))
    .filter((a) => !q || a.name.toLowerCase().includes(q) || (a.aliases ?? []).some((x) => x.toLowerCase().includes(q)));

  if (areas !== null && areas.length === 0) {
    return <p className="row-sub tr-area-empty">No villages on the map yet. Add them on the map above first.</p>;
  }

  const onKey = (e) => {
    if (e.key === "ArrowDown") (e.preventDefault(), setActive((i) => Math.min(i + 1, items.length - 1)));
    else if (e.key === "ArrowUp") (e.preventDefault(), setActive((i) => Math.max(i - 1, 0)));
    else if (e.key === "Enter" && items[active]) (e.preventDefault(), onPick(items[active]));
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div className="place">
      <div className="place-search">
        <Icon name="search" />
        <input
          className="place-input"
          placeholder={areas === null ? "Loading villages…" : "Search a village or town on the map"}
          value={query}
          onChange={(e) => (setQuery(e.target.value), setActive(0), setOpen(true))}
          onKeyDown={onKey}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          aria-label="Stop"
          aria-autocomplete="list"
          aria-expanded={open && items.length > 0}
          autoComplete="off"
          autoFocus
        />
        {open && areas !== null && (
          <ul className="place-menu" role="listbox">
            {items.map((a, i) => {
              const other = usedOn.get(a.name.trim().toLowerCase());
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    className={i === active ? "is-active" : ""}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => onPick(a)}
                  >
                    <Icon name="pin" size={15} />
                    <span>
                      <strong>{a.name}</strong>
                      {other && <span className="row-sub">Also on {other.name}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
            {items.length === 0 && <li className="place-credit">{q ? `No village called “${query.trim()}” on the map` : "Every village on the map is on this route"}</li>}
          </ul>
        )}
      </div>
    </div>
  );
}

// All of a route's stops, numbered in order.
function RouteMap({ stops }) {
  const el = useRef(null);
  const key = stops.map((s) => `${s.id}:${s.lat},${s.lng}`).join("|");

  useEffect(() => {
    let cancelled = false;
    let markers = [];
    (async () => {
      await loadMaps();
      const { Map, Polyline } = await window.google.maps.importLibrary("maps");
      const { AdvancedMarkerElement, PinElement } = await window.google.maps.importLibrary("marker");
      const { LatLngBounds } = await window.google.maps.importLibrary("core");
      if (cancelled || !el.current) return;
      const map = new Map(el.current, { mapId: MAP_ID, disableDefaultUI: true, zoomControl: true, gestureHandling: "cooperative" });
      const bounds = new LatLngBounds();
      markers = stops.map((s, i) => {
        bounds.extend({ lat: s.lat, lng: s.lng });
        const pin = new PinElement({ glyph: String(i + 1), background: "#5b68c4", borderColor: "#1d2366", glyphColor: "#ffffff" });
        return new AdvancedMarkerElement({ map, position: { lat: s.lat, lng: s.lng }, content: pin.element, title: s.name });
      });
      if (stops.length > 1) {
        new Polyline({ map, path: stops.map((s) => ({ lat: s.lat, lng: s.lng })), strokeColor: "#5b68c4", strokeOpacity: 0.7, strokeWeight: 3 });
        map.fitBounds(bounds, 40);
      } else {
        map.setCenter({ lat: stops[0].lat, lng: stops[0].lng });
        map.setZoom(14);
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
      markers.forEach((m) => (m.map = null));
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className="tr-map" aria-label="Route map" />;
}
