// Google Maps for place search and pins. The browser key is public by design;
// it's locked to GodView's web addresses in Google Cloud.
const KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;
export const MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID || "DEMO_MAP_ID";
export const hasMaps = Boolean(KEY);

let loading = null;
let failed = false;

export function loadMaps() {
  if (!KEY) return Promise.reject(new Error("no-key"));
  if (failed) return Promise.reject(new Error("key-rejected"));
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  loading ??= new Promise((resolve, reject) => {
    window.__godviewMapsReady = () => resolve(window.google.maps);
    // Google calls this when the key is wrong or not allowed on this site.
    window.gm_authFailure = () => {
      failed = true;
      reject(new Error("key-rejected"));
    };
    const s = document.createElement("script");
    const params = new URLSearchParams({
      key: KEY,
      v: "weekly",
      loading: "async",
      libraries: "places,marker",
      region: "IN",
      language: "en",
      callback: "__godviewMapsReady",
    });
    s.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error("load-failed"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

// A Google Maps link anyone can open (phone or computer).
export const mapsLink = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

// City and state from a Places address, for the address fields.
export function addressParts(components = []) {
  const find = (...types) => components.find((c) => types.some((t) => c.types.includes(t)))?.longText ?? "";
  return {
    city: find("locality", "administrative_area_level_3", "sublocality", "administrative_area_level_2"),
    state: find("administrative_area_level_1"),
  };
}
