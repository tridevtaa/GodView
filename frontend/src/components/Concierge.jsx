import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { LogoMark } from "./Logo.jsx";
import { askConcierge, assistantVoice } from "../data/api.js";
import ReportCard, { cardLine, reportFacts, useReports } from "./ConciergeCards.jsx";
import { primeVoice, voiceAudio } from "./voicePlayer.js";
import "./concierge.css";

// godview.in/avatar: the assistant as a page. A person sits in a room on
// the left; the right side takes a question (typed or spoken), Claude
// answers aloud and can open a page, a student or a form, which closes
// this page and goes there. Chips at the bottom go straight to a page.
//
// The person is a set of short pre-made clips (see docs/avatar-clips.md),
// listed in /concierge/clips.json. Each clip starts and ends on the same
// still, so any clip can follow any other. Until the clips exist the page
// shows the still (if there is one) or a glowing orb instead.
// Her voice comes from the voice function (Google, free allowance, cached);
// when that is off, slow or used up, the device's own voice speaks.
// Listening uses the browser's speech recognition: nothing per minute.

const BASE = "/concierge/";
// Clips that play once, then hand back to the state underneath.
const SHOTS = ["greet", "gesture", "nod"];
// Report cards she can show here; chips with these keys open the card.
const CARDS = [
  ["fees", "Fee report"],
  ["attendance", "Attendance today"],
];
const STATUS = { listen: "Listening…", think: "Thinking…", talk: "Speaking…", gesture: "Speaking…", greet: "Speaking…" };
const ERRORS = {
  premium: "The assistant is part of the Premium plan.",
  not_allowed: "The assistant is for owners, admins and the principal.",
  busy: "Lots of questions right now. Try again in a minute.",
  too_fast: "Let's pause for a moment. Try again in a few minutes.",
  daily_limit: "That's all the questions for today. Ask me again tomorrow.",
  ai_failed: "Something went wrong there. Try asking again.",
};
// How long before this page gives way to the one asked for: with the
// gesture clip, long enough for her hand to open toward it (out 1.5 to 4s).
const LEAVE_MS = 2500;
const LEAVE_PLAIN_MS = 600;

// After a failed fetch, the device voice for this long before trying again.
const CLOUD_RETRY_MS = 10 * 60 * 1000;
// Longest wait for her voice before the device voice takes over.
const CLOUD_WAIT_MS = 6000;
let cloudOffUntil = 0;

const SR = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

function greeting() {
  const h = new Date().getHours();
  return h >= 4 && h < 12 ? "Good morning" : h >= 12 && h < 17 ? "Good afternoon" : "Good evening";
}

// A warm English voice, Indian English first; whatever the device has.
// Chosen once and kept: the device's voice list can be empty on the first
// call and fill in moments later, which used to make the fallback voice
// itself change partway through a session.
let cachedDeviceVoice;
function pickVoice() {
  if (cachedDeviceVoice !== undefined) return cachedDeviceVoice;
  const en = (window.speechSynthesis?.getVoices?.() ?? []).filter((v) => /^en/i.test(v.lang));
  if (!en.length) return null; // list not loaded yet; try again next call
  let found = null;
  for (const re of [/Veena|Neerja|Isha/i, /Google UK English Female/i, /Samantha|Serena|Karen|Moira|Aria|Jenny|Libby|Sonia/i, /female/i]) {
    found = en.find((x) => re.test(x.name));
    if (found) break;
  }
  cachedDeviceVoice = found ?? en.find((v) => v.lang === "en-IN") ?? en[0] ?? null;
  return cachedDeviceVoice;
}

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// The student Claude named: the exact name, else every word starting a
// word of the name ("aarav sh" finds Aarav Sharma).
function findStudents(all, name) {
  const q = norm(name);
  if (!q) return [];
  const exact = all.filter((p) => norm(p.name) === q);
  if (exact.length) return exact;
  const words = q.split(" ");
  return all.filter((p) => {
    const parts = norm(p.name).split(" ");
    return words.every((w) => parts.some((x) => x.startsWith(w)));
  });
}

