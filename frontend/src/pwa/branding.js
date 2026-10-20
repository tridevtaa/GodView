import { useEffect } from "react";
import { logoUrl } from "../data/api.js";
import { supabase } from "../supabase.js";

// Once someone's signed in, Godview wears their school:
// - the browser tab: the school's logo as its icon, its name in the title;
// - adding the app to the home screen: the school's logo (on white, square)
//   and short name, on iPhone (touch icon, app title) and Android (install
//   manifest).
// The home screen files are made once per logo, by an owner's app, and kept
// next to the logo in the public bucket (<school>/app/<logo name>/), so
// phones can fetch them like any file. Phones read them only when the app
// is added, so an app installed before keeps the icon it was installed with.
// Godview's own icon, title and manifest come back if the school has no
// logo, or when the screen goes away.

const GODVIEW_TITLE = "Godview | School management for Indian schools";
const LOGOS = "school-logos";
const LIVE = "godview.in"; // install files name the live site, so only it makes them

// v2: the logo is trimmed to its drawn part first (v1 icons kept a logo's
// own empty border, so the mark came out small).
const appFolder = (school) => `${school.id}/app/v2-${school.logo_path.split("/").pop().replace(/\.\w+$/, "")}`;
const publicUrl = (path) => supabase.storage.from(LOGOS).getPublicUrl(path).data.publicUrl;

// The logo centred on a white square with a margin (phones round the
// corners, so nothing should touch the edge).
// The part of the logo that's actually drawn: its box without the empty
// (transparent or white) border many logo files have.
function drawnBox(img) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const empty = data[i + 3] < 16 || (data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245);
      if (empty) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? { x: 0, y: 0, w: width, h: height } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function squareIcon(img, size, box = drawnBox(img)) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, size, size);
  // The mark fills ~68% of the square: clear of the rounded corners and of
  // Android's round mask, but big enough to read.
  const room = size * 0.68;
  const k = Math.min(room / box.w, room / box.h);
  const w = box.w * k;
  const h = box.h * k;
  g.drawImage(img, box.x, box.y, box.w, box.h, (size - w) / 2, (size - h) / 2, w, h);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("icon"))), "image/png"));
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

const exists = (url) => fetch(url, { method: "HEAD", cache: "no-store" }).then((r) => r.ok, () => false);

// Owner, on the live site: make the school's home screen files if this
// logo doesn't have them yet.
async function makeAppFiles(school) {
  const folder = appFolder(school);
  if (await exists(publicUrl(`${folder}/manifest.webmanifest`))) return true;
  const img = await loadImage(logoUrl(school.logo_path));
  const box = drawnBox(img);
  const store = supabase.storage.from(LOGOS);
  for (const size of [180, 192, 512]) {
    const { error } = await store.upload(`${folder}/icon-${size}.png`, await squareIcon(img, size, box), { contentType: "image/png", upsert: true });
    if (error) throw error;
  }
  const base = await fetch("/manifest.webmanifest").then((r) => r.json());
  const origin = `https://${LIVE}`;
  const name = school.short_name || school.name;
  const manifest = {
    ...base,
    name: `${name} · Godview`,
    short_name: name,
    // Addresses in full: this file lives on another site.
    id: new URL(base.id || "/", origin).href,
    start_url: new URL(base.start_url || "/", origin).href,
    scope: new URL(base.scope || "/", origin).href,
    icons: [
      { src: publicUrl(`${folder}/icon-192.png`), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: publicUrl(`${folder}/icon-512.png`), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: publicUrl(`${folder}/icon-512.png`), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  const { error } = await store.upload(`${folder}/manifest.webmanifest`, new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" }), {
    contentType: "application/manifest+json",
    upsert: true,
  });
  if (error) throw error;
  return true;
}

// Remembers an element's attribute and puts it back later.
function swap(el, attr, value, undo) {
  if (!el) return;
  const was = el.getAttribute(attr);
  el.setAttribute(attr, value);
  undo.push(() => (was === null ? el.removeAttribute(attr) : el.setAttribute(attr, was)));
}

// school: the signed-in school (or a parent's chosen child's school).
// owner: true when this person can make the school's home screen files.
export function useSchoolBranding(school, { owner = false } = {}) {
  const logo = school?.logo_path ? logoUrl(school.logo_path) : "";
  const name = school?.short_name || school?.name || "";

  // The tab: at once.
  useEffect(() => {
    const undo = [];
    if (logo) {
      document.querySelectorAll('link[rel="icon"]').forEach((l) => {
        swap(l, "href", logo, undo);
        swap(l, "type", "image/png", undo);
      });
    }
    document.title = name ? `${name} · Godview` : GODVIEW_TITLE;
    return () => {
      undo.reverse().forEach((fn) => fn());
      document.title = GODVIEW_TITLE;
    };
  }, [logo, name]);

  // The home screen: once the school's files are there.
  const id = school?.id;
  const path = school?.logo_path;
  useEffect(() => {
    if (!id || !path) return;
    let alive = true;
    const undo = [];
    const sch = { id, logo_path: path, name: school.name, short_name: school.short_name };
    const folder = appFolder(sch);
    const manifest = publicUrl(`${folder}/manifest.webmanifest`);
    (owner && window.location.hostname === LIVE ? makeAppFiles(sch) : exists(manifest))
      .then((ok) => {
        if (!alive || !ok) return;
        swap(document.querySelector('link[rel="apple-touch-icon"]'), "href", publicUrl(`${folder}/icon-180.png`), undo);
        swap(document.querySelector('meta[name="apple-mobile-web-app-title"]'), "content", name || "Godview", undo);
        swap(document.querySelector('link[rel="manifest"]'), "href", manifest, undo);
      })
      .catch(() => {
        // Not made (yet): Godview's icon stays.
      });
    return () => {
      alive = false;
      undo.reverse().forEach((fn) => fn());
    };
  }, [id, path, name, owner]); // eslint-disable-line react-hooks/exhaustive-deps
}
