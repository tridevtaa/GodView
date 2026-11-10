// The assistant's voice plays through one shared <audio> element. Phones
// only play sound that a tap started, so the tap that opens the assistant
// plays a moment of silence on it (primeVoice); her greeting and answers
// can then play on the same element later.
//
// A second, separate iPhone restriction: by default a page's audio plays
// on the "Ambient" channel, which the ringer/silent switch mutes outright
// (play() still resolves — nothing is heard). The Audio Session API
// (Safari 17+) moves the page to the "playback" channel, which the switch
// doesn't touch; older Safari has no such API and stays silenced, same as
// before.

const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
let el = null;
let primed = false;
let priming = false;

export function voiceAudio() {
  if (!el && typeof Audio !== "undefined") el = new Audio();
  return el;
}

// Call inside a tap or click handler. Only counted as done once the
// silent play() actually resolves — on a slower phone the gesture can
// lapse before it does, and marking it primed regardless (the old
// behaviour) left the element locked, and her voice silent, for the
// rest of the session with no retry. Failing quietly lets the next tap
// try again instead.
export function primeVoice() {
  if (navigator.audioSession && navigator.audioSession.type !== "playback") {
    try {
      navigator.audioSession.type = "playback";
    } catch {
      /* unsupported here: audio still plays, just muted by the silent switch */
    }
  }
  const a = voiceAudio();
  if (!a || primed || priming) return;
  priming = true;
  a.src = SILENT;
  a.play()
    .then(() => {
      primed = true;
    })
    .catch(() => {
      priming = false;
    });
}
