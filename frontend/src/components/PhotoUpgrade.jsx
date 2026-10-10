import { useState } from "react";
import { copyHostedPhoto } from "../data/photos.js";
import Icon from "./Icon.jsx";
import { isImageUrl } from "./PersonCard.jsx";

const AT_ONCE = 4;

// Students imported from the old ERP keep its full-size photos (1 to 10 MB
// each), which phones can't show hundreds of. Admins make a small copy of
// each in one go; tiles then use the copy everywhere.
export default function PhotoUpgrade({ schoolId, students, onPhoto }) {
  const todo = students.filter((s) => !s.photo_path && isImageUrl(s.photo_url));
  const [run, setRun] = useState(null); // { done, failed, total } while running or after
  const [hidden, setHidden] = useState(false);

  if (hidden || (!todo.length && !run)) return null;

  async function start() {
    const queue = [...todo];
    const state = { done: 0, failed: 0, total: queue.length };
    setRun({ ...state });
    const worker = async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
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
    setRun({ ...state, finished: true });
  }

  const running = run && !run.finished;
  const pct = run ? Math.round(((run.done + run.failed) / run.total) * 100) : 0;

  return (
    <div className="callout photo-upgrade">
      <span className="photo-upgrade-icon">
        <Icon name="camera" size={18} />
      </span>
      <div className="photo-upgrade-text">
        {run?.finished ? (
          <>
            <strong>{run.done} photos are now phone-friendly.</strong>
            {run.failed > 0 && <span className="row-sub"> {run.failed} couldn’t be copied; they show initials if they don’t load.</span>}
          </>
        ) : running ? (
          <>
            <strong>
              Making photos phone-friendly… {run.done + run.failed} of {run.total}
            </strong>
            <span className="photo-upgrade-bar">
              <span style={{ width: `${pct}%` }} />
            </span>
            <span className="row-sub">Keep this page open. Best on a computer on Wi-Fi.</span>
          </>
        ) : (
          <>
            <strong>{todo.length} student photos are full size and won’t load on phones.</strong>
            <span className="row-sub"> Make a small copy of each (about 30 KB instead of 1 to 10 MB). Takes a few minutes; best on a computer on Wi-Fi.</span>
          </>
        )}
      </div>
      {!run && (
        <button className="btn btn-primary btn-sm" onClick={start}>
          Make phone-friendly
        </button>
      )}
      {!running && (
        <button className="btn-icon" onClick={() => setHidden(true)} aria-label="Hide">
          <Icon name="x" size={16} />
        </button>
      )}
    </div>
  );
}
