import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { onUpdateReady, updateNow, updateReady } from "../pwa/update.js";
import Icon from "./Icon.jsx";

// "A new version of Godview is ready", while someone's using the app (when
// it can't update by itself without losing what's on screen). Update loads
// it at once; the cross hides it until the next time the app opens.
export default function UpdatePrompt() {
  const [ready, setReady] = useState(updateReady);
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => onUpdateReady(() => setReady(true)), []);

  const shown = ready && !closed;
  // Like the install banner: tell the page how tall it is (--banner-h).
  const box = useRef(null);
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    if (!shown || !box.current) return;
    const set = () => root.setProperty("--banner-h", `${box.current.offsetHeight + 12}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(box.current);
    return () => {
      ro.disconnect();
      root.setProperty("--banner-h", "0px");
    };
  }, [shown]);
  if (!shown) return null;

  return (
    <aside ref={box} className="install update" role="status" aria-label="New version of Godview">
      <span className="install-icon update-icon">
        <Icon name="lightning" size={22} weight="fill" />
      </span>
      <div className="install-text">
        <strong>A new version is ready</strong>
        <span>Update to get the latest changes. It takes a second.</span>
      </div>
      <button
        className="btn btn-primary btn-sm"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          updateNow();
        }}
      >
        {busy ? "Updating…" : "Update"}
      </button>
      <button className="btn-icon install-close" onClick={() => setClosed(true)} aria-label="Not now">
        <Icon name="x" size={16} />
      </button>
    </aside>
  );
}
