import { useEffect, useRef } from "react";

// Phones: swipe left or right anywhere on the page to move to the next or
// previous bottom tab, like Instagram. Only a clear sideways swipe counts
// (long enough, mostly flat, quick), and never one that starts on
// something that scrolls sideways or takes typing: photo strips, the map,
// tables, text boxes, the chat, menus and pop-ups keep their own swipes.
// The new page slides in from the side it came from (App.css, data-swipe).

const phone = () => window.matchMedia("(max-width: 760px)").matches;
const MIN_X = 70; // px across
const MAX_TILT = 0.6; // up/down at most 60% of across
const MAX_TIME = 600; // ms

const SKIP =
  'input, textarea, select, [contenteditable="true"], .leaflet-container, .no-swipe, .chat, .menu, .modal, [role="dialog"], [role="menu"], .fab.is-open';

// Started on something that scrolls sideways by itself?
function scrollsSideways(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 4) {
      const x = getComputedStyle(n).overflowX;
      if (x === "auto" || x === "scroll") return true;
    }
  }
  return false;
}

// keys: the tabs in order; current: the lit one; onGo(key): switch to it.
// enabled: false while a full-screen page (a profile, a chat) is open.
export function useSwipeTabs(keys, current, onGo, enabled = true) {
  const live = useRef({ keys, current, onGo, enabled });
  live.current = { keys, current, onGo, enabled };

  useEffect(() => {
    let start = null;
    const down = (e) => {
      start = null;
      if (e.touches.length !== 1 || !phone() || !live.current.enabled) return;
      const t = e.target;
      if (t.closest?.(SKIP) || document.querySelector('.modal, [role="dialog"]') || scrollsSideways(t)) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY, at: Date.now() };
    };
    const up = (e) => {
      if (!start) return;
      const dx = e.changedTouches[0].clientX - start.x;
      const dy = e.changedTouches[0].clientY - start.y;
      const quick = Date.now() - start.at <= MAX_TIME;
      start = null;
      if (!quick || Math.abs(dx) < MIN_X || Math.abs(dy) > Math.abs(dx) * MAX_TILT) return;
      if (window.getSelection?.().toString()) return;
      const { keys: list, current: now, onGo: go } = live.current;
      const i = list.indexOf(now);
      const next = list[i + (dx < 0 ? 1 : -1)];
      if (i < 0 || !next) return;
      // The new page comes in from the side the finger went to.
      document.documentElement.dataset.swipe = dx < 0 ? "left" : "right";
      setTimeout(() => delete document.documentElement.dataset.swipe, 320);
      go(next);
    };
    const cancel = () => (start = null);
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchend", up, { passive: true });
    window.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", cancel);
    };
  }, []);
}
