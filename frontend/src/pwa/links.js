// godview.in links opened in the Android app (WhatsApp, SMS, email...).
// Android hands the link to the app (see the intent filter in
// android/app/src/main/AndroidManifest.xml and public/.well-known/assetlinks.json).
// We move the app to the link's page; the usual start-up code then opens the
// right screen (a student, the parent login, and so on).
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

const HANDLED = "godview-link-handled";

function open(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    return;
  }
  if (url.hostname !== "godview.in") return;
  const target = url.pathname + url.search + url.hash;
  if (target === window.location.pathname + window.location.search + window.location.hash) return;
  window.location.replace(target);
}

if (Capacitor.isNativePlatform()) {
  // App was already open: the link arrives as an event.
  App.addListener("appUrlOpen", ({ url }) => open(url));

  // App was started by the link. Only follow it once, so a later reload
  // (say, for a new release) doesn't pull the user back to it.
  App.getLaunchUrl()
    .then((launch) => {
      if (!launch?.url) return;
      try {
        if (sessionStorage.getItem(HANDLED) === launch.url) return;
        sessionStorage.setItem(HANDLED, launch.url);
      } catch {
        // No storage: still follow the link.
      }
      open(launch.url);
    })
    .catch(() => {});
}
