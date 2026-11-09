import { Fragment, useLayoutEffect, useRef } from "react";

// Pieces of Goddess's conversation shared by the assistant (Concierge.jsx)
// and the landing page's hero: her words appearing as she says them, the
// speaking bars, and the cards gliding between the grid and the stack.
// The look is in concierge.css (cv-*).

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Her words appear about as fast as she says them.
const CHARS_PER_S = 15;
export const readTime = (text) => String(text ?? "").length / CHARS_PER_S;

export function SpokenWords({ text }) {
  let at = 0;
  return String(text ?? "")
    .split(" ")
    .map((w, i) => {
      const t = at / CHARS_PER_S;
      at += w.length + 1;
      return (
        <Fragment key={i}>
          <span className="cv-word" style={{ "--t": `${t.toFixed(2)}s` }}>
            {w}
          </span>{" "}
        </Fragment>
      );
    });
}

export const Bars = () => (
  <span className="cg-bars cv-ask-bars" aria-hidden="true">
    <i />
    <i />
    <i />
    <i />
    <i />
  </span>
);

const GLIDE = "transform 0.6s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.4s ease, background 0.2s ease";

// The cards glide between the grid and the stack (FLIP). Call the returned
// mark() just before the change; when `key` changes, each card (by its
// data-k) starts from where it was and glides to its new place. A card
// that wasn't there before keeps its own entrance.
// sinkTo (optional) returns an element: a card hidden by the change
// shrinks into it, and one shown again grows back out of it.
export function useGlide(ref, sinkTo, key) {
  if (key === undefined) [sinkTo, key] = [null, sinkTo];
  const from = useRef(null);
  useLayoutEffect(() => {
    const before = from.current;
    from.current = null;
    if (!before || !ref.current) return;
    const now = sinkTo?.()?.getBoundingClientRect();
    const spot = now?.width ? now : before.spot;
    const centre = (r) => [r.left + r.width / 2, r.top + r.height / 2];
    for (const c of ref.current.children) {
      const b = before.cards.get(c.dataset.k);
      if (!b) continue;
      c.style.transition = "none";
      c.style.transform = "";
      const end = c.getBoundingClientRect();
      const was = b.rect.width > 0;
      const is = end.width > 0;
      if (was && !is) {
        // Hidden now: a copy of how it looked shrinks into the spot.
        if (spot) sink(b.copy, b.rect, spot, ref.current.closest(".cg") ?? document.body);
        c.style.transition = "";
        continue;
      }
      if (!was && is) {
        // Shown again: grows back out of the spot.
        if (spot) {
          const [sx, sy] = centre(spot);
          const [ex, ey] = centre(end);
          c.style.transition = "";
          c.animate(
            [
              { transform: `translate(${sx - ex}px, ${sy - ey}px) scale(0.15)`, opacity: 0 },
              { transform: getComputedStyle(c).transform === "none" ? "none" : getComputedStyle(c).transform, opacity: 1 },
            ],
            { duration: 600, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
          );
        } else c.style.transition = "";
        continue;
      }
      if (!is) {
        c.style.transition = "";
        continue;
      }
      const rest = getComputedStyle(c).transform;
      const dx = b.rect.left - end.left;
      const dy = b.rect.top - end.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
        c.style.transition = "";
        continue;
      }
      c.style.transform = `translate(${dx}px, ${dy}px) ${rest === "none" ? "" : rest}`;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          c.style.transition = GLIDE;
          c.style.transform = "";
          c.addEventListener("transitionend", () => (c.style.transition = ""), { once: true });
        })
      );
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return () => {
    if (!ref.current || reducedMotion()) return;
    const spot = sinkTo?.()?.getBoundingClientRect();
    from.current = {
      spot: spot?.width ? spot : null,
      cards: new Map(
        [...ref.current.children].map((c) => {
          const rect = c.getBoundingClientRect();
          return [c.dataset.k, { rect, copy: rect.width ? c.cloneNode(true) : null }];
        })
      ),
    };
  };
}

function sink(copy, rect, spot, host) {
  if (!copy) return;
  Object.assign(copy.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    zIndex: "5",
    pointerEvents: "none",
    transition: "none",
    transform: "none",
  });
  copy.removeAttribute("data-k");
  copy.setAttribute("aria-hidden", "true");
  host.appendChild(copy);
  const dx = spot.left + spot.width / 2 - (rect.left + rect.width / 2);
  const dy = spot.top + spot.height / 2 - (rect.top + rect.height / 2);
  const run = copy.animate(
    [
      { transform: "none", opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.15)`, opacity: 0 },
    ],
    { duration: 650, easing: "cubic-bezier(0.55, 0, 0.25, 1)", fill: "forwards" }
  );
  run.onfinish = () => copy.remove();
}
