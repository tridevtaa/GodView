import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
    // A finished drag: the new order, saved once
    setOrder(list, shownSizes) {
      save({ ...base(shownSizes), order: [...list, ...visible.filter((k) => !list.includes(k))] });
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
const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function EditableHome({ layout, items }) {
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  // While dragging: the order as it's being arranged (saved on drop)
  const [dragKey, setDragKey] = useState(null);
  const [dragOrder, setDragOrder] = useState(null);
  const gridRef = useRef(null);
  const press = useRef(null); // { timer, x, y } while a press may become a long-press
  const swallow = useRef(false); // the click that ends a long-press or a drag
  // Ignore the tap that ends a long-press or drag, but only that one: a
  // moment after the finger lifts, taps work again
  const releaseSoon = () => setTimeout(() => (swallow.current = false), 350);
  const drag = useRef(null); // the pointer while a widget may be or is being dragged
  const orderRef = useRef([]);
  const positions = useRef(new Map()); // where each widget sat, to slide it from there

  const shown = layout.visible.filter((k) => items[k]);
  const order = dragOrder ?? shown;
  orderRef.current = order;
  const sizeOf = (key) => layout.sizes[key] ?? items[key].size ?? (items[key].kind === "section" ? "full" : "small");
  const shownSizes = Object.fromEntries(shown.map((k) => [k, sizeOf(k)]));
  const offItems = layout.off.filter((k) => items[k]);
  const latest = useRef(null);
  latest.current = { shown, shownSizes, layout };

  // Esc or Done leaves edit mode
  useEffect(() => {
    if (!editing) return;
    const onKey = (e) => e.key === "Escape" && !adding && setEditing(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, adding]);

  const blockAt = (key) => gridRef.current?.querySelector(`[data-wkey="${CSS.escape(key)}"]`);

  // The dragged widget follows the finger: its place in the grid, plus
  // how far the finger has gone from where it picked the widget up.
  const place = () => {
    const d = drag.current;
    const el = d?.started && blockAt(d.key);
    if (!el) return;
    const g = gridRef.current.getBoundingClientRect();
    el.style.translate = `${d.x - d.grabX - (g.left + el.offsetLeft)}px ${d.y - d.grabY - (g.top + el.offsetTop)}px`;
  };

  // Under the finger: another widget? Go before it (its first half) or
  // after it. Rows across the whole grid split top and bottom, the rest
  // left and right. The dragged one is left out, so nothing flips back.
  const reorder = () => {
    const d = drag.current;
    const grid = gridRef.current;
    if (!d?.started || !grid) return;
    const g = grid.getBoundingClientRect();
    const others = orderRef.current.filter((k) => k !== d.key);
    for (const k of others) {
      const el = blockAt(k);
      if (!el || !el.offsetWidth) continue;
      const left = g.left + el.offsetLeft;
      const top = g.top + el.offsetTop;
      if (d.x < left || d.x > left + el.offsetWidth || d.y < top || d.y > top + el.offsetHeight) continue;
      const fullRow = el.offsetWidth > grid.clientWidth * 0.9;
      const after = fullRow ? d.y > top + el.offsetHeight / 2 : d.x > left + el.offsetWidth / 2;
      const list = [...others];
      list.splice(others.indexOf(k) + (after ? 1 : 0), 0, d.key);
      if (list.join() !== orderRef.current.join()) setDragOrder(list);
      return;
    }
  };

  // Others slide to their new places (and the dropped one settles)
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const moved = new Map();
    for (const el of grid.children) {
      const key = el.dataset.wkey;
      const pos = { x: el.offsetLeft, y: el.offsetTop };
      moved.set(key, pos);
      const was = positions.current.get(key);
      if (editing && was && key !== dragKey && (was.x !== pos.x || was.y !== pos.y) && !reducedMotion()) {
        el.animate([{ translate: `${was.x - pos.x}px ${was.y - pos.y}px` }, { translate: "0 0" }], { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
      }
    }
    positions.current = moved;
    place();
  });

  // Near the top or bottom of the screen while dragging: scroll
  useEffect(() => {
    if (!dragKey) return;
    let raf;
    const tick = () => {
      const d = drag.current;
      if (d?.started) {
        const edge = 90;
        const by = d.y < edge ? -Math.min(18, (edge - d.y) / 4) : d.y > innerHeight - edge ? Math.min(18, (d.y - innerHeight + edge) / 4) : 0;
        if (by) {
          window.scrollBy(0, by);
          reorder();
          place();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  // Touch: once a drag is on, the page mustn't scroll under the finger
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || !editing) return;
    const stop = (e) => drag.current?.armed && e.cancelable && e.preventDefault();
    grid.addEventListener("touchmove", stop, { passive: false });
    return () => grid.removeEventListener("touchmove", stop);
  }, [editing]);

  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };

  const onPointerDown = (key) => (e) => {
    if (e.button > 0 || e.target.closest(".hw-ctl")) return;
    if (editing) {
      // Mouse: drag right away. Touch: hold a moment first, so a quick
      // swipe still scrolls the page.
      const r = e.currentTarget.getBoundingClientRect();
      const d = { key, id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, grabX: e.clientX - r.left, grabY: e.clientY - r.top, armed: e.pointerType === "mouse", started: false };
      if (!d.armed) {
        d.timer = setTimeout(() => {
          d.armed = true;
          navigator.vibrate?.(8);
        }, 160);
      }
      drag.current = d;
      // Followed on the window: moving widgets around in the page would
      // otherwise lose the finger mid-drag
      const move = (ev) => onDragMove(ev);
      const up = (ev) => {
        if (ev.pointerId !== d.id) return;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        endDrag();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      return;
    }
    cancelPress();
    press.current = {
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        press.current = null;
        swallow.current = true; // until the finger lifts (onPointerUpCapture)
        navigator.vibrate?.(12);
        window.getSelection?.()?.removeAllRanges();
        setEditing(true);
      }, 520),
    };
  };

  // Before edit mode: a press that moves is a scroll, not a long-press
  const onPointerMove = (e) => {
    if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10) cancelPress();
  };

  const onDragMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    d.x = e.clientX;
    d.y = e.clientY;
    const far = Math.hypot(d.x - d.sx, d.y - d.sy);
    if (!d.armed) {
      // Moved before the hold: it's a scroll, not a drag
      if (far > 8) {
        clearTimeout(d.timer);
        drag.current = null;
      }
      return;
    }
    if (!d.started) {
      if (far < 4) return;
      d.started = true;
      setDragKey(d.key);
      setDragOrder(orderRef.current);
    }
    reorder();
    place();
  };

  const endDrag = () => {
    const d = drag.current;
    if (!d) return;
    clearTimeout(d.timer);
    drag.current = null;
    if (!d.started) return;
    swallow.current = true;
    releaseSoon();
    // Settle into its place from where it was let go
    const el = blockAt(d.key);
    if (el) {
      const from = el.style.translate;
      el.style.translate = "";
      if (from && !reducedMotion()) el.animate([{ translate: from }, { translate: "0 0" }], { duration: 200, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    }
    const final = orderRef.current;
    const now = latest.current;
    setDragKey(null);
    setDragOrder(null);
    if (final.join() !== now.shown.join()) now.layout.setOrder(final, now.shownSizes);
  };

  // While editing (and right after a long-press or a drag), taps don't
  // open widgets
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

  return (
    <div className={`hw-board${editing ? " is-editing" : ""}${dragKey ? " is-dragging-one" : ""}`} onClickCapture={onClickCapture} onPointerUpCapture={() => swallow.current && releaseSoon()} onContextMenu={(e) => (editing || press.current) && e.preventDefault()}>
      {editing && (
        <div className="hw-editbar">
          <button type="button" className="btn btn-secondary btn-sm hw-ctl" onClick={() => setAdding(true)}>
            <Icon name="plus" /> Add widget
          </button>
          <span className="hw-editbar-hint">Hold and drag to move</span>
          <button type="button" className="btn btn-primary btn-sm hw-ctl" onClick={() => setEditing(false)}>
            Done
          </button>
        </div>
      )}

      <div className="hw-board-grid" ref={gridRef}>
        {order.map((key, i) => {
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
              onPointerUp={cancelPress}
              onPointerCancel={cancelPress}
            >
              {it.kind === "tile" ? <Tile {...it.tile} big={size === "wide"} sub={size === "wide" ? it.tile.sub : null} index={i} /> : it.node}
              {editing && !dragKey && (
                <button type="button" className="hw-ctl hw-remove" onClick={() => layout.hide(key, shownSizes)} aria-label={`Remove ${it.label}`} title={`Remove ${it.label}`}>
                  <span aria-hidden="true">−</span>
                </button>
              )}
              {editing && !dragKey && next && (
                <button type="button" className="hw-ctl hw-resize" onClick={() => layout.resize(key, next, shownSizes)}>
                  {it.kind === "tile" ? SIZE_WORD[size] : SECTION_WORD[size]}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {!editing && (
        <button type="button" className="link-btn hw-edit-link hw-ctl" onClick={() => setEditing(true)}>
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
