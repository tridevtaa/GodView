import { useEffect, useRef } from "react";
import { primeVoice } from "../components/voicePlayer.js";
import { haptic } from "./haptics.js";

// Phones: Goddess sits above Home. Pull down at the top of Home and her page
// comes down with the finger; push up on her page and Home shows underneath.
// Far enough, or a quick flick, finishes the move; otherwise it slides back.
// Positions are written straight to the page each frame, not through React,
// so the move stays on the graphics card and keeps up with the finger.

const FAR = 0.28; // of the screen's height
const FLICK = 0.5; // px per ms
const FLICK_MIN = 48; // px
const START = 8; // px before a pull counts
const SCRIM = 0.5;
const EASE = "cubic-bezier(0.2, 0.85, 0.25, 1)";

const phone = () => window.matchMedia("(max-width: 760px)").matches;
const stillMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const TYPING = 'input, textarea, select, [contenteditable="true"]';
const HOME_SKIP = `${TYPING}, .leaflet-container, .no-swipe, .chat, .menu, .fab`;
const COVERED = '.modal-backdrop, .modal, [role="dialog"], .menu, .fab.is-open, .hw-board.is-editing';

// Something inside that would scroll this way itself
function scrollsItself(el, down) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const y = getComputedStyle(n).overflowY;
    if ((y !== "auto" && y !== "scroll") || n.scrollHeight <= n.clientHeight + 1) continue;
    if (down ? n.scrollTop > 0 : n.scrollTop + n.clientHeight < n.scrollHeight - 1) return true;
  }
  return false;
}

