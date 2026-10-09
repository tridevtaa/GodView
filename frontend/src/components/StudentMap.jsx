import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import L from "../data/leaflet.js";
import "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { addAreas, deleteArea, listAreas, logoUrl, mergeAreas, setSchoolLocation, updateArea } from "../data/api.js";
import { aliasIndex, areaKey, buildAreas, locate } from "../data/areas.js";
import { findPlace, kmBetween, placesAround } from "../data/osm.js";
import { findOnGoogle, hasMaps } from "../data/googlePlaces.js";
import { Photo, gradeLabel } from "./PersonCard.jsx";
import Icon from "./Icon.jsx";

// Pins run from red (a few students) through amber to deep indigo (many).
// Fixed steps, so a village keeps its colour when filters change.
const TIERS = [
  { min: 50, label: "50+" },
  { min: 20, label: "20–49" },
  { min: 10, label: "10–19" },
  { min: 5, label: "5–9" },
  { min: 1, label: "1–4" },
];
const tierOf = (n) => TIERS.length - TIERS.findIndex((t) => n >= t.min); // 1 (few) to 5 (many)

// Distance rings around the school.
const RINGS = [5, 10, 15];

const BUS = [
  ["all", "Everyone"],
  ["bus", "Bus"],
  ["nobus", "No bus"],
];

