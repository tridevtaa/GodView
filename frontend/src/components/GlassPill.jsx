import { useEffect, useRef, useState } from "react";

// The Liquid Glass bubble behind the active tab. index: the active slot,
// count: slots in the bar. It glides to a new slot and stretches a little
// on the way, like a drop of glass. -1 hides it.
export default function GlassPill({ index, count }) {
  const last = useRef(index);
  const [flip, setFlip] = useState(false);
  useEffect(() => {
    if (index !== last.current) {
      // Alternate between two identical animations to replay the stretch.
      setFlip((f) => !f);
      last.current = index;
    }
  }, [index]);
  if (index < 0) return null;
  return <span className={`glass-pill${flip ? " is-b" : ""}`} style={{ "--i": index, "--n": count }} aria-hidden="true" />;
}
