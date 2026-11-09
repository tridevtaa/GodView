import { useCallback, useEffect, useRef, useState } from "react";

// Goddess herself: the clips in /concierge/clips.json and the player that
// cuts between them. Shared by the assistant (Concierge.jsx) and the
// landing page's hero, so she looks and moves the same in both.

export const BASE = "/concierge/";
// Clips that play once, then hand back to the state underneath.
export const SHOTS = ["greet", "gesture", "nod"];

// Kept once fetched, so a page that comes down with the finger has her ready.
let manifestLoad = null;
const loadManifest = () =>
  (manifestLoad ??= fetch(`${BASE}clips.json`, { cache: "no-cache" })
    // Unknown paths come back as the app's page, so a bad answer just means none yet.
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (j && typeof j === "object" ? j : null))
    .catch(() => null));

// Before the first pull: the list of clips and her still.
export function preloadConcierge() {
  return loadManifest().then((m) => {
    if (m?.poster) new Image().src = BASE + m.poster;
  });
}

export function useClips() {
  const [m, setM] = useState(null);
  useEffect(() => {
    let live = true;
    loadManifest().then((j) => live && j && setM(j));
    return () => {
      live = false;
    };
  }, []);
  return m;
}

// Two stacked videos. While one plays, the clip most likely to follow is
// loaded and paused on its first frame in the hidden one; when the clip
// ends it starts and swaps in at once, with no fade (every clip begins and
// ends on the same still, so the seam doesn't show). When the state changes
// mid-clip (she starts talking), the new clip fades in over the old.
// Looping states pick a fresh variant each time.
// after: the state to go to when a one-off clip (greet, nod) is over.
export function ClipStage({ clips, focus, want, after, onShotEnd }) {
  const els = useRef([null, null]);
  const cur = useRef({ i: 0, src: "", state: "" });
  const queued = useRef(null); // { i, src, state }: waiting in the hidden video
  const aim = useRef(""); // the state last started (or starting)
  const seq = useRef(0);
  const [front, setFront] = useState(0);
  const [cut, setCut] = useState(false);
  const wantRef = useRef(want);
  wantRef.current = want;
  const afterRef = useRef(after);
  afterRef.current = after;

  // A mood ("talk-pleased") falls back to its plain state ("talk").
  // Looping in a mood, the plain clips join in so it doesn't repeat.
  const pick = useCallback(
    (state) => {
      const base = state.split("-")[0];
      const own = clips[state] ?? [];
      const plain = clips[base] ?? [];
      const pool = !own.length ? (plain.length ? plain : clips.idle ?? []) : cur.current.state === state ? [...own, ...plain] : own;
      if (!pool.length) return "";
      const fresh = pool.length > 1 ? pool.filter((s) => s !== cur.current.src) : pool;
      return fresh[Math.floor(Math.random() * fresh.length)];
    },
    [clips]
  );

  // What plays after the current clip: the same state again, or for a
  // one-off clip, the state underneath it.
  const nextState = () => (SHOTS.includes(wantRef.current) ? afterRef.current : wantRef.current);

  const show = useCallback(
    (i, src, state, clean, n) => {
      const old = els.current[cur.current.i];
      cur.current = { i, src, state };
      setCut(clean);
      setFront(i);
      // Once the old video is out of sight, load the next clip into it.
      setTimeout(
        () => {
          if (n !== seq.current) return;
          old?.pause();
          const st = nextState();
          const nsrc = pick(st);
          const v = els.current[1 - i];
          if (!nsrc || !v) return;
          v.src = BASE + nsrc;
          v.load();
          queued.current = { i: 1 - i, src: nsrc, state: st };
        },
        clean ? 60 : 400
      );
    },
    [pick] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Starts a state now (mid-clip): into the hidden video, then fade.
  const play = useCallback(
    (state) => {
      aim.current = state;
      const q = queued.current;
      const n = ++seq.current;
      queued.current = null;
      const { i, src } = q && q.state === state ? q : { i: 1 - cur.current.i, src: pick(state) };
      const v = els.current[i];
      if (!src || !v) return;
      if (!(q && q.state === state)) v.src = BASE + src;
      v.play()
        .then(() => n === seq.current && show(i, src, state, false, n))
        .catch(() => {});
    },
    [pick, show]
  );

  useEffect(() => {
    if (want !== aim.current) play(want);
  }, [want, play]);

  const ended = (i) => {
    if (i !== cur.current.i) return;
    const shotOver = SHOTS.includes(cur.current.state) && wantRef.current === cur.current.state;
    const state = nextState();
    const q = queued.current;
    if (q && q.state === state) {
      // The seam: the queued clip starts on the frame this one ended on.
      aim.current = state;
      queued.current = null;
      const n = ++seq.current;
      els.current[q.i]
        .play()
        .then(() => n === seq.current && show(q.i, q.src, q.state, true, n))
        .catch(() => {});
    } else play(state);
    if (shotOver) onShotEnd();
  };

  return (
    <div className={`cg-stage${cut ? " is-cut" : ""}`}>
      {[0, 1].map((i) => (
        <video
          key={i}
          ref={(el) => (els.current[i] = el)}
          className={i === front ? "is-front" : ""}
          style={focus ? { objectPosition: focus } : undefined}
          muted
          playsInline
          preload="auto"
          onEnded={() => ended(i)}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
