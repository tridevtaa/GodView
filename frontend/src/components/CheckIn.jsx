import { useEffect, useState } from "react";
import { checkinToday, staffCheck } from "../data/api.js";
import Icon from "./Icon.jsx";

export const timeText = (t) => (t ? new Date(t).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "");
export const hoursText = (from, to) => {
  const m = Math.max(0, Math.round((new Date(to) - new Date(from)) / 6e4));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};

// Checked in after the school's "late after" time (school time, India)
export const isLate = (inAt, lateAfter) => Boolean(inAt && lateAfter && new Date(inAt).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false }) > lateAfter);

// The phone's best fix within a few seconds: GPS sharpens over the first
// readings, so keep watching until it's within 25 m or time is up.
function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject({ code: "none" });
    let best = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      navigator.geolocation.clearWatch(watch);
      clearTimeout(timer);
      best ? resolve(best) : reject({ code: 3 });
    };
    const watch = navigator.geolocation.watchPosition(
      ({ coords }) => {
        if (!best || coords.accuracy < best.accuracy) best = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy };
        if (coords.accuracy <= 25) finish();
      },
      (e) => {
        if (e.code === 1) {
          done = true;
          navigator.geolocation.clearWatch(watch);
          clearTimeout(timer);
          reject(e);
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
    const timer = setTimeout(finish, 12000);
  });
}

function explain(e, radius) {
  if (e?.code === 1) return "Allow location for Godview in your phone’s settings, then try again.";
  if (e?.code === "none") return "This browser can’t share your location.";
  if (e?.code === 2 || e?.code === 3) return "Couldn’t find your location. Turn on location and try again near a window.";
  switch (e?.message) {
    case "too-far":
      return `You’re about ${Number(e.details).toLocaleString("en-IN")} m from school. Check in once you’re within ${radius} m.`;
    case "rough":
      return `Your location isn’t precise enough${e.details ? ` (±${e.details} m)` : ""}. Move near a window or outside and try again.`;
    case "off":
      return "Check-in has been turned off.";
    case "already-in":
      return "You’ve already checked in today.";
    case "not-in":
      return "Check in first.";
    default:
      return "Couldn’t reach Godview. Check your connection and try again.";
  }
}

// Home, for staff: check in on arrival and out when leaving, only within the
// school's radius. Shows nothing until the owner turns check-in on.
export default function CheckInCard({ schoolId }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    checkinToday(schoolId).then(
      (s) => !cancelled && setState(s),
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  if (!state?.enabled) return null;

  async function check(action) {
    setBusy("Finding you…");
    setError("");
    try {
      const where = await locate();
      setBusy(action === "in" ? "Checking in…" : "Checking out…");
      const r = await staffCheck(schoolId, action, where);
      setState((s) => ({ ...s, in_at: r.in_at, out_at: r.out_at }));
    } catch (e) {
      setError(explain(e, state.radius));
      // Someone checked in on another device: show it
      if (e?.message === "already-in") checkinToday(schoolId).then(setState, () => {});
    } finally {
      setBusy("");
    }
  }

  const late = isLate(state.in_at, state.late_after);
  const action = !state.in_at ? "in" : "out";
  const title = !state.in_at ? "You haven’t checked in" : state.out_at ? `${timeText(state.in_at)} to ${timeText(state.out_at)}` : `Checked in at ${timeText(state.in_at)}`;
  const sub = !state.in_at ? `Be within ${state.radius} m of school` : state.out_at ? `${hoursText(state.in_at, state.out_at)} at school` : late ? "Late today" : "Check out when you leave";

  return (
    <section className={`checkin${state.in_at ? " is-in" : ""}${state.out_at ? " is-out" : ""}`} aria-label="Check-in">
      <span className="checkin-icon" aria-hidden="true">
        <Icon name={state.out_at ? "check" : "pin"} size={20} />
      </span>
      <span className="checkin-text">
        <strong>{title}</strong>
        <span className={late && !state.out_at ? "is-late" : ""}>{sub}</span>
      </span>
      {state.out_at ? (
        <button className="link-btn checkin-again" disabled={Boolean(busy)} onClick={() => check("out")}>
          {busy || "Check out again"}
        </button>
      ) : (
        <button className="btn btn-primary btn-sm checkin-btn" disabled={Boolean(busy)} onClick={() => check(action)}>
          {busy || (action === "in" ? "Check in" : "Check out")}
        </button>
      )}
      {error && (
        <p className="checkin-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
