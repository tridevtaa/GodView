import { useEffect } from "react";

// The landing hero's scroll scene: scrolling down, the camera comes down
// from Goddess to the laptop on the table in front of her (a clip from
// Flow, as 72 still frames in /landing/laptop/), then Godview's Home
// screen turns onto the laptop's screen and comes forward.
//
// The hero sits pinned in a tall track (.lp-hero-track); how far through
// the track you are (t, 0 to 1) picks the frame and drives the rest:
//   0.01-0.08  her questions fade away; the frames take over from her clip
//   0.05-0.72  the camera move (frame 0 to the last)
//   0.68-0.82  the Home screen turns onto the laptop's screen
//   0.80-0.97  it comes forward; the caption fades in above it
// Frames are drawn on a canvas (smooth on phones, unlike seeking a video).
// Phones start on her (the hero's crop) and end with the laptop's screen
// fitting the width; where the frame no longer fills the screen, a blurred
// copy behind it does.

export const FRAMES = 72;
const SRC = "/landing/laptop/";
const W = 1280;
const H = 720;
// The laptop's screen in the frames (px at 1280 wide), from the last frame.
const SCREEN = { x: 445, y: 288, w: 397, h: 247 };
const SX = SCREEN.x + SCREEN.w / 2;
const SY = SCREEN.y + SCREEN.h / 2;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const ease = (v) => v * v * (3 - 2 * v);
const lerp = (a, b, v) => a + (b - a) * v;

const frameUrl = (i) => `${SRC}${String(i).padStart(3, "0")}.jpg`;

// Loads the frames: the first, then every 8th, 4th, 2nd and the rest, so
// the move can be scrubbed roughly at once and fills in.
function loader(onLoad) {
  const imgs = new Array(FRAMES).fill(null);
  let started = false;
  const order = [];
  for (const step of [FRAMES, 8, 4, 2, 1]) for (let i = 0; i < FRAMES; i += step) if (!order.includes(i)) order.push(i);
  order.push(FRAMES - 1);
  const start = () => {
    if (started) return;
    started = true;
    let next = 0;
    const pull = () => {
      while (next < order.length && imgs[order[next]]) next++;
      if (next >= order.length) return;
      const i = order[next++];
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        imgs[i] = img;
        onLoad(i);
        pull();
      };
      img.onerror = pull;
      img.src = frameUrl(i);
    };
    // A few at a time
    pull();
    pull();
    pull();
  };
  // The nearest loaded frame to i
  const near = (i) => {
    for (let d = 0; d < FRAMES; d++) {
      if (imgs[i - d]) return imgs[i - d];
      if (imgs[i + d]) return imgs[i + d];
    }
    return null;
  };
  return { start, near, first: () => imgs[0] };
}

// Where the frame is drawn: s (scale) and x, y (top left), in CSS px.
function place(vw, vh, g, z, fx, fy) {
  const cover = Math.max(vw / W, vh / H);
  // Start: as the hero shows her (object-fit: cover at her focus).
  const s0 = cover;
  const x0 = (vw - W * s0) * fx;
  const y0 = (vh - H * s0) * fy;
  // End of the move: the laptop's screen centred, fitting a phone's width.
  const s1 = Math.min(cover, (0.88 * vw) / SCREEN.w);
  let x1 = vw / 2 - SX * s1;
  let y1 = vh * 0.52 - SY * s1;
  if (W * s1 >= vw) x1 = Math.min(0, Math.max(vw - W * s1, x1));
  if (H * s1 >= vh) y1 = Math.min(0, Math.max(vh - H * s1, y1));
  let s = lerp(s0, s1, g);
  let cx = lerp(x0, x1, g) + SX * s;
  let cy = lerp(y0, y1, g) + SY * s;
  // Then forward: the screen grows to a big window under the caption.
  if (z > 0) {
    const wT = Math.min(0.9 * vw, 0.58 * vh * (SCREEN.w / SCREEN.h), 1180);
    const sZ = Math.max(s, wT / SCREEN.w);
    s = lerp(s, sZ, z);
    cx = lerp(cx, vw / 2, z);
    cy = lerp(cy, vh * 0.6, z);
  }
  return { s, x: cx - SX * s, y: cy - SY * s };
}

