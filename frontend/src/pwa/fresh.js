// "Something new may be waiting": a notification just arrived while the app
// is open (the service worker says so), or the app came back on screen.
// Screens with live lists (a conversation, the inbox, the unread badges)
// reload at once instead of waiting for their next timer.

const EVENT = "godview:fresh";
const fire = () => window.dispatchEvent(new Event(EVENT));

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (e) => e.data?.type === "push" && fire());
}
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && fire());

// Returns a function that stops listening.
export function onFresh(fn) {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
