import { useState } from "react";

// Haptics: small taps under the finger, like a native app.
// Android: the vibration motor. iPhone (iOS 18+): Safari can't vibrate,
// but toggling a hidden switch control gives the system's own tap.
// Computers: nothing. Each person can turn it off (account menu).
//
// Kinds: select (switching tabs, a choice), tap (a button), lift (Home
// editing), success (something saved), error (something went wrong).

const KEY = "godview:haptics";
const VIBRATE = { select: 6, tap: 9, lift: 16, success: [12, 70, 16], error: [24, 60, 24, 60, 24] };
const IOS_TICKS = { select: 1, tap: 1, lift: 1, success: 2, error: 3 };

const isIOS = () => typeof navigator !== "undefined" && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
const touchScreen = () => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

export function hapticsOn() {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setHapticsOn(on) {
  try {
    if (on) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, "off");
  } catch {
    // Storage off: stays on for this visit
  }
}

// iPhone: a fresh hidden switch, clicked and removed. It must run right
// inside the tap (not after a timer), or iOS gives no feedback.
let iosSwitch = null;
function iosTick() {
  const label = document.createElement("label");
  label.setAttribute("aria-hidden", "true");
  label.style.display = "none";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  label.appendChild(input);
  document.head.appendChild(label);
  iosSwitch = label;
  try {
    label.click();
  } finally {
    label.remove();
    iosSwitch = null;
  }
}

let last = 0;
export function haptic(kind = "tap") {
  if (!touchScreen() || !hapticsOn()) return;
  // One at a time: a tap that also saves shouldn't buzz twice at once
  const now = Date.now();
  if (now - last < 40 && kind !== "success" && kind !== "error") return;
  last = now;
  try {
    if (typeof navigator.vibrate === "function" && !isIOS()) {
      navigator.vibrate(VIBRATE[kind] ?? VIBRATE.tap);
    } else if (isIOS()) {
      // The first tick now, inside the tap; any more just after
      iosTick();
      const n = IOS_TICKS[kind] ?? 1;
      for (let i = 1; i < n; i++) setTimeout(iosTick, i * 110);
    }
  } catch {
    // Never let a buzz break a tap
  }
}

// Taps across the app, without touching every button: tab and pill
// switches give a select tick; main buttons, round action buttons, Home
// tiles and checkboxes a tap; any error message that appears, an error.
const SELECT = ".tabbar button, .segmented button, .ig-tabs button, .pa-tabs button, .hw-filter button, .cls-switch button, [role='tab']";
const TAP = ".btn-primary, .btn-danger, .home-att-cta, .ig-act, .hw-tile, .home-quick-btn, .avatar-btn, input[type='checkbox'], input[type='radio']";
const ERROR = ".field-error, .notice-error";

export function installHaptics() {
  if (typeof document === "undefined" || installHaptics.done) return;
  installHaptics.done = true;
  document.addEventListener(
    "click",
    (e) => {
      const el = e.target instanceof Element ? e.target : null;
      if (!el || el.closest(":disabled") || iosSwitch?.contains(el)) return;
      if (el.closest(SELECT)) haptic("select");
      else if (el.closest(TAP)) haptic("tap");
    },
    true
  );
  // Error messages, wherever they appear
  new MutationObserver((records) => {
    for (const r of records)
      for (const n of r.addedNodes)
        if (n instanceof Element && (n.matches(ERROR) || n.querySelector(ERROR))) {
          haptic("error");
          return;
        }
  }).observe(document.body, { childList: true, subtree: true });
}

// Account menu: Vibration on or off
export function useHapticsSetting() {
  const [on, setOn] = useState(hapticsOn);
  return [
    on,
    () => {
      setHapticsOn(!on);
      setOn(!on);
      if (!on) haptic("tap"); // a tap to show it's on
    },
  ];
}
