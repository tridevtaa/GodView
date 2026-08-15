// Shared Leaflet config so the app only ever shows Haryana, not the whole world.
export const HARYANA_CENTER = [29.0588, 76.0856];

// Bounding box with a small buffer around Haryana's real borders
// (~27.65N-30.95N, 74.45E-77.65E) so the state fits comfortably on screen.
export const HARYANA_BOUNDS = [
  [27.3, 74.2], // southwest
  [31.05, 77.9], // northeast
];

// Start a bit closer than the min so town names are visible on load;
// village names appear progressively as the user zooms in further (the
// basemap itself declutters by zoom level, same as Google Maps).
export const DEFAULT_ZOOM = 9;
export const MIN_ZOOM = 8;
export const MAX_ZOOM = 19;

// CARTO Voyager: sharper, retina-aware (@2x via {r}) basemap with cleaner
// labels than the plain OSM raster tiles used before.
export const TILE_URL =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
