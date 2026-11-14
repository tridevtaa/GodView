// Notifications on this device (new messages). In the browser/PWA, it hands
// us a Web Push subscription; in the Android/iOS app, the native plugin
// hands us an FCM token instead. Either way the database keeps it against
// the signed-in person, and the push-message function sends to it. iPhones
// only allow Web Push in the app added to the home screen, not in Safari;
// the native app isn't affected by that restriction.
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "../supabase.js";
import { isIOS, isStandalone } from "./install.js";

// Public half of the VAPID key pair (the private half is a Supabase secret).
const VAPID_PUBLIC_KEY = "BMn5jI3zUhwd0gQZgCKi6xaj2Iub_8QeJDW31GBuXowmaTlXju9wUq6Jq36ODonIRFCYhBPju0vP7-tHVTBDTNI";

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const native = () => Capacitor.isNativePlatform();

// The native plugin has no "give me the current token" getter, so the last
// one we registered is kept here to drop the right row on disablePush().
const NATIVE_TOKEN_KEY = "godview-native-push-token";

// "on", "off", "blocked" (said no in the browser), "install" (iPhone, not
// yet on the home screen) or "unsupported".
export async function pushStatus() {
  if (native()) {
    const { receive } = await PushNotifications.checkPermissions();
    return receive === "granted" ? "on" : receive === "denied" ? "blocked" : "off";
  }
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

// Registers with FCM and waits for the token. Must come after permission is
// granted; resolves once (not on later token refreshes - syncPush covers
// those on each visit).
function registerNativeToken() {
  return new Promise((resolve, reject) => {
    PushNotifications.addListener("registration", async (token) => {
      try {
        localStorage.setItem(NATIVE_TOKEN_KEY, token.value);
        await supabase.rpc("save_native_push_token", { p_token: token.value, p_platform: Capacitor.getPlatform() });
        resolve();
      } catch (e) {
        reject(e);
      }
    });
    PushNotifications.addListener("registrationError", (e) => reject(new Error(e.error)));
    PushNotifications.register();
  });
}

// Must run from a tap (iPhones ignore the request otherwise). Returns the
// new status.
export async function enablePush() {
  if (native()) {
    if ((await PushNotifications.requestPermissions()).receive !== "granted") return pushStatus();
    await registerNativeToken();
    return "on";
  }
  if ((await Notification.requestPermission()) !== "granted") return pushStatus();
  // The worker is registered on load in the built app; not in development.
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  // Never wait forever on the worker
  await Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error("worker-timeout")), 15000))]);
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlKey(VAPID_PUBLIC_KEY) }));
  await save(sub);
  return "on";
}

export async function disablePush() {
  if (native()) {
    const token = localStorage.getItem(NATIVE_TOKEN_KEY);
    if (!token) return;
    await supabase.rpc("drop_push_subscription", { p_endpoint: token });
    localStorage.removeItem(NATIVE_TOKEN_KEY);
    return;
  }
  const reg = supported() && (await navigator.serviceWorker.getRegistration());
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.rpc("drop_push_subscription", { p_endpoint: sub.endpoint });
  await sub.unsubscribe();
}

// On each visit: re-save this device for whoever is signed in now, in case
// the subscription/token was renewed.
export async function syncPush() {
  if (native()) {
    if ((await PushNotifications.checkPermissions()).receive === "granted") await registerNativeToken().catch(() => {});
    return;
  }
  if (!supported() || Notification.permission !== "granted") return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await save(sub);
}

// A tapped notification: what to open, { thread: studentId } for a
// conversation, { notice: id } for the noticeboard, or { go: section,
// child? } for a page (the everyday ones: attendance, fees…). Called with
// what the app was opened with (?thread=, ?notice=, ?go=), then again for
// each tap while the app is already open. Returns a function that stops
// listening.
const target = (params) =>
  params.get("thread")
    ? { thread: params.get("thread") }
    : params.get("notice")
    ? { notice: params.get("notice") }
    : params.get("go")
    ? { go: params.get("go"), child: params.get("child") }
    : null;

export function onNotificationOpen(fn) {
  if (native()) {
    // A tap while the app was backgrounded or closed; the FCM payload
    // carries the same relative url push-message always sends.
    PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      const url = action.notification.data?.url;
      const to = url && target(new URL(url, "https://x").searchParams);
      if (to) fn(to);
    });
    return () => PushNotifications.removeAllListeners();
  }
  const params = new URLSearchParams(window.location.search);
  const first = target(params);
  if (first) {
    for (const k of ["thread", "notice", "go", "child"]) params.delete(k);
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

export function announceBatch(id) {
  supabase.functions.invoke("push-message", { body: { batch: id } }).catch(() => {});
}

export function announceNotice(id) {
  supabase.functions.invoke("push-message", { body: { notice: id } }).catch(() => {});
}
