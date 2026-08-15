import React, { useEffect, useState, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  CircleMarker,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { db } from "../firebase.js";
import { fetchRoadRoute } from "../utils/roadRoute.js";
import {
  HARYANA_CENTER,
  HARYANA_BOUNDS,
  DEFAULT_ZOOM,
  MIN_ZOOM,
  MAX_ZOOM,
  TILE_URL,
  TILE_ATTRIBUTION,
} from "../utils/mapConfig.js";
import { LANDMARKS } from "../utils/landmarks.js";

// Fix default Leaflet marker icons (Vite bundling quirk)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const schoolIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [30, 46],
  iconAnchor: [15, 46],
  className: "school-marker-icon",
});

const ROUTE_COLORS = [
  "#1d3fae", // godview navy
  "#e63946",
  "#2a9d8f",
  "#f4a261",
  "#8e44ad",
  "#118ab2",
  "#d90429",
];

function FlyToSchool({ school }) {
  const map = useMap();
  useEffect(() => {
    if (school) {
      map.flyTo([school.lat, school.lng], 13, { duration: 0.8 });
    }
  }, [school, map]);
  return null;
}

export default function MapView() {
  const [schools, setSchools] = useState([]);
  const [selectedSchool, setSelectedSchool] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [allRoutes, setAllRoutes] = useState([]); // every route, for the overview stats bar
  const [buses, setBuses] = useState({}); // id -> bus doc
  const [drivers, setDrivers] = useState({}); // id -> driver doc
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [error, setError] = useState(null);
  const [routePaths, setRoutePaths] = useState({}); // routeId -> [[lat,lng], ...]

  // Load all schools once
  useEffect(() => {
    async function loadSchools() {
      try {
        const snap = await getDocs(collection(db, "schools"));
        setSchools(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.error("Failed to load schools:", e);
        setError(
          `Could not load schools from Firebase: ${e.code || e.message}`
        );
      }
    }
    loadSchools();
  }, []);

  // Load buses + drivers + routes once (small collections, fine to cache
  // client-side) so the overview stats bar has real totals before any
  // school pin is clicked. The map itself stays zoomed out on load instead
  // of auto-flying to one school, so it reads as an overview, not a
  // single-record drill-down.
  useEffect(() => {
    async function loadLookups() {
      const busSnap = await getDocs(collection(db, "buses"));
      const busMap = {};
      busSnap.docs.forEach((d) => (busMap[d.id] = { id: d.id, ...d.data() }));
      setBuses(busMap);

      const driverSnap = await getDocs(collection(db, "drivers"));
      const driverMap = {};
      driverSnap.docs.forEach(
        (d) => (driverMap[d.id] = { id: d.id, ...d.data() })
      );
      setDrivers(driverMap);

      const routeSnap = await getDocs(collection(db, "routes"));
      setAllRoutes(routeSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }
    loadLookups();
  }, []);

  const totalStudentsOverall = useMemo(() => {
    return allRoutes.reduce((sum, r) => {
      const stopsTotal = (r.stops || []).reduce(
        (s, stop) => s + (Number(stop.studentsCount) || 0),
        0
      );
      return sum + stopsTotal;
    }, 0);
  }, [allRoutes]);

  async function handleSchoolClick(school) {
    setSelectedSchool(school);
    setLoadingRoutes(true);
    setRoutes([]);
    try {
      const q = query(
        collection(db, "routes"),
        where("schoolId", "==", school.id)
      );
      const snap = await getDocs(q);
      setRoutes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      setError("Could not load routes for this school.");
    } finally {
      setLoadingRoutes(false);
    }
  }

  // For each route, build a road-following path starting at the school
  // and ending at the last stop (one-way, no return leg).
  useEffect(() => {
    if (!selectedSchool || routes.length === 0) {
      setRoutePaths({});
      return;
    }
    let cancelled = false;

    setRoutePaths((prev) => {
      const straightFallback = {};
      routes.forEach((route) => {
        const stops = (route.stops || [])
          .slice()
          .sort((a, b) => (a.order || 0) - (b.order || 0));
        straightFallback[route.id] = [
          [selectedSchool.lat, selectedSchool.lng],
          ...stops.map((s) => [s.lat, s.lng]),
        ];
      });
      return straightFallback;
    });

    (async () => {
      const entries = await Promise.all(
        routes.map(async (route) => {
          const stops = (route.stops || [])
            .slice()
            .sort((a, b) => (a.order || 0) - (b.order || 0));
          const waypoints = [
            { lat: selectedSchool.lat, lng: selectedSchool.lng },
            ...stops.map((s) => ({ lat: s.lat, lng: s.lng })),
          ];
          const path = await fetchRoadRoute(waypoints);
          return [route.id, path];
        })
      );
      if (!cancelled) setRoutePaths(Object.fromEntries(entries));
    })();

    return () => {
      cancelled = true;
    };
  }, [routes, selectedSchool]);

  const totalStudents = useMemo(() => {
    return routes.reduce((sum, r) => {
      const stopsTotal = (r.stops || []).reduce(
        (s, stop) => s + (Number(stop.studentsCount) || 0),
        0
      );
      return sum + stopsTotal;
    }, 0);
  }, [routes]);

  return (
    <div className="map-page">
      {error && <div className="banner banner-error">{error}</div>}

      <div className="map-stats-bar">
        <div className="map-stat-tile">
          <span className="map-stat-value">{schools.length}</span>
          <span className="map-stat-label">Schools</span>
        </div>
        <div className="map-stat-tile">
          <span className="map-stat-value">{Object.keys(buses).length}</span>
          <span className="map-stat-label">Buses</span>
        </div>
        <div className="map-stat-tile">
          <span className="map-stat-value">{Object.keys(drivers).length}</span>
          <span className="map-stat-label">Drivers</span>
        </div>
        <div className="map-stat-tile">
          <span className="map-stat-value">{allRoutes.length}</span>
          <span className="map-stat-label">Routes</span>
        </div>
        <div className="map-stat-tile">
          <span className="map-stat-value">{totalStudentsOverall}</span>
          <span className="map-stat-label">Students</span>
        </div>
      </div>

      <MapContainer
        center={HARYANA_CENTER}
        zoom={DEFAULT_ZOOM}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        maxBounds={HARYANA_BOUNDS}
        maxBoundsViscosity={1.0}
        className="leaflet-container"
      >
        <TileLayer
          attribution={TILE_ATTRIBUTION}
          url={TILE_URL}
          maxZoom={MAX_ZOOM}
        />

        {selectedSchool && <FlyToSchool school={selectedSchool} />}

        {LANDMARKS.map((lm) => (
          <CircleMarker
            key={lm.id}
            center={[lm.lat, lm.lng]}
            radius={5}
            pathOptions={{
              color: lm.type === "university" ? "#7c3aed" : "#0f766e",
              fillColor: lm.type === "university" ? "#7c3aed" : "#0f766e",
              fillOpacity: 0.9,
              weight: 2,
            }}
          >
            <Tooltip permanent direction="top" offset={[0, -6]} className="landmark-label">
              {lm.name}
            </Tooltip>
          </CircleMarker>
        ))}

        {schools.map((school) => (
          <Marker
            key={school.id}
            position={[school.lat, school.lng]}
            icon={schoolIcon}
            eventHandlers={{ click: () => handleSchoolClick(school) }}
          >
            <Popup>
              <strong>{school.name}</strong>
              <br />
              Click marker to view all bus routes.
            </Popup>
          </Marker>
        ))}

        {routes.map((route, idx) => {
          const color = ROUTE_COLORS[idx % ROUTE_COLORS.length];
          const stops = (route.stops || []).slice().sort(
            (a, b) => (a.order || 0) - (b.order || 0)
          );
          const path = routePaths[route.id];
          const bus = buses[route.busId];
          const driver = bus ? drivers[bus.driverId] : null;

          return (
            <React.Fragment key={route.id}>
              {path && path.length > 1 && (
                <Polyline positions={path} pathOptions={{ color, weight: 4 }} />
              )}
              {stops.map((stop, sIdx) => (
                <Marker
                  key={`${route.id}-${sIdx}`}
                  position={[stop.lat, stop.lng]}
                >
                  <Popup>
                    <div>
                      <strong>{stop.name}</strong>
                      <br />
                      Bus: {bus ? bus.busNumber : route.busId}
                      <br />
                      Driver: {driver ? driver.name : "Not assigned"}
                      <br />
                      Students boarding: <strong>{stop.studentsCount || 0}</strong>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </React.Fragment>
          );
        })}
      </MapContainer>

      {selectedSchool && (
        <div className="side-panel">
          <h2>{selectedSchool.name}</h2>
          {loadingRoutes && <p>Loading routes...</p>}
          {!loadingRoutes && routes.length === 0 && (
            <p>No routes found for this school yet. Upload route data first.</p>
          )}
          {!loadingRoutes && routes.length > 0 && (
            <>
              <p className="summary">
                {routes.length} bus route(s) &middot; {totalStudents} students total
              </p>
              <ul className="route-list">
                {routes.map((route, idx) => {
                  const bus = buses[route.busId];
                  const driver = bus ? drivers[bus.driverId] : null;
                  const stopsTotal = (route.stops || []).reduce(
                    (s, stop) => s + (Number(stop.studentsCount) || 0),
                    0
                  );
                  return (
                    <li key={route.id}>
                      <span
                        className="color-dot"
                        style={{
                          background: ROUTE_COLORS[idx % ROUTE_COLORS.length],
                        }}
                      />
                      <strong>Bus {bus ? bus.busNumber : route.busId}</strong>
                      {driver && <span> &middot; Driver: {driver.name}</span>}
                      <div className="stop-count">
                        {(route.stops || []).length} stops &middot; {stopsTotal} students
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
