import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { Tile } from "./Widgets.jsx";
import { loadHomeLayout, saveHomeLayout } from "../data/homeLayout.js";

// Home's widgets, arranged by each person like an iPhone home screen:
// long-press any widget (or tap Edit Home) and they wiggle; drag to
// reorder, the minus removes one, the pill makes a tile wider or smaller,
// + Add widget brings one back. Saved to the person's account, so it
// follows them across devices, with a copy in the browser for a quick start.
//
// Sizes: tiles are small (one column) or wide (two); sections are wide
// (half the row on computers) or full. Phones have two columns, so wide
// and full look the same there.

const read = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? null;
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {
    // Private mode or storage off: the layout just isn't kept
  }
};

// meta: [{ key, defaultOn }] for every widget this person could have.
// Returns which show (in order), which are off, and how to change them.
export function useHomeLayout(storeKey, meta) {
  const [saved, setSaved] = useState(() => read(storeKey));
  const upload = useRef(null);

  // The account's copy wins when it's newer (changed on another device);
  // a layout only this browser has is sent up. Checked again on return
  // to the app.
  useEffect(() => {
    setSaved(read(storeKey));
    let live = true;
    const sync = () =>
      loadHomeLayout(storeKey).then(
        (row) => {
          if (!live) return;
          const local = read(storeKey);
          if (row?.layout && (!local || (row.layout.at ?? 0) > (local.at ?? 0))) {
            write(storeKey, row.layout);
            setSaved(row.layout);
          } else if (!row && local) {
            saveHomeLayout(storeKey, local).catch(() => {});
          }
        },
        () => {} // offline, or not set up yet: the browser copy does
      );
    sync();
    const onShow = () => document.visibilityState === "visible" && sync();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [storeKey]);
  // Send the last change when leaving
  useEffect(() => () => upload.current?.flush(), [storeKey]);

  const keys = meta.map((m) => m.key);
  const present = new Set(keys);
  const order = saved?.order ?? [];
  const hidden = new Set(saved?.hidden ?? []);
  const known = new Set([...order, ...hidden]);
  // Saved order first, then anything new that shows by default
  const visible = [...order.filter((k) => present.has(k) && !hidden.has(k)), ...meta.filter((m) => !known.has(m.key) && m.defaultOn !== false).map((m) => m.key)];
  const off = keys.filter((k) => !visible.includes(k));
  const sizes = saved?.sizes ?? {};

  const save = (change) => {
    const next = change && { ...change, at: Date.now() };
    setSaved(next);
    write(storeKey, next);
    // A drag makes many small moves: send the last one, shortly after
    clearTimeout(upload.current?.timer);
    const send = () => {
      clearTimeout(upload.current?.timer);
      upload.current = null;
      saveHomeLayout(storeKey, next).catch(() => {});
    };
    upload.current = { timer: setTimeout(send, 800), flush: send };
  };
  // shownSizes: the sizes as they look now, kept with the first change so
  // nothing resizes on its own once someone has arranged Home
  const base = (shownSizes) => ({ order: visible, hidden: [...hidden], sizes: { ...shownSizes, ...sizes } });
  return {
    visible,
    off,
    sizes,
    custom: Boolean(saved),
    move(key, to, shownSizes) {
      const list = visible.filter((k) => k !== key);
      list.splice(to, 0, key);
      save({ ...base(shownSizes), order: list });
    },
    hide(key, shownSizes) {
      save({ ...base(shownSizes), order: visible.filter((k) => k !== key), hidden: [...hidden, key] });
    },
    show(key, shownSizes) {
      // New widgets go on top, like the iPhone
      save({ ...base(shownSizes), order: [key, ...visible], hidden: [...hidden].filter((k) => k !== key) });
    },
    resize(key, size, shownSizes) {
      const b = base(shownSizes);
      save({ ...b, sizes: { ...b.sizes, [key]: size } });
    },
    reset() {
      save(null);
    },
  };
}

const NEXT_SIZE = { tile: { small: "wide", wide: "small" }, section: { wide: "full", full: "wide" } };
const SIZE_WORD = { small: "Wider", wide: "Smaller", full: "Half width" };
const SECTION_WORD = { wide: "Full width", full: "Half width" };

// items: { [key]: { label, icon, tone, kind: "tile" | "section", size,
// tile (Tile's props) or node (the section), phoneHidden } }
export default function EditableHome({ layout, items }) {
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [dragKey, setDragKey] = useState(null);
  const press = useRef(null); // { timer, x, y } while a press may become a long-press
  const swallow = useRef(false); // the click that ends a long-press

  // Esc or Done leaves edit mode
  useEffect(() => {
    if (!editing) return;
    const onKey = (e) => e.key === "Escape" && !adding && setEditing(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, adding]);

  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };

  const onPointerDown = (key) => (e) => {
    if (e.button > 0 || e.target.closest(".hw-ctl")) return;
    if (editing) {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDragKey(key);
      return;
    }
    cancelPress();
    press.current = {
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        press.current = null;
        swallow.current = true;
        navigator.vibrate?.(12);
        setEditing(true);
      }, 520),
    };
  };
  const onPointerMove = (e) => {
    if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10) cancelPress();
    if (!dragKey) return;
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-wkey]");
    const target = over?.dataset.wkey;
    if (target && target !== dragKey) layout.move(dragKey, layout.visible.indexOf(target), shownSizes);
  };
  const endPointer = () => {
    cancelPress();
    setDragKey(null);
  };

  // While editing (and right after a long-press), taps don't open widgets
  const onClickCapture = useCallback(
    (e) => {
      if (e.target.closest(".hw-ctl, .modal-backdrop")) return;
      if (editing || swallow.current) {
        e.preventDefault();
        e.stopPropagation();
        swallow.current = false;
      }
    },
    [editing]
  );

  const shown = layout.visible.filter((k) => items[k]);
  const sizeOf = (key) => layout.sizes[key] ?? items[key].size ?? (items[key].kind === "section" ? "full" : "small");
  const shownSizes = Object.fromEntries(shown.map((k) => [k, sizeOf(k)]));
  const offItems = layout.off.filter((k) => items[k]);

  return (
    <div className={`hw-board${editing ? " is-editing" : ""}`} onClickCapture={onClickCapture} onContextMenu={(e) => editing && e.preventDefault()}>
      {editing && (
        <div className="hw-editbar">
          <button type="button" className="btn btn-secondary btn-sm hw-ctl" onClick={() => setAdding(true)}>
            <Icon name="plus" /> Add widget
          </button>
          <span className="hw-editbar-hint">Drag to move</span>
          <button type="button" className="btn btn-primary btn-sm hw-ctl" onClick={() => setEditing(false)}>
            Done
          </button>
        </div>
      )}

      <div className="hw-board-grid">
        {shown.map((key, i) => {
          const it = items[key];
          const size = sizeOf(key);
          const next = NEXT_SIZE[it.kind]?.[size];
          return (
            <div
              key={key}
              data-wkey={key}
              className={`hw-block is-${it.kind} size-${size}${it.phoneHidden ? " hide-phone" : ""}${dragKey === key ? " is-dragging" : ""}`}
              style={{ "--j": `${(i % 3) * -0.11}s` }}
              onPointerDown={onPointerDown(key)}
              onPointerMove={onPointerMove}
              onPointerUp={endPointer}
              onPointerCancel={endPointer}
            >
              {it.kind === "tile" ? <Tile {...it.tile} big={size === "wide"} sub={size === "wide" ? it.tile.sub : null} index={i} /> : it.node}
              {editing && (
                <button type="button" className="hw-ctl hw-remove" onClick={() => layout.hide(key, shownSizes)} aria-label={`Remove ${it.label}`} title={`Remove ${it.label}`}>
                  <span aria-hidden="true">−</span>
                </button>
              )}
              {editing && next && (
                <button type="button" className="hw-ctl hw-resize" onClick={() => layout.resize(key, next, shownSizes)}>
                  {it.kind === "tile" ? SIZE_WORD[size] : SECTION_WORD[size]}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {!editing && (
        <button type="button" className="link-btn hw-edit-link" onClick={() => setEditing(true)}>
          <Icon name="edit" size={14} /> Edit Home
        </button>
      )}

      {adding && (
        <div className="modal-backdrop" onClick={() => setAdding(false)}>
          <section className="modal hw-sheet" role="dialog" aria-modal="true" aria-label="Add a widget" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add a widget</h2>
              <button className="btn-icon" onClick={() => setAdding(false)} aria-label="Close">
                <Icon name="x" size={18} />
              </button>
            </div>
            <div className="modal-body">
              {offItems.length === 0 ? (
                <p className="row-sub">Everything is already on your Home.</p>
              ) : (
                <ul className="hw-add-list">
                  {offItems.map((key) => (
                    <li key={key}>
                      <span className={`hw-add-icon t-${items[key].tone ?? "indigo"}`}>
                        <Icon name={items[key].icon} size={20} weight="fill" />
                      </span>
                      <strong>{items[key].label}</strong>
                      <button type="button" className="btn btn-secondary btn-sm hw-ctl" onClick={() => layout.show(key, shownSizes)}>
                        <Icon name="plus" /> Add
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {layout.custom && (
                <button
                  type="button"
                  className="link-btn hw-reset hw-ctl"
                  onClick={() => {
                    layout.reset();
                    setAdding(false);
                  }}
                >
                  Reset Home to how it was
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
