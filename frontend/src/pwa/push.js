// Notifications on this device (new messages). The browser hands us a
// subscription; the database keeps it against the signed-in person, and the
// push-message function sends to it. iPhones only allow this in the app
// added to the home screen, not in Safari.
import { supabase } from "../supabase.js";
import { isIOS, isStandalone } from "./install.js";

// Public half of the VAPID key pair (the private half is a Supabase secret).
const VAPID_PUBLIC_KEY = "BMn5jI3zUhwd0gQZgCKi6xaj2Iub_8QeJDW31GBuXowmaTlXju9wUq6Jq36ODonIRFCYhBPju0vP7-tHVTBDTNI";

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// "on", "off", "blocked" (said no in the browser), "install" (iPhone, not
// yet on the home screen) or "unsupported".
export async function pushStatus() {
  if (isIOS() && !isStandalone()) return "install";
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

function urlKey(base64) {
  const raw = atob((base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function save(sub) {
  const { endpoint, keys } = sub.toJSON();
  const { error } = await supabase.rpc("save_push_subscription", { p_endpoint: endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth });
  if (error) throw error;
}

// Must run from a tap (iPhones ignore the request otherwise). Returns the
// new status.
export async function enablePush() {
  if ((await Notification.requestPermission()) !== "granted") return pushStatus();
  // The worker is registered on load in the built app; not in development.
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlKey(VAPID_PUBLIC_KEY) }));
  await save(sub);
  return "on";
}

export async function disablePush() {
  const reg = supported() && (await navigator.serviceWorker.getRegistration());
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.rpc("drop_push_subscription", { p_endpoint: sub.endpoint });
  await sub.unsubscribe();
}

// On each visit: re-save this device for whoever is signed in now, in case
// the browser renewed the subscription.
export async function syncPush() {
  if (!supported() || Notification.permission !== "granted") return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await save(sub);
}

// A tapped notification: what to open, { thread: studentId } for a
// conversation or { notice: id } for the noticeboard. Called with what the
// app was opened with (?thread= or ?notice=), then again for each tap while
// the app is already open. Returns a function that stops listening.
const target = (params) =>
  params.get("thread") ? { thread: params.get("thread") } : params.get("notice") ? { notice: params.get("notice") } : null;

export function onNotificationOpen(fn) {
  const params = new URLSearchParams(window.location.search);
  const first = target(params);
  if (first) {
    params.delete("thread");
    params.delete("notice");
    const rest = params.toString();
    window.history.replaceState(window.history.state, "", window.location.pathname + (rest ? `?${rest}` : ""));
    fn(first);
  }
  if (!("serviceWorker" in navigator)) return () => {};
  const listen = (e) => {
    if (e.data?.type !== "open") return;
    const to = target(new URL(e.data.url).searchParams);
    if (to) fn(to);
  };
  navigator.serviceWorker.addEventListener("message", listen);
  return () => navigator.serviceWorker.removeEventListener("message", listen);
}

// After a message is sent or a notice posted: tell the people it is for.
// Best effort.
export function announceMessage(id) {
  supabase.functions.invoke("push-message", { body: { message: id } }).catch(() => {});
}

export function announceNotice(id) {
  supabase.functions.invoke("push-message", { body: { notice: id } }).catch(() => {});
}
