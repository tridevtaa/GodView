// OpenStreetMap lookups for the student map: where the school is, and the
// villages and towns around it. Both services are free and shared, so they
// are called once, when the owner sets the map up, never per view.
import { areaKey } from "./areas.js";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS = "https://overpass-api.de/api/interpreter";

// A place by name, e.g. the school's town. { lat, lng } or null.
export async function findPlace(text) {
  const params = new URLSearchParams({ q: text, format: "jsonv2", limit: "1", countrycodes: "in", "accept-language": "en" });
  const res = await fetch(`${NOMINATIM}?${params}`);
  if (!res.ok) throw new Error("lookup-failed");
  const [hit] = await res.json();
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
}

// Rough distance in km (fine at village scale).
export const kmBetween = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180));

// Villages, towns and localities near a point, keyed by spelling-insensitive
// name: Map(key -> { name, lat, lng, km }). Village names repeat across the
// state, so only the closest match within `km` is kept.
export async function placesAround(center, km = 15) {
  const r = Math.round(km * 1000);
  const { lat, lng } = center;
  const query = `[out:json][timeout:60];(nwr(around:${r},${lat},${lng})[place][name];nwr(around:${r},${lat},${lng})[boundary=administrative][admin_level~"^(8|9|10)$"][name];);out center tags;`;
  const res = await fetch(OVERPASS, { method: "POST", body: new URLSearchParams({ data: query }) });
  if (!res.ok) throw new Error("lookup-failed");
  const { elements } = await res.json();
  const found = new Map();
  for (const e of elements) {
    const at = e.center ?? (e.lat != null ? { lat: e.lat, lon: e.lon } : null);
    if (!at) continue;
    const spot = { lat: at.lat, lng: at.lon };
    const dist = kmBetween(center, spot);
    if (dist > km) continue;
    const names = [e.tags["name:en"], e.tags.name, e.tags.alt_name, e.tags.old_name].filter(Boolean).flatMap((n) => n.split(";"));
    for (const n of names) {
      const key = areaKey(n);
      if (key && (!found.has(key) || found.get(key).km > dist)) found.set(key, { name: n.trim(), ...spot, km: dist });
    }
  }
  return found;
}