// track, front, back, screen, caption: refs. focus: "38% 28%" (the hero's).
// onStart: the visitor has begun scrolling into the scene (she goes quiet).
export function useLaptopScene({ track, front, back, screen, caption, focus, onStart, enabled }) {
  useEffect(() => {
    const tr = track.current;
    const fc = front.current;
    const bc = back.current;
    const sc = screen.current;
    const cap = caption.current;
    if (!enabled || !tr || !fc || !bc || !sc) return;
    const section = tr.firstElementChild;
    const [fx, fy] = String(focus || "38% 28%")
      .split(" ")
      .map((v) => parseFloat(v) / 100);
    const f2 = fc.getContext("2d");
    const b2 = bc.getContext("2d");
    let vw = 0;
    let vh = 0;
    let dpr = 1;
    let raf = 0;
    let told = false;
    let lastKey = "";

    const size = () => {
      vw = section.clientWidth;
      vh = section.clientHeight;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      fc.width = Math.round(vw * dpr);
      fc.height = Math.round(vh * dpr);
      bc.width = Math.round(vw / 4);
      bc.height = Math.round(vh / 4);
      lastKey = "";
    };

    const draw = () => {
      raf = 0;
      const r = tr.getBoundingClientRect();
      const run = tr.offsetHeight - vh;
      const t = run > 0 ? clamp01(-r.top / run) : 0;
      if (t > 0.015 && !told) {
        told = true;
        onStart?.();
      }
      if (t < 0.005) told = false;

      const c = seg(t, 0.01, 0.08);
      const g = ease(seg(t, 0.05, 0.72));
      const a = seg(t, 0.68, 0.82);
      const z = ease(seg(t, 0.8, 0.97));
      section.style.setProperty("--c", c.toFixed(3));
      // Quick, so her clip and the first frame barely overlap
      section.style.setProperty("--fade", seg(t, 0.02, 0.04).toFixed(3));
      section.style.setProperty("--dim", (0.3 * z).toFixed(3));
      section.style.setProperty("--out", z.toFixed(3));
      section.classList.toggle("is-scrubbing", t > 0.015);
      if (cap) cap.style.setProperty("--cap", seg(t, 0.86, 0.96).toFixed(3));

      const i = Math.round(g * (FRAMES - 1));
      const img = frames.near(i);
      const p = place(vw, vh, g, z, fx, fy);
      const key = `${i}|${img ? 1 : 0}|${p.s.toFixed(4)}|${p.x.toFixed(1)}|${p.y.toFixed(1)}`;
      if (key !== lastKey && img) {
        lastKey = key;
        const covers = H * p.s >= vh - 1 && W * p.s >= vw - 1;
        f2.clearRect(0, 0, fc.width, fc.height);
        f2.drawImage(img, p.x * dpr, p.y * dpr, W * p.s * dpr, H * p.s * dpr);
        if (!covers) {
          // Soft top and bottom edges onto the blurred copy behind
          const top = p.y * dpr;
          const bot = (p.y + H * p.s) * dpr;
          const fe = 48 * dpr;
          const grad = f2.createLinearGradient(0, top, 0, bot);
          const k = Math.min(0.5, fe / Math.max(1, bot - top));
          grad.addColorStop(0, "rgba(0,0,0,0)");
          grad.addColorStop(k, "rgba(0,0,0,1)");
          grad.addColorStop(1 - k, "rgba(0,0,0,1)");
          grad.addColorStop(1, "rgba(0,0,0,0)");
          f2.globalCompositeOperation = "destination-in";
          f2.fillStyle = grad;
          f2.fillRect(0, 0, fc.width, fc.height);
          f2.globalCompositeOperation = "source-over";
          const cv = Math.max(bc.width / W, bc.height / H);
          b2.drawImage(img, (bc.width - W * cv) / 2, (bc.height - H * cv) / 2, W * cv, H * cv);
        }
        bc.classList.toggle("is-on", !covers);
      }

      // The Home screen on the laptop's screen, turning on as it appears
      const k = (SCREEN.w * p.s) / 1120;
      sc.style.opacity = a.toFixed(3);
      sc.style.visibility = a > 0 ? "visible" : "hidden";
      sc.style.left = `${p.x + SCREEN.x * p.s}px`;
      sc.style.top = `${p.y + SCREEN.y * p.s}px`;
      sc.style.width = `${SCREEN.w * p.s}px`;
      sc.style.height = `${SCREEN.h * p.s}px`;
      sc.style.setProperty("--k", k.toFixed(4));
      sc.style.transform = `perspective(${Math.round(SCREEN.w * p.s * 2.2)}px) rotateY(${((1 - ease(a)) * -32).toFixed(2)}deg) scale(${(0.94 + 0.06 * ease(a)).toFixed(3)})`;
    };

    const frames = loader(() => {
      lastKey = "";
      if (!raf) raf = requestAnimationFrame(draw);
    });
    const ask = () => {
      frames.start();
      if (!raf) raf = requestAnimationFrame(draw);
    };
    size();
    draw();
    // Fetched once the page has settled, or as soon as they scroll.
    const idle = setTimeout(frames.start, 2500);
    window.addEventListener("scroll", ask, { passive: true });
    const onResize = () => {
      size();
      ask();
    };
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(idle);
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", ask);
      window.removeEventListener("resize", onResize);
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
