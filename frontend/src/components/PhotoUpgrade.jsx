import { useEffect, useRef, useState } from "react";
import { copyHostedPhoto } from "../data/photos.js";
import { isPhone } from "../pwa/install.js";
import Icon from "./Icon.jsx";
import { isImageUrl } from "./PersonCard.jsx";

const AT_ONCE = 4;

// Students imported from the old ERP keep its full-size photos (1 to 10 MB
// each), which phones can't show hundreds of. Each is copied once into a
// small photo (about 11 KB) that staff and parents then see everywhere.
// On a computer this starts by itself for owners and admins (after every
// import too); on a phone it waits for a tap, to spare mobile data.
export default function PhotoUpgrade({ schoolId, students, onPhoto }) {
  const todo = students.filter((s) => !s.photo_path && isImageUrl(s.photo_url));
  const [run, setRun] = useState(null); // { done, failed, total, finished? }
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const stop = useRef(false);
  const tried = useRef(new Set()); // students already attempted this visit

  async function start() {
    const queue = todo.filter((s) => !tried.current.has(s.id));
    if (!queue.length) return;
    stop.current = false;
    setPaused(false);
    const state = { done: 0, failed: 0, total: queue.length };
    setRun({ ...state });
    const worker = async () => {
      for (let s = queue.shift(); s && !stop.current; s = queue.shift()) {
        tried.current.add(s.id);
        try {
          onPhoto(s.id, await copyHostedPhoto(schoolId, "students", s));
          state.done += 1;
        } catch {
          state.failed += 1;
        }
        setRun({ ...state });
      }
    };
    await Promise.all(Array.from({ length: AT_ONCE }, worker));
    setRun({ ...state, finished: !stop.current });
  }

  // Computers: start on its own shortly after the page settles.
  const waiting = todo.filter((s) => !tried.current.has(s.id)).length;
  useEffect(() => {
    if (!waiting || (run && !run.finished) || paused || isPhone() || navigator.connection?.saveData) return;
    const t = setTimeout(start, 1500);
    return () => clearTimeout(t);
  }, [waiting, run, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  function pause() {
    stop.current = true;
    setPaused(true);
  }

  if (hidden || (!todo.length && !run)) return null;
  const running = run && !run.finished && !paused;
  const pct = run ? Math.round(((run.done + run.failed) / run.total) * 100) : 0;

  return (
    <div className="callout photo-upgrade">
      <span className="photo-upgrade-icon">
        <Icon name="camera" size={18} />
      </span>
      <div className="photo-upgrade-text">
        {run?.finished ? (
          <>
            <strong>{run.done} photos are now small and fast for staff and parents.</strong>
            {run.failed > 0 && <span className="row-sub"> {run.failed} couldn’t be copied; they show initials if they don’t load.</span>}
          </>
        ) : running ? (
          <>
            <strong>
              Making photos small and fast… {run.done + run.failed} of {run.total}
            </strong>
            <span className="photo-upgrade-bar">
              <span style={{ width: `${pct}%` }} />
            </span>
            <span className="row-sub">Runs in the background while this page is open.</span>
          </>
        ) : (
          <>
            <strong>{todo.length} student photos are full size and slow to load, especially on phones.</strong>
            <span className="row-sub"> Make a small copy of each (about 11 KB instead of 1 to 10 MB). Best on a computer on Wi-Fi.</span>
          </>
        )}
      </div>
      {running ? (
        <button className="btn btn-secondary btn-sm" onClick={pause}>
          Pause
        </button>
      ) : (
        !run?.finished && (
          <button className="btn btn-primary btn-sm" onClick={start}>
            {paused ? "Resume" : "Make photos small"}
          </button>
        )
      )}
      {!running && (
        <button className="btn-icon" onClick={() => setHidden(true)} aria-label="Hide">
          <Icon name="x" size={16} />
        </button>
      )}
    </div>
  );
}
