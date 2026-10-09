import { useEffect, useMemo, useRef, useState } from "react";
import { addRoute, addStop, deleteRoute, deleteStop, updateRoute } from "../data/api.js";
import { MAP_ID, hasMaps, loadMaps, mapsLink } from "../data/maps.js";
import PlacePicker from "./PlacePicker.jsx";
import Icon from "./Icon.jsx";

// Owner: the school's bus routes, each with its stops pinned on the map.
export default function TransportRoutes({ school, routes, students, onChanged }) {
  const [error, setError] = useState("");
  const [name, setName] = useState("");

  const riders = useMemo(() => {
    const m = new Map();
    students.forEach((s) => s.uses_bus && s.bus_stop_id && m.set(s.bus_stop_id, (m.get(s.bus_stop_id) ?? 0) + 1));
    return m;
  }, [students]);
  const onBus = students.filter((s) => s.uses_bus).length;
  const pinnedHomes = students.filter((s) => s.home_lat != null).length;

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
      {!hasMaps && (
        <p className="callout callout-neutral">
          Map search isn’t switched on yet: the Google Maps key still needs adding. Routes and stops can be added by
          name meanwhile.
        </p>
      )}

      <section className="tr-summary">
        <div>
          <span>Routes</span>
          <strong>{routes.length}</strong>
        </div>
        <div>
          <span>Stops</span>
          <strong>{routes.reduce((n, r) => n + r.stops.length, 0)}</strong>
        </div>
        <div>
          <span>Students on the bus</span>
          <strong>{onBus}</strong>
        </div>
        <div>
          <span>Homes pinned</span>
          <strong>
            {pinnedHomes}
            <small> of {students.length}</small>
          </strong>
        </div>
      </section>

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
        <RouteCard key={r.id} school={school} route={r} riders={riders} act={act} />
      ))}
    </>
  );
}

function RouteCard({ school, route, riders, act }) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(route.name);
  const [stopName, setStopName] = useState("");
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
            {route.stops.length} stops · {total} students
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
            <button className="link-btn link-danger" onClick={() => setAsking(true)}>
              Remove route
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
              hasMaps ? (
                <div className="tr-stop-search">
                  <PlacePicker
                    value={null}
                    placeholder="Search the stop, e.g. Hema Majra chowk"
                    label="Stop location"
                    onChange={async (p) => {
                      if (p?.lat != null && (await act(() => addStop(school.id, route.id, { ...p, name: p.name || p.address }, route.stops.length + 1))())) setAdding(false);
                    }}
                  />
                  <button className="link-btn" onClick={() => setAdding(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <form
                  className="tr-stop-search"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (stopName.trim() && (await act(() => addStop(school.id, route.id, { name: stopName }, route.stops.length + 1))())) {
                      setStopName("");
                      setAdding(false);
                    }
                  }}
                >
                  <input className="input" placeholder="Stop name" value={stopName} onChange={(e) => setStopName(e.target.value)} autoFocus maxLength={80} />
                  <button className="btn btn-primary btn-sm">Add</button>
                  <button type="button" className="link-btn" onClick={() => setAdding(false)}>
                    Cancel
                  </button>
                </form>
              )
            ) : (
              <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>
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
