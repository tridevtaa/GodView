// Finds a village on Google Maps near the school (once the key is added).
import { hasMaps, loadMaps } from "./maps.js";
import { kmBetween } from "./osm.js";

export { hasMaps };

export async function findOnGoogle(name, near) {
  await loadMaps();
  const { Place } = await window.google.maps.importLibrary("places");
  const { places } = await Place.searchByText({
    textQuery: `${name}, India`,
    fields: ["location", "displayName", "id"],
    locationBias: near ? { center: near, radius: 40000 } : undefined,
    maxResultCount: 1,
    region: "in",
  });
  const p = places?.[0];
  if (!p) return null;
  const lat = p.location.lat();
  const lng = p.location.lng();
  // Ignore a same-named village far from the school.
  if (near && kmBetween(near, { lat, lng }) > 25) return null;
  return { lat, lng };
}
