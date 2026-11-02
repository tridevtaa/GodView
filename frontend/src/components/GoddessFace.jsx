import { useEffect, useRef } from "react";

// The Goddess's small portrait: mostly still, and every so often she tilts
// her head and looks away in thought (cut from think.mp4 in /concierge/).
// Nothing is downloaded until her first move; with reduced motion, or if
// the phone refuses to play it, she just stays still.
const REST_MS = 14000;

export default function GoddessFace({ wait = 3000 }) {
  const video = useRef(null);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const v = video.current;
    let timer;
    const move = () => {
      if (document.hidden) timer = setTimeout(move, REST_MS);
      else v.play().catch(() => {});
    };
    const rest = () => {
      timer = setTimeout(move, REST_MS);
    };
    v.addEventListener("ended", rest);
    timer = setTimeout(move, wait);
    return () => {
      clearTimeout(timer);
      v.removeEventListener("ended", rest);
      v.pause();
    };
  }, [wait]);
  return <video ref={video} className="goddess-face" src="/concierge/face.mp4" poster="/concierge/face.jpg" muted playsInline preload="none" aria-hidden="true" />;
}
