import { useEffect, useState } from "react";
import { useHapticsSetting } from "../pwa/haptics.js";
import { disablePush, enablePush, pushStatus } from "../pwa/push.js";
import Icon from "./Icon.jsx";

const KEY = "godview.notifyDismissed";
const dismissed = () => {
  try {
    return Number(localStorage.getItem(KEY) || 0) > Date.now();
  } catch {
    return false;
  }
};

function useStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    pushStatus().then(setStatus, () => setStatus("unsupported"));
  }, []);
  return [status, setStatus];
}

// "Turn on notifications", once, while they are off on this device. Hidden
// for a month after Not now. (iPhones in Safari get the install banner
// instead: notifications need the home screen app there.)
// Why Turn on didn't work, in plain words. "push service error" comes from
// the browser itself (it couldn't reach its push service: a VPN or
// firewall, or Brave with Google push services off).
const SNOOZE = (days) => {
  try {
    localStorage.setItem(KEY, String(Date.now() + days * 864e5));
  } catch {
    // Storage blocked: just hide for now.
  }
};

export function NotifyPrompt({ text }) {
  const [status, setStatus] = useStatus();
  const [hidden, setHidden] = useState(dismissed);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  if (hidden || (status !== "off" && !problem)) return null;

  function close() {
    SNOOZE(30);
    setHidden(true);
  }

  async function turnOn() {
    setBusy(true);
    setProblem("");
    try {
      const next = await enablePush();
      if (next === "off" && Notification.permission === "default") {
        // The browser didn't show (or the person closed) its Allow prompt
        setProblem("Your browser didn’t ask. Click the bell or lock icon at the left of the address bar, allow notifications, then Turn on again.");
      } else if (next === "blocked") {
        setProblem("Notifications are blocked for Godview. Allow them from the lock icon in the address bar, then Turn on again.");
      }
      setStatus(next);
    } catch (err) {
      // It won't work in this browser right now: say why, and rest for a week
      SNOOZE(7);
      setProblem(
        /push service/i.test(err?.message ?? "")
          ? "This browser couldn’t reach its notification service (often a VPN or firewall; in Brave, turn on Google push messaging in settings). Try another browser, or the phone app."
          : "Couldn’t turn on notifications in this browser. Try again later, or use the phone app."
      );
    }
    setBusy(false);
  }

  return (
    <aside className={`notify${problem ? " has-problem" : ""}`} aria-label="Notifications" aria-live="polite">
      <Icon name="bell" size={20} className="notify-icon" />
      <span className="notify-text">{problem || text}</span>
      {!problem || status === "off" ? (
        <button className="btn btn-primary btn-sm" onClick={turnOn} disabled={busy}>
          {busy ? "Turning on…" : problem ? "Try again" : "Turn on"}
        </button>
      ) : null}
      <button className="btn-icon" onClick={close} aria-label="Not now">
        <Icon name="x" size={16} />
      </button>
    </aside>
  );
}

// In the account menu: Notifications On / Off for this device.
// Account menu: Vibration on or off (phones and tablets only)
export function HapticsMenuItem() {
  const [on, toggle] = useHapticsSetting();
  if (typeof matchMedia === "undefined" || !matchMedia("(pointer: coarse)").matches) return null;
  return (
    <button role="menuitem" className="menu-item" onClick={toggle}>
      <Icon name="phone" />
      <span className="notify-menu-label">
        Vibration
        <span className="menu-subtitle">{on ? "On" : "Off"}</span>
      </span>
    </button>
  );
}

export function NotifyMenuItem() {
  const [status, setStatus] = useStatus();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!status || status === "unsupported") return null;

  const note = failed
    ? "Couldn’t turn on in this browser"
    : { on: "On", off: "Off", blocked: "Blocked in browser settings", install: "Add Godview to your home screen first" }[status];
  async function toggle() {
    setBusy(true);
    setFailed(false);
    try {
      if (status === "on") {
        await disablePush();
        setStatus("off");
      } else {
        setStatus(await enablePush());
      }
    } catch {
      setFailed(status !== "on");
      setStatus(await pushStatus().catch(() => "off"));
    }
    setBusy(false);
  }

  return (
    <button role="menuitem" className="menu-item" onClick={toggle} disabled={busy || status === "blocked" || status === "install"}>
      <Icon name="bell" />
      <span className="notify-menu-label">
        Notifications
        <span className="menu-subtitle">{note}</span>
      </span>
    </button>
  );
}
