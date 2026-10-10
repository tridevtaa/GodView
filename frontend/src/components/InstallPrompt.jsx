import { useEffect, useState } from "react";
import { canPrompt, isIOS, isPhone, isStandalone, onInstallChange, promptInstall } from "../pwa/install.js";
import Icon from "./Icon.jsx";

const KEY = "godview.installDismissed";
const dismissed = () => {
  try {
    return Number(localStorage.getItem(KEY) || 0) > Date.now();
  } catch {
    return false;
  }
};

// "Add Godview to your home screen", on phones only, until installed or
// dismissed (then it stays away for 30 days).
export default function InstallPrompt() {
  const [, setTick] = useState(0);
  const [hidden, setHidden] = useState(() => isStandalone() || !isPhone() || dismissed());
  const [steps, setSteps] = useState(false);
  useEffect(() => onInstallChange(() => setTick((t) => t + 1)), []);

  const ios = isIOS();
  if (hidden || (!ios && !canPrompt())) return null;

  function close() {
    try {
      localStorage.setItem(KEY, String(Date.now() + 30 * 864e5));
    } catch {
      // Storage blocked: just hide for now.
    }
    setHidden(true);
  }

  async function install() {
    if (ios) return setSteps(true);
    if (await promptInstall()) setHidden(true);
  }

  return (
    <aside className="install" role="dialog" aria-label="Install Godview">
      <span className="install-icon">
        <img src="/icon-192.png?v=3" alt="" width="44" height="44" />
      </span>
      {steps ? (
        <ol className="install-steps">
          <li>
            Tap <ShareGlyph /> <strong>Share</strong> in Safari’s toolbar
          </li>
          <li>
            Choose <strong>Add to Home Screen</strong>
          </li>
        </ol>
      ) : (
        <div className="install-text">
          <strong>Get the Godview app</strong>
          <span>Open it from your home screen, full screen, in one tap.</span>
        </div>
      )}
      {!steps && (
        <button className="btn btn-primary btn-sm" onClick={install}>
          {ios ? "How" : "Install"}
        </button>
      )}
      <button className="btn-icon install-close" onClick={close} aria-label="Not now">
        <Icon name="x" size={16} />
      </button>
    </aside>
  );
}

// iOS share icon (box with an arrow up).
function ShareGlyph() {
  return (
    <svg className="install-share" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}
