// Godview service worker: makes the installed app open fast and show its
// shell offline. School data always comes fresh from the network; only the
// app's own files are cached, plus small student photos (see PHOTOS).
// v6: drops pages stored by mistake under a missing file's name.
const CACHE = "godview-shell-v6";
// Student photos (small thumbnails), kept on the device so they appear
// instantly. Survives app updates; cleared on logout.
// v2: photos used to keep one file name when changed, so phones kept the
// old one; starting a fresh cache drops those stale copies once.
const PHOTOS = "godview-photos-v2";
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

  // Pages: the fresh page if it arrives within 0.8s (so new releases show
  // at once on a good connection), else the stored one straight away; the
  // fresh copy is stored for next time either way. Offline: the stored one.
  if (req.mode === "navigate") {
    const net = fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put("/", copy));
      }
      return res;
    });
    event.waitUntil(net.catch(() => {}));
    event.respondWith(
      caches.match("/").then((stored) => {
        if (!stored) return net;
        const slow = new Promise((resolve) => setTimeout(() => resolve(stored), 800));
        return Promise.race([net.catch(() => stored), slow]);
      })
    );
    return;
  }

  // Built files have content hashes in their names, so they never change.
  // A file from an older release is gone, and the server answers with the
  // page instead: never store that as the file.
  if (url.pathname.startsWith("/assets/") || /\.(png|svg|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok && !(res.headers.get("content-type") || "").includes("text/html")) {
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

// Notifications (new messages, sent by the push-message function). One per
// conversation: a newer message replaces the older one but still alerts.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || "Godview", {
        body: data.body || "",
        icon: "/icon-192.png?v=3",
        badge: "/icon-192.png?v=3",
        tag: data.url || "godview",
        renotify: true,
        data: { url: data.url || "/" },
      }),
      // An open app reloads its lists now (pwa/fresh.js), so the new
      // message is there as soon as the notification is.
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((wins) => wins.forEach((w) => w.postMessage({ type: "push", url: data.url }))),
    ])
  );
});

// Tapping one opens that conversation: in the app if it is already open
// (the page listens for "open"), else in a new window.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (!win) return self.clients.openWindow(url);
      win.postMessage({ type: "open", url });
      return win.focus();
    })
  );
});
