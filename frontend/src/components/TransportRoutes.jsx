import { useEffect, useMemo, useRef, useState } from "react";
import { addRoute, addStop, deleteRoute, deleteStop, listAreas, updateRoute } from "../data/api.js";
import { peek, swr } from "../data/cache.js";
import { MAP_ID, hasMaps, loadMaps, mapsLink } from "../data/maps.js";
import Icon from "./Icon.jsx";

// Owner: the school's bus routes, each with its stops pinned on the map.
// Stops are picked from the villages and towns on the map above.
export default function TransportRoutes({ school, routes, students, onChanged }) {
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

  const act = (fn) => async (...args) => {
    setError("");
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


      <form
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
      </form>

      {routes.map((r) => (
        <RouteCard key={r.id} school={school} route={r} riders={riders} act={act} areas={areas} usedOn={usedOn} onOpenPicker={loadAreas} />
      ))}
    </>
  );
}

function RouteCard({ school, route, riders, act, areas, usedOn, onOpenPicker }) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(route.name);
  const [asking, setAsking] = useState(false);
  const total = route.stops.reduce((n, s) => n + (riders.get(s.id) ?? 0), 0);
  const pinned = route.stops.filter((s) => s.lat != null);

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
          <span className="freq-btn fc-mini-freq">
            {route.stops.length} stop{route.stops.length === 1 ? "" : "s"} · {total} students
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

      <div className={`tr-body${pinned.length && hasMaps ? " has-map" : ""}`}>
        <ol className="tr-stops">
          {route.stops.map((s, i) => (
            <li key={s.id}>
              <span className="tr-num">{i + 1}</span>
              <span className="tr-stop-text">
                <strong>{s.name}</strong>
                <span className="row-sub">
                  {s.address && s.address !== s.name ? `${s.address} · ` : ""}
                  {riders.get(s.id) ?? 0} students
                </span>
              </span>
              {s.lat != null && (
                <a className="link-btn" href={mapsLink(s.lat, s.lng)} target="_blank" rel="noreferrer" title="Open in Google Maps">
                  <Icon name="pin" size={14} />
                </a>
              )}
              <button className="ft-x" aria-label={`Remove ${s.name}`} title="Remove stop" onClick={act(() => deleteStop(s.id))}>
                <Icon name="x" size={12} />
              </button>
            </li>
          ))}
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
