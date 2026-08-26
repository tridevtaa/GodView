import React, { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  CircleMarker,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { collection, getDocs } from "firebase/firestore";
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
import { Link } from "react-router-dom";
import Tabs from "./Tabs.jsx";
import { ExcelPanel } from "./entityApi.jsx";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";

const ADD_ROUTE_TABS = [
  { key: "pins", label: "Pin Drop" },
  { key: "bulk", label: "Bulk Upload" },
];

// Fix default Leaflet marker icons (Vite bundling quirk) - safe to repeat.
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

function FlyTo({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.flyTo(center, zoom, { duration: 0.8 });
  }, [center, zoom, map]);
  return null;
}

function ClickCapture({ onClick }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng);
    },
  });
  return null;
}

export default function AddRoutePage() {
  const [schools, setSchools] = useState([]);
  const [buses, setBuses] = useState([]);
  const [routeId, setRouteId] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [busId, setBusId] = useState("");
  const [stops, setStops] = useState([]); // { name, lat, lng, students_count }
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [routedPath, setRoutedPath] = useState([]); // [[lat,lng], ...]
  const [tab, setTab] = useState("pins");

  useEffect(() => {
    async function load() {
      try {
        const [schoolSnap, busSnap] = await Promise.all([
          getDocs(collection(db, "schools")),
          getDocs(collection(db, "buses")),
        ]);
        setSchools(schoolSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setBuses(busSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        setLoadError(
          "Could not load schools/buses. Upload them first, and check Firestore rules.",
        );
      }
    }
    load();
  }, []);

  const selectedSchool = useMemo(
    () => schools.find((s) => s.id === schoolId) || null,
    [schools, schoolId],
  );

  // Build the route preview one-way: school -> stops in order, following
  // roads (no return leg back to the school).
  useEffect(() => {
    if (!selectedSchool || stops.length === 0) {
      setRoutedPath([]);
      return;
    }
    let cancelled = false;

    const schoolPoint = [selectedSchool.lat, selectedSchool.lng];
    setRoutedPath([schoolPoint, ...stops.map((s) => [s.lat, s.lng])]);

    (async () => {
      const waypoints = [
        { lat: selectedSchool.lat, lng: selectedSchool.lng },
        ...stops.map((s) => ({ lat: s.lat, lng: s.lng })),
      ];
      const path = await fetchRoadRoute(waypoints);
      if (!cancelled) setRoutedPath(path);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedSchool, stops]);

  function addStop(latlng) {
    setStops((prev) => [
      ...prev,
      {
        name: `Stop ${prev.length + 1}`,
        lat: latlng.lat,
        lng: latlng.lng,
        students_count: 0,
      },
    ]);
  }

  function updateStop(idx, field, value) {
    setStops((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)),
    );
  }

  function removeStop(idx) {
    setStops((prev) => prev.filter((_, i) => i !== idx));
  }

  function moveStop(idx, dir) {
    setStops((prev) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  async function handleSubmit() {
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch(`${BACKEND_URL}/routes/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          route_id: routeId,
          school_id: schoolId,
          bus_id: busId,
          stops: stops.map((s) => ({
            name: s.name,
            lat: s.lat,
            lng: s.lng,
            students_count: Number(s.students_count) || 0,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw Object.assign(new Error(data.error || "Save failed"), {
          details: data.details,
        });
      }
      setStatus({
        type: "success",
        message: `Route saved with ${data.stops_total} stop(s).`,
      });
      setRouteId("");
      setStops([]);
    } catch (e) {
      setStatus({ type: "error", message: e.message, details: e.details });
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    routeId.trim() && schoolId && busId && stops.length > 0 && !busy;

  const mapCenter = selectedSchool
    ? [selectedSchool.lat, selectedSchool.lng]
    : HARYANA_CENTER;

  return (
    <div className="add-route-page">
      <h1>Add Route</h1>
      <p>
        Drop pins on the map for a single route, or bulk-upload many routes at
        once from an Excel file (one row per stop). Needs schools and buses to
        already exist —{" "}
        <Link to="/schools" className="directory-footer-link">
          manage schools
        </Link>{" "}
        ·{" "}
        <Link to="/buses" className="directory-footer-link">
          manage buses
        </Link>
        .
      </p>

      <Tabs tabs={ADD_ROUTE_TABS} active={tab} onChange={setTab} />

      {tab === "bulk" ? (
        <ExcelPanel
          endpoint="/upload/routes"
          templateHint="Columns: route_id, school_id, bus_id, stop_order, stop_name, lat, lng, students_count — one row per stop; rows sharing the same route_id + school_id are grouped into one route."
          templateFile="routes_template.xlsx"
        />
      ) : (
        <>
          {loadError && <p className="status-err">{loadError}</p>}

          <div className="route-form-row">
            <label>
              Route ID
              <input
                value={routeId}
                onChange={(e) => setRouteId(e.target.value)}
                placeholder="e.g. RT003"
              />
            </label>
            <label>
              School
              <select
                value={schoolId}
                onChange={(e) => setSchoolId(e.target.value)}
              >
                <option value="">Select school</option>
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.id})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Bus
              <select value={busId} onChange={(e) => setBusId(e.target.value)}>
                <option value="">Select bus</option>
                {buses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.busNumber} ({b.id})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="add-route-map-wrap">
            <MapContainer
              center={mapCenter}
              zoom={selectedSchool ? 13 : DEFAULT_ZOOM}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              maxBounds={HARYANA_BOUNDS}
              maxBoundsViscosity={1.0}
              className="leaflet-container add-route-map"
            >
              <TileLayer
                attribution={TILE_ATTRIBUTION}
                url={TILE_URL}
                maxZoom={MAX_ZOOM}
              />
              {selectedSchool && <FlyTo center={mapCenter} zoom={13} />}
              <ClickCapture onClick={addStop} />

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
                  <Tooltip
                    permanent
                    direction="top"
                    offset={[0, -6]}
                    className="landmark-label"
                  >
                    {lm.name}
                  </Tooltip>
                </CircleMarker>
              ))}

              {selectedSchool && (
                <Marker position={mapCenter} icon={schoolIcon}>
                  <Popup>{selectedSchool.name}</Popup>
                </Marker>
              )}

              {stops.map((s, i) => (
                <Marker key={i} position={[s.lat, s.lng]}>
                  <Popup>
                    Stop {i + 1}: {s.name}
                  </Popup>
                </Marker>
              ))}

              {routedPath.length > 1 && (
                <Polyline
                  positions={routedPath}
                  pathOptions={{ color: "#1d3fae", weight: 4 }}
                />
              )}
            </MapContainer>
          </div>

          <div className="stop-list">
            {stops.length === 0 && (
              <p className="hint">
                Click the map above to drop your first stop.
              </p>
            )}
            {stops.map((s, i) => (
              <div key={i} className="stop-row">
                <span className="stop-index">{i + 1}</span>
                <input
                  value={s.name}
                  onChange={(e) => updateStop(i, "name", e.target.value)}
                  placeholder="Stop name"
                />
                <input
                  type="number"
                  min="0"
                  value={s.students_count}
                  onChange={(e) =>
                    updateStop(i, "students_count", e.target.value)
                  }
                  placeholder="Students"
                />
                <button
                  type="button"
                  onClick={() => moveStop(i, -1)}
                  disabled={i === 0}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveStop(i, 1)}
                  disabled={i === stops.length - 1}
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => removeStop(i)}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <button onClick={handleSubmit} disabled={!canSubmit}>
            {busy ? "Saving..." : "Save Route"}
          </button>

          {status && (
            <div
              className={status.type === "success" ? "status-ok" : "status-err"}
            >
              <p>{status.message}</p>
              {status.details && (
                <ul>
                  {status.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
