// Free public OSRM demo server - fine for an MVP's low traffic, but it's a
// shared, rate-limited demo instance. Self-host OSRM (or use a paid routing
// API) before this app sees real production traffic.
const OSRM_BASE = "https://router.project-osrm.org/route/v1/driving";

// points: ordered array of { lat, lng }. Returns an ordered array of
// [lat, lng] pairs following roads, via school -> stops -> school. Falls
// back to a straight line between the given points if the routing request
// fails (offline, demo server rate limit, no road route found, etc).
export async function fetchRoadRoute(points) {
  const straight = points.map((p) => [p.lat, p.lng]);
  if (points.length < 2) return straight;

  const coordStr = points.map((p) => `${p.lng},${p.lat}`).join(";");
  try {
    const res = await fetch(
      `${OSRM_BASE}/${coordStr}?overview=full&geometries=geojson`
    );
    const data = await res.json();
    if (!res.ok || data.code !== "Ok" || !data.routes?.length) {
      throw new Error(data.message || "No road route found");
    }
    return data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  } catch (e) {
    console.warn("Road routing failed, falling back to straight line:", e);
    return straight;
  }
}
