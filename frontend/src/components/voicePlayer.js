// The assistant's voice plays through one shared <audio> element. Phones
// only play sound that a tap started, so the tap that opens the assistant
// plays a moment of silence on it (primeVoice); her greeting and answers
// can then play on the same element later.

const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
let el = null;
let primed = false;

export function voiceAudio() {
  if (!el && typeof Audio !== "undefined") el = new Audio();
  return el;
}

// Call inside a tap or click handler.
export function primeVoice() {
  const a = voiceAudio();
  if (!a || primed) return;
  primed = true;
  if (!a.src) {
    a.src = SILENT;
    a.play().catch(() => {});
  }
}
