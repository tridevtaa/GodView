// Godview service worker: makes the installed app open fast and show its
// shell offline. School data always comes fresh from the network; only the
// app's own files are cached.
const CACHE = "godview-shell-v4";
// Student photos (small thumbnails), kept on the device so they appear
// instantly. Survives app updates; cleared on logout.
const PHOTOS = "godview-photos-v1";
const DAY = 24 * 60 * 60 * 1000;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon-192.png"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== PHOTOS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Photos: the signed link changes every visit, so key them by file path.
  // Show the stored copy at once; re-check copies older than a day.
  if (url.hostname.endsWith(".supabase.co") && url.pathname.startsWith("/storage/v1/object/sign/photos/")) {
    event.respondWith(photo(event, req, url.origin + url.pathname));
    return;
  }

  if (url.origin !== self.location.origin) return; // other Supabase calls, fonts, map tiles: straight to network

  // Pages: network first so a new release shows at once; cached shell offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  // Built files have content hashes in their names, so they never change.
  if (url.pathname.startsWith("/assets/") || /\.(png|svg|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
  }
});

async function photo(event, req, key) {
  const cache = await caches.open(PHOTOS);
  const hit = await cache.match(key);
  const refresh = async () => {
    const res = await fetch(req);
    if (res.ok) {
      const body = await res.clone().blob();
      await cache.put(key, new Response(body, { headers: { "content-type": res.headers.get("content-type") || "image/jpeg", "x-saved-at": String(Date.now()) } }));
    }
    return res;
  };
  if (hit) {
    if (Date.now() - Number(hit.headers.get("x-saved-at") || 0) > DAY) event.waitUntil(refresh().catch(() => {}));
    return hit;
  }
  return refresh();
}
