import Icon from "./Icon.jsx";

// How a student comes to school: not by bus, or a route and stop.
// value: { uses_bus, bus_stop_id }
export default function TransportPicker({ routes, value, onChange, onManage }) {
  const usesBus = Boolean(value?.uses_bus);
  const stopId = value?.bus_stop_id ?? "";
  const route = routes.find((r) => r.stops.some((s) => s.id === stopId));
  const routeId = value?.route_id ?? route?.id ?? "";
  const stops = routes.find((r) => r.id === routeId)?.stops ?? [];

  return (
    <div className="transport">
      <div className="choice-row" role="radiogroup" aria-label="Transport">
        <button type="button" role="radio" aria-checked={!usesBus} className={`choice${!usesBus ? " on" : ""}`} onClick={() => onChange({ uses_bus: false, bus_stop_id: null })}>
          Doesn’t use the bus
        </button>
        <button type="button" role="radio" aria-checked={usesBus} className={`choice${usesBus ? " on" : ""}`} onClick={() => onChange({ uses_bus: true, bus_stop_id: stopId || null })}>
          <Icon name="bus" />
          School bus
        </button>
      </div>

      {usesBus &&
        (routes.length === 0 ? (
          <p className="callout callout-neutral transport-empty">
            No bus routes yet.{" "}
            {onManage ? (
              <button type="button" className="link-btn" onClick={onManage}>
                Add routes in Owner → Transport
              </button>
            ) : (
              "The school owner adds routes in Owner → Transport."
            )}{" "}
            You can pick the stop later.
          </p>
        ) : (
          <div className="form-grid">
            <label>
              <span>Route</span>
              <select value={routeId} onChange={(e) => onChange({ uses_bus: true, route_id: e.target.value, bus_stop_id: null })}>
                <option value="">Choose a route</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Stop</span>
              <select
                value={stopId}
                disabled={!routeId}
                onChange={(e) => onChange({ uses_bus: true, route_id: routeId, bus_stop_id: e.target.value || null })}
              >
                <option value="">{routeId ? "Choose a stop" : "Pick a route first"}</option>
                {stops.map((s, i) => (
                  <option key={s.id} value={s.id}>
                    {i + 1}. {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ))}
    </div>
  );
}

// "Route 3 · Hema Majra chowk" for a stop id.
export function stopLabel(routes, stopId) {
  for (const r of routes) {
    const s = r.stops.find((x) => x.id === stopId);
    if (s) return `${r.name} · ${s.name}`;
  }
  return "";
}