// Owners/admins: where students come from. Students are grouped by village
// (from their address or pick-up point); a pinned home shows on its own.
// Numbers merge into clusters as you zoom out; clicking one lists them.
export default function StudentMap({ school, students, allStudents, canEdit, onOpenStudent }) {
  const [areas, setAreas] = useState(null);
  const [error, setError] = useState("");
  const [bus, setBus] = useState("all");
  const [selected, setSelected] = useState(null); // { ids: [areaId or "home:<studentId>"], title }
  const [placing, setPlacing] = useState(null); // { kind: "area", area } | { kind: "school" }
  const [progress, setProgress] = useState(null);
  const [home, setHome] = useState(school.lat != null ? { lat: school.lat, lng: school.lng } : null);
  const wrap = useRef(null);
  const [height, setHeight] = useState(600);

  const load = useCallback(async () => {
    try {
      setAreas(await listAreas(school.id));
      setError("");
    } catch (err) {
      setAreas([]);
      setError(err?.code === "PGRST205" ? "The map isn’t set up in the database yet (npx supabase db push)." : "Couldn’t load the map. Check your connection.");
    }
  }, [school.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Fill the screen below the toolbar.
  useLayoutEffect(() => {
    const fit = () => wrap.current && setHeight(Math.max(480, window.innerHeight - wrap.current.getBoundingClientRect().top - 20));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const shown = useMemo(
    () => students.filter((s) => (bus === "all" ? true : bus === "bus" ? s.uses_bus || Boolean(s.pickup_point) : !(s.uses_bus || s.pickup_point))),
    [students, bus]
  );

  // Everyone placed: by village, or at their own pin.
  const { groups, unplaced, unpinnedAreas, newPlaces } = useMemo(() => {
    const list = areas ?? [];
    const byAlias = aliasIndex(list);
    const g = new Map();
    const none = [];
    const noPin = new Map();
    for (const s of shown) {
      const loc = locate(s, list, byAlias);
      if (loc?.exact) {
        g.set(`home:${s.id}`, { id: `home:${s.id}`, name: s.name, lat: loc.lat, lng: loc.lng, students: [s], exact: true, area: loc.area });
      } else if (loc?.area && loc.lat != null) {
        const e = g.get(loc.area.id) ?? { id: loc.area.id, name: loc.area.name, lat: loc.lat, lng: loc.lng, students: [], area: loc.area };
        e.students.push(s);
        g.set(loc.area.id, e);
      } else if (loc?.area) {
        const e = noPin.get(loc.area.id) ?? { area: loc.area, students: [] };
        e.students.push(s);
        noPin.set(loc.area.id, e);
      } else {
        none.push(s);
      }
    }
    // Village names on students that aren't in the list yet.
    const fresh = list.length ? buildAreas(none).filter((a) => a.count > 0) : [];
    return {
      groups: [...g.values()],
      unplaced: none,
      unpinnedAreas: [...noPin.values()].sort((a, b) => b.students.length - a.students.length),
      newPlaces: fresh,
    };
  }, [areas, shown]);

  const onMap = groups.reduce((n, g) => n + g.students.length, 0);
  const selGroups = selected ? groups.filter((g) => selected.ids.includes(g.id)) : [];
  const selStudents = selGroups.flatMap((g) => g.students);

  // First-time setup: list the villages, then find them on the map.
  async function setup(rows) {
    setError("");
    try {
      setProgress({ label: "Finding the school…" });
      let center = home;
      if (!center) {
        const town = [school.city, school.state].filter(Boolean).join(", ") || `${rows[0]?.name ?? ""}, India`;
        center = await findPlace(town);
        if (center) {
          await setSchoolLocation(school.id, center.lat, center.lng).catch(() => {});
          setHome(center);
        }
      }
      const found = new Map();
      if (center) {
        setProgress({ label: "Looking up villages on OpenStreetMap…" });
        const near = await placesAround(center).catch(() => new Map());
        rows.forEach((r) => near.has(r.key) && found.set(r.key, { ...near.get(r.key), source: "osm" }));
        if (hasMaps) {
          const rest = rows.filter((r) => !found.has(r.key));
          for (let i = 0; i < rest.length; i++) {
            setProgress({ label: `Finding on Google Maps: ${rest[i].name}`, done: i, total: rest.length });
            const hit = await findOnGoogle(rest[i].name, center).catch(() => null);
            if (hit) found.set(rest[i].key, { ...hit, source: "google" });
          }
        }
      }
      setProgress({ label: "Saving…" });
      await addAreas(
        school.id,
        rows.map((r) => ({ name: r.name, aliases: [r.key], ...(found.get(r.key) ? { lat: found.get(r.key).lat, lng: found.get(r.key).lng, source: found.get(r.key).source } : {}) }))
      );
      await load();
    } catch (err) {
      setError(err?.code === "23505" ? "Some of those villages are already on the list." : err?.code === "PGRST205" ? "The map isn’t set up in the database yet (npx supabase db push)." : "Setting up the map didn’t finish. Check your connection and try again.");
    } finally {
      setProgress(null);
    }
  }

  async function act(fn) {
    setError("");
    try {
      await fn();
      await load();
    } catch {
      setError("That didn’t go through. Try again.");
    }
  }

  async function onPlace(lat, lng) {
    const p = placing;
    setPlacing(null);
    if (p.kind === "school") {
      await setSchoolLocation(school.id, lat, lng).then(() => setHome({ lat, lng }), () => setError("Couldn’t save the school’s spot."));
    } else {
      await act(() => updateArea(p.area.id, { lat, lng, source: "manual" }));
      setSelected({ ids: [p.area.id] });
    }
  }

  const firstRun = areas !== null && areas.length === 0;
  const suggestions = useMemo(() => (firstRun ? buildAreas(allStudents) : []), [firstRun, allStudents]);

  return (
    <div className="smap" ref={wrap} style={{ height }}>
      <div className={`smap-map${placing ? " is-placing" : ""}`}>
        <LeafletMap groups={groups} home={home} school={school} selected={selected} placing={placing} onSelect={setSelected} onPlace={onPlace} />

        <div className="smap-top">
          <nav className="segmented smap-seg" aria-label="Transport">
            {BUS.map(([v, l]) => (
              <button key={v} className={bus === v ? "active" : ""} onClick={() => setBus(v)}>
                {l}
              </button>
            ))}
          </nav>
          {placing && (
            <span className="smap-placing">
              <Icon name="pin" />
              Click the map where {placing.kind === "school" ? "the school is" : placing.area.name + " is"}
              <button className="link-btn" onClick={() => setPlacing(null)}>
                Cancel
              </button>
            </span>
          )}
        </div>
        <div className="smap-legend">
          <span className="smap-scale" title="Students per village">
            Students
            {[...TIERS].reverse().map((t, i) => (
              <span key={t.min} className="smap-step">
                <i className={`tier-${i + 1}`} />
                {t.label}
              </span>
            ))}
          </span>
          <span>
            <i className="smap-dot is-cluster" /> Several villages
          </span>
          <span>
            <i className="smap-dot is-home" /> Pinned home
          </span>
          {home && (
            <span>
              <i className="smap-ring" /> 5, 10, 15 km
            </span>
          )}
        </div>
      </div>

      <aside className="smap-panel">
        {error && <p className="notice notice-error smap-error">{error}</p>}

        {areas === null ? (
          <p className="row-sub smap-pad">Loading…</p>
        ) : firstRun ? (
          <div className="smap-pad smap-setup">
            <span className="smap-setup-icon">
              <Icon name="pin" size={26} />
            </span>
            <h2>See where students come from</h2>
            <p className="row-sub">
              {suggestions.reduce((n, a) => n + a.count, 0)} students name {suggestions.length} villages and towns in their
              address or pick-up point. GodView will put them on the map, merging spellings like Hemamajra and Hema Majra.
            </p>
            <ol className="smap-setup-list">
              {suggestions.slice(0, 6).map((a) => (
                <li key={a.key}>
                  <span>{a.name}</span>
                  <strong>{a.count}</strong>
                </li>
              ))}
              {suggestions.length > 6 && <li className="row-sub">and {suggestions.length - 6} more</li>}
            </ol>
            {canEdit ? (
              <button className="btn btn-primary" disabled={Boolean(progress) || !suggestions.length} onClick={() => setup(suggestions)}>
                {progress ? progress.label : "Put them on the map"}
              </button>
            ) : (
              <p className="row-sub">The school owner or an admin can set this up.</p>
            )}
            {progress?.total && <progress max={progress.total} value={progress.done} />}
          </div>
        ) : selected ? (
          <Selection
            groups={selGroups}
            students={selStudents}
            canEdit={canEdit}
            areas={areas}
            onClose={() => setSelected(null)}
            onOpenStudent={onOpenStudent}
            onMove={(area) => setPlacing({ kind: "area", area })}
            onRename={(area, name) => act(() => updateArea(area.id, { name, aliases: [...new Set([...(area.aliases ?? []), areaKey(area.name)])] }))}
            onMerge={(into, from) => act(() => mergeAreas(into, from)).then(() => setSelected({ ids: [into.id] }))}
          />
        ) : (
          <Overview
            groups={groups}
            onMap={onMap}
            total={shown.length}
            unpinnedAreas={unpinnedAreas}
            unplaced={unplaced}
            newPlaces={newPlaces}
            hasSchool={Boolean(home)}
            canEdit={canEdit}
            progress={progress}
            onSelect={(g) => setSelected({ ids: [g.id], fly: true })}
            onPlace={(area) => setPlacing({ kind: "area", area })}
            onPlaceSchool={() => setPlacing({ kind: "school" })}
            onAddNew={() => setup(newPlaces)}
            onRemove={(area) => act(() => deleteArea(area.id))}
            onOpenStudent={onOpenStudent}
          />
        )}
      </aside>
    </div>
  );
}

function Overview({ groups, onMap, total, unpinnedAreas, unplaced, newPlaces, hasSchool, canEdit, progress, onSelect, onPlace, onPlaceSchool, onAddNew, onRemove, onOpenStudent }) {
  const [q, setQ] = useState("");
  const [showUnplaced, setShowUnplaced] = useState(false);
  const villages = groups.filter((g) => !g.exact).sort((a, b) => b.students.length - a.students.length);
  const homes = groups.filter((g) => g.exact).length;
  const max = villages[0]?.students.length ?? 1;
  const hit = (name) => name.toLowerCase().includes(q.trim().toLowerCase());
  const notOnMap = unpinnedAreas.reduce((n, a) => n + a.students.length, 0) + unplaced.length;

  return (
    <div className="smap-overview">
      <div className="smap-pad smap-stats">
        <div>
          <strong>{onMap}</strong>
          <span>on the map</span>
        </div>
        <div>
          <strong>{villages.length}</strong>
          <span>villages{homes ? ` · ${homes} homes` : ""}</span>
        </div>
        <div className={notOnMap ? "is-warn" : ""}>
          <strong>{notOnMap}</strong>
          <span>not placed</span>
        </div>
      </div>
      {total > 0 && (
        <div className="smap-pad smap-bar" title={`${onMap} of ${total} students placed`}>
          <span style={{ width: `${(onMap / total) * 100}%` }} />
        </div>
      )}

      {canEdit && !hasSchool && (
        <button className="smap-fix smap-pad" onClick={onPlaceSchool}>
          <Icon name="pin" />
          <span>
            <strong>Place the school on the map</strong>
            <span className="row-sub">So the map centres on it.</span>
          </span>
        </button>
      )}

      <div className="smap-pad">
        <label className="search smap-search">
          <Icon name="search" />
          <input type="search" placeholder="Find a village" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a village" />
        </label>
      </div>

      <div className="smap-scroll">
        {canEdit && unpinnedAreas.length > 0 && (
          <section className="smap-section">
            <h3>
              Not on the map yet <span className="badge badge-warning">{unpinnedAreas.length}</span>
            </h3>
            <p className="row-sub">{hasMaps ? "Place each one by clicking its spot on the map." : "OpenStreetMap doesn’t know these. Click Place, then click the village on the map. Google Maps will find most of them once the key is added."}</p>
            <ul className="smap-list">
              {unpinnedAreas.filter((a) => hit(a.area.name)).map(({ area, students }) => (
                <li key={area.id}>
                  <span className="smap-row-name">{area.name}</span>
                  <span className="smap-count">{students.length}</span>
                  <button className="btn btn-secondary btn-sm" onClick={() => onPlace(area)}>
                    <Icon name="pin" />
                    Place
                  </button>
                  {students.length === 0 && (
                    <button className="ft-x" aria-label={`Remove ${area.name}`} onClick={() => onRemove(area)}>
                      <Icon name="x" size={12} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {canEdit && newPlaces.length > 0 && (
          <section className="smap-section">
            <h3>
              New places <span className="badge badge-brand">{newPlaces.length}</span>
            </h3>
            <p className="row-sub">
              {newPlaces.slice(0, 4).map((a) => a.name).join(", ")}
              {newPlaces.length > 4 ? "…" : ""} from newer students.
            </p>
            <button className="btn btn-secondary btn-sm" onClick={onAddNew} disabled={Boolean(progress)}>
              {progress ? progress.label : "Add them to the map"}
            </button>
          </section>
        )}

        <section className="smap-section">
          <h3>Villages and towns</h3>
          <ul className="smap-list">
            {villages.filter((g) => hit(g.name)).map((g) => (
              <li key={g.id}>
                <button className="smap-row" onClick={() => onSelect(g)}>
                  <span className="smap-row-name">{g.name}</span>
                  <span className="smap-row-bar">
                    <span className={`tier-${tierOf(g.students.length)}`} style={{ width: `${Math.max(4, (g.students.length / max) * 100)}%` }} />
                  </span>
                  <span className="smap-count">{g.students.length}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {unplaced.length > 0 && (
          <section className="smap-section">
            <h3>
              No village recorded <span className="badge badge-neutral">{unplaced.length}</span>
            </h3>
            <p className="row-sub">Add an address or pin their home in the student’s profile.</p>
            <button className="link-btn" onClick={() => setShowUnplaced((v) => !v)}>
              {showUnplaced ? "Hide" : "Show"} students
            </button>
            {showUnplaced && <StudentRows students={unplaced} onOpenStudent={onOpenStudent} />}
          </section>
        )}
      </div>
    </div>
  );
}

function Selection({ groups, students, canEdit, areas, onClose, onOpenStudent, onMove, onRename, onMerge }) {
  const single = groups.length === 1 && !groups[0].exact ? groups[0].area : null;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(single?.name ?? "");
  const [merging, setMerging] = useState(false);
  const onBus = students.filter((s) => s.uses_bus || s.pickup_point).length;
  const byGrade = useMemo(() => {
    const m = new Map();
    students.forEach((s) => m.set(s.class, (m.get(s.class) ?? 0) + 1));
    return [...m];
  }, [students]);
  const title = groups.length === 1 ? groups[0].name : `${groups.length} places`;

  return (
    <div className="smap-overview">
      <div className="smap-pad smap-sel-head">
        <button className="btn-icon" onClick={onClose} aria-label="Back to all villages">
          <Icon name="arrowLeft" size={18} />
        </button>
        <div>
          {renaming ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim() && name.trim() !== single.name) onRename(single, name.trim());
                setRenaming(false);
              }}
            >
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus onBlur={() => setRenaming(false)} maxLength={80} />
            </form>
          ) : (
            <h2>{title}</h2>
          )}
          <p className="row-sub">
            {students.length} students · {onBus} by bus
            {groups.length > 1 && ` · ${groups.map((g) => g.name).slice(0, 3).join(", ")}${groups.length > 3 ? "…" : ""}`}
          </p>
        </div>
      </div>

      {byGrade.length > 0 && (
        <div className="smap-pad smap-grades">
          {byGrade
            .sort((a, b) => b[1] - a[1])
            .map(([g, n]) => (
              <span key={g} className="smap-grade">
                {gradeLabel(g)} <strong>{n}</strong>
              </span>
            ))}
        </div>
      )}

      {canEdit && single && (
        <div className="smap-pad smap-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => onMove(single)}>
            <Icon name="pin" />
            Move pin
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setRenaming(true)}>
            <Icon name="edit" />
            Rename
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setMerging((v) => !v)}>
            Merge…
          </button>
        </div>
      )}
      {merging && single && (
        <div className="smap-pad">
          <select
            className="select smap-merge"
            defaultValue=""
            onChange={(e) => {
              const into = areas.find((a) => a.id === e.target.value);
              if (into) onMerge(into, single);
            }}
          >
            <option value="" disabled>
              Same place as…
            </option>
            {areas
              .filter((a) => a.id !== single.id)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
          <p className="row-sub">{single.name}’s students move into the chosen village, and its spelling is remembered.</p>
        </div>
      )}

      <div className="smap-scroll">
        {groups.length > 1
          ? groups
              .sort((a, b) => b.students.length - a.students.length)
              .map((g) => (
                <section key={g.id} className="smap-section">
                  <h3>
                    {g.name} <span className="badge badge-neutral">{g.students.length}</span>
                  </h3>
                  <StudentRows students={g.students} onOpenStudent={onOpenStudent} />
                </section>
              ))
          : <StudentRows students={students} onOpenStudent={onOpenStudent} />}
      </div>
    </div>
  );
}

function StudentRows({ students, onOpenStudent }) {
  const sorted = [...students].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <ul className="smap-students">
      {sorted.map((s) => (
        <li key={s.id}>
          <button onClick={() => onOpenStudent(s.id)}>
            <Photo person={s} className="smap-photo" />
            <span className="smap-st">
              <strong>{s.name}</strong>
              <span className="row-sub">
                {gradeLabel(s.class)}
                {s.section ? ` · ${s.section}` : ""}
                {s.parent_name ? ` · ${s.parent_name}` : ""}
              </span>
            </span>
            {(s.uses_bus || s.pickup_point) && (
              <span className="smap-bus" title={s.pickup_point ? `Bus · ${s.pickup_point}` : "Bus"}>
                <Icon name="bus" size={14} />
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

// The Leaflet map: one marker per village (or pinned home), clustered.
function LeafletMap({ groups, home, school, selected, placing, onSelect, onPlace }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const schoolMarker = useRef(null);
  const touched = useRef(false); // the user moved the map; stop auto-fitting
  const points = useRef([]);
  const cb = useRef({});
  cb.current = { onSelect, onPlace, placing };

  useEffect(() => {
    const m = L.map(el.current, { zoomControl: false, minZoom: 5, maxZoom: 18, center: [30.27, 77.05], zoom: 11 });
    L.control.zoom({ position: "bottomright" }).addTo(m);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    }).addTo(m);
    const cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      zoomToBoundsOnClick: false,
      spiderfyOnMaxZoom: false,
      maxClusterRadius: 56,
      iconCreateFunction: (c) => {
        const n = c.getAllChildMarkers().reduce((t, mk) => t + mk.options.count, 0);
        const size = Math.round(40 + Math.min(28, Math.sqrt(n) * 2.2));
        return L.divIcon({ className: "smap-icon", html: `<span class="smap-cluster tier-${tierOf(n)}">${n}</span>`, iconSize: [size, size] });
      },
    });
    cluster.on("clusterclick", (e) => {
      touched.current = true;
      const ids = e.layer.getAllChildMarkers().map((mk) => mk.options.groupId);
      cb.current.onSelect({ ids });
      m.fitBounds(e.layer.getBounds().pad(0.35), { maxZoom: 15 });
    });
    m.addLayer(cluster);
    m.on("click", (e) => {
      if (cb.current.placing) cb.current.onPlace(e.latlng.lat, e.latlng.lng);
    });
    map.current = m;
    layer.current = cluster;
    // Re-measure when the box changes size (screen resize, panel layout).
    const fitAll = () => {
      const pts = points.current;
      if (pts.length > 1) m.fitBounds(L.latLngBounds(pts), { maxZoom: 13, paddingTopLeft: [50, 90], paddingBottomRight: [70, 70], animate: false });
      else if (pts.length === 1) m.setView(pts[0], 12, { animate: false });
    };
    const touch = () => (touched.current = true);
    ["pointerdown", "wheel", "touchstart"].forEach((ev) => el.current.addEventListener(ev, touch, { passive: true }));
    const ro = new ResizeObserver(() => {
      m.invalidateSize();
      if (!touched.current) fitAll();
    });
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
    };
  }, []);

  // Markers for the villages and pinned homes.
  useEffect(() => {
    const cluster = layer.current;
    cluster.clearLayers();
    const sel = new Set(selected?.ids ?? []);
    const markers = groups.map((g) => {
      const n = g.students.length;
      const size = g.exact ? 18 : Math.round(30 + Math.min(22, Math.sqrt(n) * 2.4));
      const html = g.exact ? `<span class="smap-home${sel.has(g.id) ? " is-on" : ""}"></span>` : `<span class="smap-pin tier-${tierOf(n)}${sel.has(g.id) ? " is-on" : ""}">${n}</span>`;
      const mk = L.marker([g.lat, g.lng], {
        icon: L.divIcon({ className: "smap-icon", html, iconSize: [size, size] }),
        count: n,
        groupId: g.id,
        title: `${g.name}: ${n} student${n === 1 ? "" : "s"}`,
        riseOnHover: true,
      });
      mk.on("click", () => cb.current.onSelect({ ids: [g.id] }));
      return mk;
    });
    cluster.addLayers(markers);
    // Show everyone (room for the filter buttons and legend), until the
    // user moves the map.
    points.current = groups.map((g) => [g.lat, g.lng]).concat(home ? [[home.lat, home.lng]] : []);
    if (!touched.current && points.current.length) {
      map.current.invalidateSize();
      const pts = points.current;
      if (pts.length > 1) map.current.fitBounds(L.latLngBounds(pts), { maxZoom: 13, paddingTopLeft: [50, 90], paddingBottomRight: [70, 70], animate: false });
      else map.current.setView(pts[0], 12, { animate: false });
    }
  }, [groups, selected, home]);

  // Fly to a village picked from the list.
  useEffect(() => {
    if (!selected?.fly) return;
    touched.current = true;
    const g = groups.find((x) => x.id === selected.ids[0]);
    if (g) map.current.flyTo([g.lat, g.lng], Math.max(map.current.getZoom(), 14), { duration: 0.6 });
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // The school: its logo beside the spot, and distance rings around it with
  // how many students live inside each.
  const rings = useRef([]);
  useEffect(() => {
    schoolMarker.current?.remove();
    rings.current.forEach((r) => r.remove());
    rings.current = [];
    if (!home) return;
    const name = school.name.replace(/[<>"&]/g, "");
    const logo = school.logo_path ? logoUrl(school.logo_path) : "";
    const badge = logo
      ? `<img src="${logo}" alt="" />`
      : `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>`;
    schoolMarker.current = L.marker([home.lat, home.lng], {
      icon: L.divIcon({ className: "smap-icon", html: `<span class="smap-school${logo ? " has-logo" : ""}" title="${name}">${badge}</span>`, iconSize: [44, 44], iconAnchor: [-14, 58] }),
      // Beside its spot and under the numbers, so a village at the school
      // (often the biggest) stays readable.
      zIndexOffset: -1000,
      interactive: false,
    }).addTo(map.current);
    const centre = L.circleMarker([home.lat, home.lng], { radius: 4, weight: 2, color: "#fff", fillColor: "#1d2366", fillOpacity: 1, interactive: false }).addTo(map.current);
    rings.current.push(centre);
    for (const km of [...RINGS].reverse()) {
      const inside = groups.reduce((t, g) => t + (kmBetween(home, g) <= km ? g.students.length : 0), 0);
      const circle = L.circle([home.lat, home.lng], {
        radius: km * 1000,
        color: "#1d2366",
        weight: 1.5,
        opacity: 0.55,
        dashArray: "6 6",
        fillColor: "#5b68c4",
        fillOpacity: 0.05,
        interactive: false,
      }).addTo(map.current);
      const label = L.marker([home.lat + km / 111, home.lng], {
        icon: L.divIcon({ className: "smap-icon", html: `<span class="smap-ring-label"><strong>${km} km</strong> ${inside}</span>`, iconSize: null }),
        interactive: false,
        zIndexOffset: -2000,
      }).addTo(map.current);
      rings.current.push(circle, label);
    }
  }, [home, school.name, school.logo_path, groups]);

  return <div ref={el} className="smap-leaflet" style={{ cursor: placing ? "crosshair" : undefined }} />;
}
