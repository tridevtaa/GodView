import { useEffect, useRef, useState } from "react";

const STEP = 60;

// Draws a long list of cards in batches: the first 60, then 60 more each
// time the end comes near. Hundreds of photo cards no longer all render at
// once on opening a page or switching tabs. resetKey: start over (search,
// filter or page changed).
export default function Grid({ items, render, resetKey }) {
  const [shown, setShown] = useState(STEP);
  const end = useRef(null);

  useEffect(() => setShown(STEP), [resetKey]);

  useEffect(() => {
    if (shown >= items.length || !end.current) return;
    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && setShown((n) => n + STEP),
      { rootMargin: "800px 0px" }
    );
    io.observe(end.current);
    return () => io.disconnect();
  }, [shown, items.length]);

  return (
    <>
      <div className="grid">{items.slice(0, shown).map(render)}</div>
      {shown < items.length && <div ref={end} className="grid-more" aria-hidden="true" />}
    </>
  );
}
