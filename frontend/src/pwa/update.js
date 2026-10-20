// A new release of Godview: notice it, and move people onto it.
//
// The page knows which release it's running (its main script's file name,
// which changes with every release). Now and then it fetches the page fresh
// and compares. When there's a newer one:
// - just opened (nobody has done anything yet), or back after a long while
//   in the background: it reloads into the new release by itself;
// - in the middle of using it: a banner offers "Update" (UpdatePrompt.jsx),
//   so nothing being typed is lost.
// Updating stores the fresh page for the service worker first, so the reload
// opens the new release even on a slow connection.

const CHECK_EVERY = 15 * 60 * 1000;
const AUTO_AFTER_AWAY = 30 * 60 * 1000; // back after this long: update by itself
const OPENING = 10 * 1000; // this soon after opening: update by itself

const running = document.querySelector('script[type="module"][src*="/assets/index-"]')?.getAttribute("src") ?? null;
const openedAt = Date.now();
let fresh = null; // the new release's page, once found
let hiddenAt = 0;
let touched = false;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

["pointerdown", "keydown"].forEach((e) => window.addEventListener(e, () => (touched = true), { once: true, capture: true }));

async function check() {
  if (!running || fresh || !navigator.onLine) return;
  try {
    const res = await fetch(`/?release-check=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const html = await res.text();
    const latest = html.match(/\/assets\/index-[^"']+\.js/)?.[0];
    if (!latest || latest === running) return;
    fresh = html;
    if (!touched && Date.now() - openedAt < OPENING && !recentlyUpdated()) return updateNow();
    notify();
  } catch {
    // Offline or blocked: try again later.
  }
}

export const updateReady = () => Boolean(fresh);

// Returns a function that stops listening.
export function onUpdateReady(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// At most one update by itself every two minutes, so a page that's still
// the old one (the site's edge can hold it for a few minutes after a
// release) can't reload over and over. The banner still works.
const KEY = "godview.updatedAt";
function recentlyUpdated() {
  try {
    return Date.now() - Number(sessionStorage.getItem(KEY) || 0) < 2 * 60 * 1000;
  } catch {
    return true;
  }
}

export async function updateNow() {
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // can't remember it: fine, the banner path doesn't loop
  }
  try {
    if (fresh && globalThis.caches) {
      const shell = (await caches.keys()).find((k) => k.startsWith("godview-shell"));
      if (shell) {
        const cache = await caches.open(shell);
        await cache.put("/", new Response(fresh, { headers: { "Content-Type": "text/html; charset=utf-8" } }));
      }
    }
  } catch {
    // Couldn't store it: the reload still fetches the page.
  }
  // A fresh address, so no cache along the way hands back the old page.
  const url = new URL(window.location.href);
  url.searchParams.set("release", String(Date.now()));
  window.location.replace(url.toString());
}

// Tidy the address after an update.
if (new URLSearchParams(window.location.search).has("release")) {
  const url = new URL(window.location.href);
  url.searchParams.delete("release");
  window.history.replaceState(window.history.state, "", url.toString());
}

if (running) {
  check();
  setInterval(check, CHECK_EVERY);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    // Back after a long while: whatever was on screen is stale anyway.
    const auto = away >= AUTO_AFTER_AWAY && !recentlyUpdated();
    if (fresh && auto) return updateNow();
    check().then(() => fresh && auto && updateNow());
  });
}