function useClips() {
  const [m, setM] = useState(null);
  useEffect(() => {
    // Unknown paths come back as the app's page, so a bad answer just means none yet.
    fetch(`${BASE}clips.json`, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && typeof j === "object" && setM(j))
      .catch(() => {});
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
function ClipStage({ clips, focus, want, after, onShotEnd }) {
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

// pages / forms: [key, label] this person can open. chips: [key, label],
// the most used first. facts: figures the app already shows them.
// onAct({ type: "go" | "student" | "start" | "map", target | id }).
// sessionId: for the report cards; seesFees: may this person see the fee card.
export default function Concierge({ school, sessionId, seesFees, name, students, facts, page, pages, forms, chips, onAct, onClose }) {
  const manifest = useClips();
  const clips = manifest?.clips && Object.values(manifest.clips).some((l) => l?.length) ? manifest.clips : null;
  const poster = manifest?.poster ? BASE + manifest.poster : null;
  const reports = useReports(sessionId, seesFees);
  const cards = CARDS.filter(([k]) => reports[k]);

  const [phase, setPhase] = useState("idle"); // idle | listen | think | talk
  const [shot, setShot] = useState(null); // greet | gesture | nod, while it plays
  const [mood, setMood] = useState(""); // how she says it: pleased | concerned | sorry | show
  const [card, setCard] = useState(null); // fees | attendance
  const [draft, setDraft] = useState("");
  const [reply, setReply] = useState("");
  const [choices, setChoices] = useState([]);
  const [error, setError] = useState("");
  const [more, setMore] = useState(false);
  const [voiceOn, setVoiceOn] = useState(() => {
    try {
      return localStorage.getItem("gv-voice") !== "off";
    } catch {
      return true;
    }
  });
  const history = useRef([]);
  const rec = useRef(null);
  const talkTimer = useRef(0);
  const leaveTimer = useRef(0);
  const leaveFire = useRef(null);
  const leaveMin = useRef(0);
  const leaving = useRef(false);
  const busy = useRef(false);
  const soundUrl = useRef("");
  const greeted = useRef(false);
  const speakSeq = useRef(0);
  const first = String(name ?? "").split(" ")[0];
  // Typing counts as listening: the person leans in. The gesture always
  // plays out; the greeting gives way as soon as someone types or speaks;
  // the nod (question heard) as soon as the answer is ready.
  const busyNow = phase !== "idle" || Boolean(draft.trim());
  const talk = mood ? `talk-${mood}` : "talk";
  // under: what she does with no one-off clip playing.
  const under = busyNow ? (phase === "idle" ? "listen" : phase === "talk" ? talk : phase) : "idle";
  const want = shot === "gesture" ? shot : shot === "nod" && phase === "think" ? shot : busyNow || shot === "nod" ? under : shot ?? "idle";
  const wantBase = want.split("-")[0];
  useEffect(() => {
    if ((shot === "greet" && busyNow) || (shot === "nod" && phase !== "think")) setShot(null);
  }, [shot, busyNow, phase]);

  // Stops whatever she is saying, in either voice.
  const hush = useCallback(() => {
    speakSeq.current++;
    clearTimeout(talkTimer.current);
    window.speechSynthesis?.cancel();
    voiceAudio()?.pause();
  }, []);

  // how: pleased | concerned | sorry, for the tone of her voice.
  // overClip: a clip that already shows her speaking (the greeting) plays;
  // keep it rather than switching to thinking and talking.
  const speak = useCallback(
    (text, how = "", { overClip = false, onStart } = {}) => {
      hush();
      if (!voiceOn || !text) {
        onStart?.();
        return setPhase("idle");
      }
      const n = speakSeq.current;
      let started = false;
      const begin = () => {
        if (started) return;
        started = true;
        onStart?.();
      };
      let over = false;
      const finish = () => {
        if (over || n !== speakSeq.current) return;
        over = true;
        clearTimeout(talkTimer.current);
        setPhase((p) => (p === "talk" ? "idle" : p));
      };
      // Some browsers never say it ended: stop talking after a generous guess.
      const talkFor = (ms) => {
        if (!overClip) setPhase("talk");
        clearTimeout(talkTimer.current);
        talkTimer.current = setTimeout(finish, ms);
      };
      const device = () => {
        begin();
        const synth = window.speechSynthesis;
        if (n !== speakSeq.current) return;
        if (!synth) return setPhase((p) => (p === "think" ? "idle" : p));
        const u = new SpeechSynthesisUtterance(text);
        const v = pickVoice();
        if (v) {
          u.voice = v;
          u.lang = v.lang;
        } else u.lang = "en-IN";
        u.onend = finish;
        u.onerror = finish;
        synth.speak(u);
        talkFor(1500 + text.length * 90);
      };
      if (Date.now() < cloudOffUntil) return device();

      // Her own voice: she thinks for the moment it takes to arrive.
      if (!overClip) setPhase("think");
      let gaveUp = false;
      const slow = setTimeout(() => {
        gaveUp = true;
        device();
      }, CLOUD_WAIT_MS);
      assistantVoice(school.id, text, how)
        .then((blob) => {
          clearTimeout(slow);
          if (gaveUp || n !== speakSeq.current) return;
          const a = voiceAudio();
          if (soundUrl.current) URL.revokeObjectURL(soundUrl.current);
          soundUrl.current = URL.createObjectURL(blob);
          a.src = soundUrl.current;
          a.onended = finish;
          a.play()
            .then(() => {
              begin();
              talkFor(Number.isFinite(a.duration) ? a.duration * 1000 + 1500 : 1500 + text.length * 90);
            })
            .catch(device);
        })
        .catch(() => {
          clearTimeout(slow);
          cloudOffUntil = Date.now() + CLOUD_RETRY_MS;
          if (!gaveUp) device();
        });
    },
    [voiceOn, hush, school.id]
  );

  // Leaves for the page/student the action points to: once her voice has
  // actually started (not just after a guessed delay — the cloud voice is a
  // network call and can take a couple of seconds), wait the usual gesture
  // timing, then go. If her voice never starts at all (muted, or both the
  // cloud and device voice failed), leave anyway rather than get stuck.
  const go = useCallback(
    (action) => {
      const gesture = Boolean(clips?.gesture?.length);
      if (gesture) setShot("gesture");
      clearTimeout(leaveTimer.current);
      const minMs = gesture ? LEAVE_MS : LEAVE_PLAIN_MS;
      const fire = () => {
        leaving.current = true;
        onAct(action);
      };
      leaveFire.current = fire;
      leaveMin.current = minMs;
      leaveTimer.current = setTimeout(fire, CLOUD_WAIT_MS + minMs);
    },
    [clips, onAct]
  );

  const onVoiceStart = useCallback(() => {
    if (!leaveFire.current) return;
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(leaveFire.current, leaveMin.current);
  }, []);

  const respond = useCallback(
    (say, action, how = "") => {
      setChoices([]);
      setMood(how);
      if (action?.type === "card") {
        // She turns toward the card as it opens.
        if (reports[action.target]) {
          setCard(action.target);
          setMood("show");
        }
        setReply(say);
        return speak(say, how);
      }
      if (action?.type === "student") {
        const found = findStudents(students, action.target);
        if (found.length === 1) {
          setReply(say);
          go({ type: "student", id: found[0].id });
          return speak(say, how, { onStart: onVoiceStart });
        }
        const line = found.length ? `I found ${found.length} students called ${action.target}. Which one?` : `I couldn't find a student called ${action.target}.`;
        if (!found.length) setMood("sorry");
        setReply(line);
        setChoices(found.slice(0, 6));
        return speak(line, found.length ? "" : "sorry");
      }
      setReply(say);
      const navigating = action && action.type !== "none";
      if (navigating) go(action);
      speak(say, how, navigating ? { onStart: onVoiceStart } : undefined);
    },
    [students, go, speak, reports, onVoiceStart]
  );

  // A chip or the AI asked for a card: open it and read out its headline.
  const showCard = (kind) => {
    const line = cardLine(kind, reports);
    if (!line) return false;
    setError("");
    setCard(kind);
    setChoices([]);
    setReply(line.say);
    setMood(line.mood || "show");
    speak(line.say, line.mood);
    return true;
  };

  const ask = async (text) => {
    const q = text.trim();
    if (!q || busy.current) return;
    busy.current = true;
    hush();
    setDraft("");
    setChoices([]);
    setError("");
    setPhase("think");
    if (clips?.nod?.length) setShot("nod");
    try {
      const res = await askConcierge(school.id, {
        message: q,
        history: history.current,
        page,
        facts: { ...facts, ...reportFacts(reports) },
        name,
        pages,
        forms,
        cards,
        card,
      });
      history.current = [...history.current, { role: "user", text: q }, { role: "assistant", text: res.say }].slice(-8);
      respond(res.say, res.action, res.mood && res.mood !== "neutral" ? res.mood : "");
    } catch (e) {
      const msg = ERRORS[e.code] ?? ERRORS.ai_failed;
      setError(msg);
      setMood("sorry");
      speak(msg, "sorry");
    } finally {
      busy.current = false;
    }
  };
  const askRef = useRef(ask);
  askRef.current = ask;

  function listen() {
    if (rec.current) return rec.current.stop();
    hush();
    const r = new SR();
    r.lang = "en-IN";
    r.interimResults = true;
    let heard = "";
    r.onresult = (e) => {
      heard = Array.from(e.results, (x) => x[0].transcript).join("");
      setDraft(heard);
      // Her mic used to wait for the engine's own pause-detection to end
      // the recognition, which on some machines takes several seconds (or
      // longer with background noise) and looked like it was stuck
      // listening. Ending it the moment the final transcript is in is
      // immediate instead.
      if (e.results[e.results.length - 1].isFinal) r.stop();
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setError("Allow the microphone to talk to GodView.");
    };
    r.onend = () => {
      rec.current = null;
      setPhase((p) => (p === "listen" ? "idle" : p));
      if (heard.trim()) askRef.current(heard);
    };
    rec.current = r;
    setError("");
    setChoices([]);
    setPhase("listen");
    try {
      r.start();
    } catch {
      rec.current = null;
      setPhase("idle");
    }
  }

  function toggleVoice() {
    const on = !voiceOn;
    setVoiceOn(on);
    if (!on) {
      hush();
      setPhase((p) => (p === "talk" ? "idle" : p));
    }
    try {
      localStorage.setItem("gv-voice", on ? "on" : "off");
    } catch {
      /* private window */
    }
  }

  // Hello: the greeting clip, and said aloud each time the assistant opens
  // (after the first time it comes from the voice cache). Browsers only let
  // a page make sound after a tap, so not on a fresh load of /avatar.
  useEffect(() => {
    window.speechSynthesis?.getVoices?.();
    const clip = Boolean(clips?.greet?.length);
    if (clip) setShot("greet");
    if (greeted.current || !navigator.userActivation?.hasBeenActive) return;
    // Voices can arrive a moment after the page opens.
    const t = setTimeout(() => {
      greeted.current = true;
      speak(`${greeting()}${first ? `, ${first}` : ""}. I'm Goddess — how can I help?`, "pleased", { overClip: clip });
    }, 500);
    return () => clearTimeout(t);
  }, [Boolean(clips)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.documentElement.classList.add("cg-open");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("cg-open");
      clearTimeout(talkTimer.current);
      clearTimeout(leaveTimer.current);
      rec.current?.abort();
      // Opening a page keeps the sentence going; closing stops it.
      if (!leaving.current) hush();
    };
  }, [onClose, hush]);

  const shown = more ? chips : chips.slice(0, 4);

  return (
    <div
      className={`cg${clips ? " has-clips" : poster ? " has-still" : ""}${card ? " has-card" : ""}`}
      // Phones only play sound a tap started: opened from a link, the
      // first tap here unlocks her voice (opening from the app already did).
      onPointerDownCapture={primeVoice}
    >
      {/* The still also sits under the clips, so the room shows while they load. */}
      {poster && <img className="cg-still" src={poster} alt="" style={manifest.focus ? { objectPosition: manifest.focus } : undefined} />}
      {clips ? (
        <ClipStage clips={clips} focus={manifest.focus} want={want} after={under} onShotEnd={() => setShot(null)} />
      ) : (
        !poster && <div className={`cg-orb is-${wantBase}`} aria-hidden="true" />
      )}
      <div className="cg-shade" aria-hidden="true" />

      <header className="cg-top">
        <span className="cg-brand">
          <LogoMark size={22} />
          GODVIEW
        </span>
        <span className="cg-top-actions">
          <button type="button" className="cg-icon" onClick={toggleVoice} aria-pressed={voiceOn} aria-label={voiceOn ? "Mute voice" : "Turn voice on"} title={voiceOn ? "Mute voice" : "Turn voice on"}>
            <Icon name={voiceOn ? "speaker" : "speakerOff"} size={20} />
          </button>
          <button type="button" className="cg-icon" onClick={onClose} aria-label="Close" title="Close">
            <Icon name="x" size={20} />
          </button>
        </span>
      </header>

      <section className="cg-panel" aria-live="polite">
        <div className={`cg-status${want === "idle" ? "" : " is-on"}`}>
          <span className="cg-bars">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          {STATUS[wantBase] ?? ""}
        </div>
        <h1 className="cg-say">{reply || `${greeting()}${first ? `, ${first}` : ""}. I'm Goddess — how can I help?`}</h1>
        {choices.length > 0 && (
          <div className="cg-choices">
            {choices.map((p) => (
              <button
                key={p.id}
                type="button"
                className="cg-chip"
                onClick={() => {
                  setChoices([]);
                  setReply(`Opening ${p.name}.`);
                  go({ type: "student", id: p.id });
                  speak(`Opening ${p.name}.`, "", { onStart: onVoiceStart });
                }}
              >
                {p.name}
                {p.class ? <span className="cg-chip-sub">{[p.class, p.section].filter(Boolean).join("-")}</span> : null}
              </button>
            ))}
          </div>
        )}
        {error && <p className="cg-error">{error}</p>}
        {card && (
          <ReportCard
            kind={card}
            reports={reports}
            onOpen={() => {
              const label = pages.find(([k]) => k === card)?.[1] ?? "it";
              respond(`Opening ${label}.`, { type: "go", target: card });
            }}
            onClose={() => setCard(null)}
          />
        )}
        <form
          className="cg-ask"
          onSubmit={(e) => {
            e.preventDefault();
            ask(draft);
          }}
        >
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask Goddess anything" aria-label="Ask Goddess" enterKeyHint="send" autoComplete="off" />
          {draft.trim() && phase !== "listen" ? (
            <button type="submit" className="cg-icon" aria-label="Send" title="Send" disabled={phase === "think"}>
              <Icon name="send" size={20} />
            </button>
          ) : SR ? (
            <button type="button" className={`cg-icon${phase === "listen" ? " is-on" : ""}`} onClick={listen} aria-label={phase === "listen" ? "Stop listening" : "Speak"} title="Speak">
              <Icon name="mic" size={20} />
            </button>
          ) : null}
        </form>
      </section>

      <nav className="cg-chips" aria-label="Go to">
        {shown.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`cg-chip${card === key ? " is-on" : ""}`}
            aria-pressed={cards.some(([k]) => k === key) ? card === key : undefined}
            // Fees and Attendance open their card here; the rest go to the page.
            onClick={() => (card === key ? setCard(null) : showCard(key) || respond(`Opening ${label}.`, { type: "go", target: key }))}
          >
            {label}
          </button>
        ))}
        {chips.length > 4 && (
          <button type="button" className="cg-chip" onClick={() => setMore(!more)} aria-expanded={more}>
            {more ? "Less" : "More"}
          </button>
        )}
      </nav>
    </div>
  );
}
