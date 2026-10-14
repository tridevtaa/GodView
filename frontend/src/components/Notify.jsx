import { useEffect, useState } from "react";
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
export function NotifyPrompt({ text }) {
  const [status, setStatus] = useStatus();
  const [hidden, setHidden] = useState(dismissed);
  const [busy, setBusy] = useState(false);
  if (hidden || status !== "off") return null;

  function close() {
    try {
      localStorage.setItem(KEY, String(Date.now() + 30 * 864e5));
    } catch {
      // Storage blocked: just hide for now.
    }
    setHidden(true);
  }

  async function turnOn() {
    setBusy(true);
    setStatus(await enablePush().catch(() => "off"));
    setBusy(false);
  }

  return (
    <aside className="notify" aria-label="Notifications">
      <Icon name="bell" size={20} className="notify-icon" />
      <span className="notify-text">{text}</span>
      <button className="btn btn-primary btn-sm" onClick={turnOn} disabled={busy}>
        Turn on
      </button>
      <button className="btn-icon" onClick={close} aria-label="Not now">
        <Icon name="x" size={16} />
      </button>
    </aside>
  );
}

// In the account menu: Notifications On / Off for this device.
export function NotifyMenuItem() {
  const [status, setStatus] = useStatus();
  const [busy, setBusy] = useState(false);
  if (!status || status === "unsupported") return null;

  const note = { on: "On", off: "Off", blocked: "Blocked in browser settings", install: "Add Godview to your home screen first" }[status];
  async function toggle() {
    setBusy(true);
    try {
      if (status === "on") {
        await disablePush();
        setStatus("off");
      } else {
        setStatus(await enablePush());
      }
    } catch {
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
