import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { LogoMark } from "./Logo.jsx";
import { askConcierge } from "../data/api.js";
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
// Speech in and out use the browser's own voices: nothing per minute.

const BASE = "/concierge/";
// Clips that play once, then hand back to the state underneath.
const SHOTS = ["greet", "gesture"];
const STATUS = { listen: "Listening…", think: "Thinking…", talk: "Speaking…", gesture: "Speaking…", greet: "Speaking…" };
const ERRORS = {
  premium: "The assistant is part of the Premium plan.",
  not_allowed: "The assistant is for owners, admins and the principal.",
  busy: "Lots of questions right now. Try again in a minute.",
  ai_failed: "Something went wrong there. Try asking again.",
};
// How long the gesture plays before this page gives way to the one asked for.
const LEAVE_MS = 1400;

const SR = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

function greeting() {
  const h = new Date().getHours();
  return h >= 4 && h < 12 ? "Good morning" : h >= 12 && h < 17 ? "Good afternoon" : "Good evening";
}

// A warm English voice, Indian English first; whatever the device has.
function pickVoice() {
  const en = (window.speechSynthesis?.getVoices?.() ?? []).filter((v) => /^en/i.test(v.lang));
  for (const re of [/Veena|Neerja|Isha/i, /Google UK English Female/i, /Samantha|Serena|Karen|Moira|Aria|Jenny|Libby|Sonia/i, /female/i]) {
    const v = en.find((x) => re.test(x.name));
    if (v) return v;
  }
  return en.find((v) => v.lang === "en-IN") ?? en[0] ?? null;
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
    fetch(`${BASE}clips.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && typeof j === "object" && setM(j))
      .catch(() => {});
  }, []);
  return m;
}

// Two stacked videos: the next clip loads in the hidden one, starts, then
// fades in over the other. Looping states pick a fresh variant each time.
function ClipStage({ clips, focus, want, onShotEnd }) {
  const els = useRef([null, null]);
  const cur = useRef({ i: 0, src: "", state: "" });
  const seq = useRef(0);
  const [front, setFront] = useState(0);
  const wantRef = useRef(want);
  wantRef.current = want;

  const play = useCallback(
    (state) => {
      const pool = clips[state]?.length ? clips[state] : clips.idle ?? [];
      if (!pool.length) return;
      const fresh = pool.length > 1 ? pool.filter((s) => s !== cur.current.src) : pool;
      const src = fresh[Math.floor(Math.random() * fresh.length)];
      const i = 1 - cur.current.i;
      const v = els.current[i];
      if (!v) return;
      const n = ++seq.current;
      v.src = BASE + src;
      v.play()
        .then(() => {
          if (n !== seq.current) return;
          const old = els.current[cur.current.i];
          cur.current = { i, src, state };
          setFront(i);
          setTimeout(() => old?.pause(), 400);
        })
        .catch(() => {});
    },
    [clips]
  );

  useEffect(() => play(want), [want, play]);

  const ended = (i) => {
    if (i !== cur.current.i) return;
    const { state } = cur.current;
    if (SHOTS.includes(state) && wantRef.current === state) onShotEnd();
    else play(wantRef.current);
  };

  return (
    <div className="cg-stage">
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
export default function Concierge({ school, name, students, facts, page, pages, forms, chips, onAct, onClose }) {
  const manifest = useClips();
  const clips = manifest?.clips && Object.values(manifest.clips).some((l) => l?.length) ? manifest.clips : null;
  const poster = manifest?.poster ? BASE + manifest.poster : null;

  const [phase, setPhase] = useState("idle"); // idle | listen | think | talk
  const [shot, setShot] = useState(null); // greet | gesture, while it plays
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
  const leaving = useRef(false);
  const busy = useRef(false);
  const first = String(name ?? "").split(" ")[0];
  // Typing counts as listening: the person leans in.
  const want = shot ?? (phase === "idle" && draft.trim() ? "listen" : phase);

  const speak = useCallback(
    (text) => {
      const synth = window.speechSynthesis;
      clearTimeout(talkTimer.current);
      if (!voiceOn || !synth || !text) return setPhase("idle");
      let over = false;
      const finish = () => {
        if (over) return;
        over = true;
        clearTimeout(talkTimer.current);
        setPhase((p) => (p === "talk" ? "idle" : p));
      };
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice();
      if (v) {
        u.voice = v;
        u.lang = v.lang;
      } else u.lang = "en-IN";
      u.onend = finish;
      u.onerror = finish;
      setPhase("talk");
      synth.speak(u);
      // Some browsers never say it ended: stop talking after a generous guess.
      talkTimer.current = setTimeout(finish, 1500 + text.length * 90);
    },
    [voiceOn]
  );

  const go = useCallback(
    (action) => {
      if (clips?.gesture?.length) setShot("gesture");
      clearTimeout(leaveTimer.current);
      leaveTimer.current = setTimeout(() => {
        leaving.current = true;
        onAct(action);
      }, LEAVE_MS);
    },
    [clips, onAct]
  );

  const respond = useCallback(
    (say, action) => {
      setChoices([]);
      if (action?.type === "student") {
        const found = findStudents(students, action.target);
        if (found.length === 1) {
          setReply(say);
          go({ type: "student", id: found[0].id });
          return speak(say);
        }
        const line = found.length ? `I found ${found.length} students called ${action.target}. Which one?` : `I couldn't find a student called ${action.target}.`;
        setReply(line);
        setChoices(found.slice(0, 6));
        return speak(line);
      }
      setReply(say);
      if (action && action.type !== "none") go(action);
      speak(say);
    },
    [students, go, speak]
  );

  const ask = async (text) => {
    const q = text.trim();
    if (!q || busy.current) return;
    busy.current = true;
    window.speechSynthesis?.cancel();
    setDraft("");
    setChoices([]);
    setError("");
    setPhase("think");
    try {
      const res = await askConcierge(school.id, { message: q, history: history.current, page, facts, name, pages, forms });
      history.current = [...history.current, { role: "user", text: q }, { role: "assistant", text: res.say }].slice(-8);
      respond(res.say, res.action);
    } catch (e) {
      setPhase("idle");
      setError(ERRORS[e.code] ?? ERRORS.ai_failed);
    } finally {
      busy.current = false;
    }
  };
  const askRef = useRef(ask);
  askRef.current = ask;

  function listen() {
    if (rec.current) return rec.current.stop();
    window.speechSynthesis?.cancel();
    const r = new SR();
    r.lang = "en-IN";
    r.interimResults = true;
    let heard = "";
    r.onresult = (e) => {
      heard = Array.from(e.results, (x) => x[0].transcript).join("");
      setDraft(heard);
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
    if (!on) window.speechSynthesis?.cancel();
    try {
      localStorage.setItem("gv-voice", on ? "on" : "off");
    } catch {
      /* private window */
    }
  }

  // Hello: the greeting clip, and said aloud once a day (browsers only
  // let a page speak after a tap, so not on a fresh load).
  useEffect(() => {
    window.speechSynthesis?.getVoices?.();
    if (clips?.greet?.length) setShot("greet");
    let said = "";
    try {
      said = localStorage.getItem("gv-greeted") ?? "";
    } catch {
      /* private window */
    }
    const day = new Date().toDateString();
    if (said === day || !navigator.userActivation?.hasBeenActive) return;
    try {
      localStorage.setItem("gv-greeted", day);
    } catch {
      /* private window */
    }
    // Voices can arrive a moment after the page opens.
    const t = setTimeout(() => speak(`${greeting()}${first ? `, ${first}` : ""}. How can I help?`), 500);
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
      if (!leaving.current) window.speechSynthesis?.cancel();
    };
  }, [onClose]);

  const shown = more ? chips : chips.slice(0, 4);

  return (
    <div className={`cg${clips ? " has-clips" : poster ? " has-still" : ""}`}>
      {clips ? (
        <ClipStage clips={clips} focus={manifest.focus} want={want} onShotEnd={() => setShot(null)} />
      ) : poster ? (
        <img className="cg-still" src={poster} alt="" style={manifest.focus ? { objectPosition: manifest.focus } : undefined} />
      ) : (
        <div className={`cg-orb is-${want}`} aria-hidden="true" />
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
          {STATUS[want] ?? ""}
        </div>
        <h1 className="cg-say">{reply || `${greeting()}${first ? `, ${first}` : ""}. How can I help?`}</h1>
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
                  speak(`Opening ${p.name}.`);
                }}
              >
                {p.name}
                {p.class ? <span className="cg-chip-sub">{[p.class, p.section].filter(Boolean).join("-")}</span> : null}
              </button>
            ))}
          </div>
        )}
        {error && <p className="cg-error">{error}</p>}
        <form
          className="cg-ask"
          onSubmit={(e) => {
            e.preventDefault();
            ask(draft);
          }}
        >
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask GodView anything" aria-label="Ask GodView" enterKeyHint="send" autoComplete="off" />
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
          <button key={key} type="button" className="cg-chip" onClick={() => respond(`Opening ${label}.`, { type: "go", target: key })}>
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
