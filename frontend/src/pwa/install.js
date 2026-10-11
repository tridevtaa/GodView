// Installing Godview to the home screen. Chrome/Android fires
// "beforeinstallprompt" early (often before React mounts), so it is caught
// here at load and kept for the Install button. iPhone has no such event:
// people add it from Safari's Share menu, so we show those steps instead.

let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e;
  notify();
});
window.addEventListener("appinstalled", () => {
  deferred = null;
  notify();
});

// Opened as the installed app. The manifest's start URL carries ?app=1 as a
// second signal for browsers that don't report display-mode.
export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  window.navigator.standalone === true ||
  new URLSearchParams(window.location.search).has("app");

export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// Parent login (mobile + password) shows on the landing page and in the
// installed app. VITE_PARENT_LOGIN=off hides it again.
export const parentLoginLive = import.meta.env.VITE_PARENT_LOGIN !== "off";

export const isPhone = () => window.matchMedia?.("(pointer: coarse)").matches && window.innerWidth < 900;

export const canPrompt = () => Boolean(deferred);

export async function promptInstall() {
  if (!deferred) return false;
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  notify();
  return outcome === "accepted";
}

export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
