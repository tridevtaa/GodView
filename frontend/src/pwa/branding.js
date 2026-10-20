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

const appFolder = (school) => `${school.id}/app/${school.logo_path.split("/").pop().replace(/\.\w+$/, "")}`;
const publicUrl = (path) => supabase.storage.from(LOGOS).getPublicUrl(path).data.publicUrl;

// The logo centred on a white square with a margin (phones round the
// corners, so nothing should touch the edge).
function squareIcon(img, size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, size, size);
  const room = size * 0.72;
  const k = Math.min(room / img.naturalWidth, room / img.naturalHeight);
  const w = img.naturalWidth * k;
  const h = img.naturalHeight * k;
  g.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
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
  const store = supabase.storage.from(LOGOS);
  for (const size of [180, 192, 512]) {
    const { error } = await store.upload(`${folder}/icon-${size}.png`, await squareIcon(img, size), { contentType: "image/png", upsert: true });
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
