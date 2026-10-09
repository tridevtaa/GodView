import { useEffect, useRef, useState } from "react";
import { MAP_ID, addressParts, hasMaps, loadMaps, mapsLink } from "../data/maps.js";
import Icon from "./Icon.jsx";

// Search a place on Google Maps and pin it. value: { address, name, lat, lng,
// place_id, city, state } or null. The pin can be dragged to the exact spot.
export default function PlacePicker({ value, onChange, placeholder = "Search village, town or address", label = "Location" }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState("");
  const token = useRef(null);
  const timer = useRef(null);
  const places = useRef(null);
  const pinned = value && value.lat != null && value.lng != null;

  useEffect(() => () => clearTimeout(timer.current), []);

  async function search(text) {
    if (!text.trim()) {
      setItems([]);
      return;
    }
    try {
      await loadMaps();
      places.current ??= await window.google.maps.importLibrary("places");
      const { AutocompleteSuggestion, AutocompleteSessionToken } = places.current;
      token.current ??= new AutocompleteSessionToken();
      const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: text,
        sessionToken: token.current,
        includedRegionCodes: ["in"],
      });
      setItems(suggestions.map((s) => s.placePrediction).filter(Boolean).slice(0, 6));
      setActive(0);
      setError("");
    } catch (err) {
      setItems([]);
      setError(
        err.message === "key-rejected"
          ? "Google Maps didn’t accept the key for this site. Check the key’s website restrictions."
          : "Couldn’t reach Google Maps. Check your connection."
      );
    }
  }

  function onType(e) {
    const text = e.target.value;
    setQuery(text);
    setOpen(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => search(text), 250);
  }

  async function pick(prediction) {
    setOpen(false);
    setQuery("");
    setItems([]);
    try {
      const place = prediction.toPlace();
      await place.fetchFields({ fields: ["id", "displayName", "formattedAddress", "location", "addressComponents"] });
      token.current = null; // a pick ends the search session
      onChange({
        name: place.displayName,
        address: place.formattedAddress,
        place_id: place.id,
        lat: place.location.lat(),
        lng: place.location.lng(),
        ...addressParts(place.addressComponents),
      });
    } catch {
      setError("Couldn’t load that place. Try again.");
    }
  }

  function onKey(e) {
    if (!open || !items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // Without a key, fall back to a plain address box.
  if (!hasMaps) {
    return (
      <div className="place">
        <input
          className="place-input"
          placeholder="Address"
          value={value?.address ?? ""}
          onChange={(e) => onChange({ ...(value ?? {}), address: e.target.value })}
          aria-label={label}
        />
        <p className="row-sub place-note">Map search turns on once the Google Maps key is added.</p>
      </div>
    );
  }

  return (
    <div className="place">
      {pinned ? (
        <div className="place-chosen">
          <span className="place-pin">
            <Icon name="pin" size={16} />
          </span>
          <span className="place-text">
            <strong>{value.name || value.address}</strong>
            {value.name && value.address && value.address !== value.name && <span className="row-sub">{value.address}</span>}
          </span>
          <a className="link-btn" href={mapsLink(value.lat, value.lng)} target="_blank" rel="noreferrer">
            Open map
          </a>
          <button type="button" className="link-btn" onClick={() => onChange(null)}>
            Change
          </button>
        </div>
      ) : (
        <div className="place-search">
          <Icon name="search" />
          <input
            className="place-input"
            placeholder={placeholder}
            value={query}
            onChange={onType}
            onKeyDown={onKey}
            onFocus={() => query && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            aria-label={label}
            aria-autocomplete="list"
            aria-expanded={open && items.length > 0}
            autoComplete="off"
          />
          {open && items.length > 0 && (
            <ul className="place-menu" role="listbox">
              {items.map((p, i) => (
                <li key={p.placeId}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    className={i === active ? "is-active" : ""}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(p)}
                  >
                    <Icon name="pin" size={15} />
                    <span>
                      <strong>{p.mainText?.toString() ?? p.text.toString()}</strong>
                      {p.secondaryText && <span className="row-sub">{p.secondaryText.toString()}</span>}
                    </span>
                  </button>
                </li>
              ))}
              <li className="place-credit">Powered by Google</li>
            </ul>
          )}
        </div>
      )}
      {error && <p className="field-error">{error}</p>}
      {pinned && <PinMap value={value} onMove={(lat, lng) => onChange({ ...value, lat, lng })} />}
    </div>
  );
}

// Small map with a draggable pin to fine-tune the spot.
export function PinMap({ value, onMove, height = 200 }) {
  const el = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const moveRef = useRef(onMove);
  moveRef.current = onMove;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadMaps();
      const { Map } = await window.google.maps.importLibrary("maps");
      const { AdvancedMarkerElement } = await window.google.maps.importLibrary("marker");
      if (cancelled || !el.current) return;
      const center = { lat: value.lat, lng: value.lng };
      if (!map.current) {
        map.current = new Map(el.current, {
          center,
          zoom: 16,
          mapId: MAP_ID,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "cooperative",
        });
        marker.current = new AdvancedMarkerElement({ map: map.current, position: center, gmpDraggable: Boolean(onMove) });
        marker.current.addListener("dragend", () => {
          const p = marker.current.position;
          moveRef.current?.(typeof p.lat === "function" ? p.lat() : p.lat, typeof p.lng === "function" ? p.lng() : p.lng);
        });
      } else {
        marker.current.position = center;
        map.current.panTo(center);
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [value.lat, value.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="place-map-wrap">
      <div ref={el} className="place-map" style={{ height }} />
      {onMove && <span className="place-map-hint">Drag the pin to the exact spot</span>}
    </div>
  );
}
