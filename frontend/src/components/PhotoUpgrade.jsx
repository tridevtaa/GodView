import { useEffect, useRef } from "react";
import { copyHostedPhoto } from "../data/photos.js";
import { isPhone } from "../pwa/install.js";
import { isImageUrl } from "./PersonCard.jsx";

const AT_ONCE = 2; // gentle, so the computer it runs on doesn't feel it

// Students imported from the old ERP keep its full-size photos (1 to 10 MB
// each). Whenever an owner or admin has Godview open on a computer, this
// quietly copies each into a small photo (about 14 KB) that staff and
// parents then see everywhere. No banner: it picks up where it left off on
// the next visit, and new imports are handled the same way. Phones and
// data-saver connections are skipped.
export default function PhotoUpgrade({ schoolId, students, onPhoto }) {
  const tried = useRef(new Set()); // students attempted this visit
  const running = useRef(false);
  const waiting = students.filter((s) => !s.photo_path && isImageUrl(s.photo_url) && !tried.current.has(s.id));

  useEffect(() => {
    if (!waiting.length || running.current || isPhone() || navigator.connection?.saveData) return;
    let stopped = false;
    const queue = [...waiting];
    running.current = true;
    const worker = async () => {
      for (let s = queue.shift(); s && !stopped; s = queue.shift()) {
        tried.current.add(s.id);
        try {
          onPhoto(s.id, await copyHostedPhoto(schoolId, "students", s));
        } catch {
          // A broken or non-photo link: the tile shows initials. Retried next visit.
        }
      }
    };
    const t = setTimeout(() => Promise.all(Array.from({ length: AT_ONCE }, worker)).finally(() => (running.current = false)), 3000);
    return () => {
      stopped = true;
      clearTimeout(t);
      running.current = false;
    };
  }, [schoolId, waiting.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