// enabled: this person has the assistant. atHome: Home is showing. open: her
// page is open. onPeek(true/false): show or drop her page while it's pulled.
// onOpen: pulled all the way down. onLeaveStart: Home must be underneath now.
// onLeave: pushed all the way up.
export function useGoddessSwipe({ enabled, atHome, open, onPeek, onOpen, onLeaveStart, onLeave }) {
  const live = useRef(null);
  live.current = { enabled, atHome, open, onPeek, onOpen, onLeaveStart, onLeave };

  // Home's pull is ours: not the browser's pull to refresh, not its bounce
  const pullable = enabled && atHome && !open;
  useEffect(() => {
    document.documentElement.classList.toggle("cg-pull", pullable);
    return () => document.documentElement.classList.remove("cg-pull");
  }, [pullable]);

  useEffect(() => {
    let g = null; // the gesture under way
    let settling = false;
    let frame = 0;

    const paint = () => {
      frame = 0;
      if (!g?.dragging) return;
      const el = document.querySelector(".cg");
      if (!el) {
        // Her page is still coming: its first frame is off screen
        frame = requestAnimationFrame(paint);
        return;
      }
      if (!g.el) {
        g.el = el;
        el.style.transition = "none";
        el.classList.add("is-dragging");
      }
      const at = g.opening ? Math.min(g.moved, g.height) - g.height : Math.min(0, -g.moved);
      el.style.transform = `translate3d(0, ${at}px, 0)`;
      const shown = Math.min(1, g.moved / g.height);
      g.scrim.style.opacity = String(SCRIM * (g.opening ? shown : 1 - shown));
    };
    const repaint = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };

    const beginDrag = () => {
      g.dragging = true;
      g.scrim = document.createElement("div");
      g.scrim.className = "cg-scrim";
      document.body.append(g.scrim);
      if (g.opening) live.current.onPeek(true);
      else live.current.onLeaveStart();
    };

    const down = (e) => {
      g = null;
      const { enabled: on, atHome: home, open: isOpen } = live.current;
      if (settling || !on || e.touches.length !== 1 || !phone()) return;
      const t = e.target;
      const touch = e.touches[0];
      if (isOpen) {
        if (t.closest?.(TYPING) || document.activeElement?.closest?.(TYPING) || scrollsItself(t, false)) return;
      } else {
        // The very top edge belongs to the phone's own notifications
        if (!home || window.scrollY > 0 || touch.clientY < 16 || t.closest?.(HOME_SKIP) || document.querySelector(COVERED) || scrollsItself(t, true)) return;
      }
      g = { opening: !isOpen, x: touch.clientX, y: touch.clientY, moved: 0, height: window.innerHeight, samples: [], dragging: false, far: false, el: null, scrim: null };
    };

    const move = (e) => {
      if (!g) return;
      const touch = e.touches[0];
      const dx = touch.clientX - g.x;
      const dy = touch.clientY - g.y;
      if (!g.dragging) {
        if (!dx && !dy) return;
        // Sideways, or the other way: not ours, the page or a strip scrolls
        if (Math.abs(dx) > Math.abs(dy) || (g.opening ? dy <= 0 : dy >= 0) || (g.opening && document.querySelector(COVERED))) {
          g = null;
          return;
        }
        if (e.cancelable) e.preventDefault();
        if (Math.abs(dy) < START) return;
        // Starts here, so the page doesn't jump by what it took to tell
        g.y = touch.clientY;
        beginDrag();
        repaint();
        return;
      }
      if (e.cancelable) e.preventDefault();
      g.moved = Math.max(0, g.opening ? touch.clientY - g.y : g.y - touch.clientY);
      const now = performance.now();
      g.samples.push([now, g.moved]);
      while (g.samples.length > 2 && now - g.samples[0][0] > 90) g.samples.shift();
      const far = g.moved >= g.height * FAR;
      if (far && !g.far) haptic("select");
      g.far = far;
      repaint();
    };

    // How fast the finger was going as it let go; against the move is negative
    const speedOf = (gesture) => {
      const first = gesture.samples[0];
      const last = gesture.samples[gesture.samples.length - 1];
      return first && last && last[0] > first[0] ? (last[1] - first[1]) / (last[0] - first[0]) : 0;
    };

    const settle = (gesture, commit) => {
      cancelAnimationFrame(frame);
      frame = 0;
      settling = true;
      const { opening, height, el, scrim } = gesture;
      let over = false;
      const done = () => {
        if (over) return;
        over = true;
        settling = false;
        scrim.remove();
        const { onPeek, onOpen, onLeave } = live.current;
        if (opening && !commit) return onPeek(false);
        if (!opening && commit) return onLeave();
        // Stays explicit: her page's off-screen starting place goes on the next render
        if (el) {
          el.style.transition = "";
          el.style.transform = "none";
          el.classList.remove("is-dragging");
        }
        if (opening) onOpen();
      };
      const place = opening ? (commit ? 0 : -height) : commit ? -height : 0;
      const left = commit ? height - gesture.moved : gesture.moved;
      const ms = stillMotion() || !el ? 0 : Math.round(Math.min(420, Math.max(180, left / Math.max(speedOf(gesture), 1.6))));
      if (!ms) return done();
      el.style.transition = `transform ${ms}ms ${EASE}`;
      scrim.style.transition = `opacity ${ms}ms ${EASE}`;
      // Forces the current position first, so the move always animates
      void el.offsetHeight;
      el.style.transform = `translate3d(0, ${place}px, 0)`;
      scrim.style.opacity = String(opening === commit ? SCRIM : 0);
      el.addEventListener("transitionend", done, { once: true });
      setTimeout(done, ms + 80);
    };

    const up = () => {
      const gesture = g;
      g = null;
      if (!gesture?.dragging) return;
      const speed = speedOf(gesture);
      const commit = speed > -0.2 && (gesture.moved >= gesture.height * FAR || (speed >= FLICK && gesture.moved >= FLICK_MIN));
      // Letting go is a tap as far as phones go: her greeting can be heard
      if (commit && gesture.opening) primeVoice();
      settle(gesture, commit);
    };
    const cancel = () => {
      const gesture = g;
      g = null;
      if (gesture?.dragging) settle(gesture, false);
    };

    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up, { passive: true });
    window.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", cancel);
    };
  }, []);
}
