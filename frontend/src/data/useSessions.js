import { useCallback, useEffect, useState } from "react";
import { listSessions } from "./api.js";
import { peek, swr } from "./cache.js";

// The school's academic sessions, newest first, and which one is current
// (the session whose dates include today, else the newest).
export function useSessions(schoolId) {
  // Kept on the device: the student list waits for the session, so a
  // remembered one lets it show at once.
  const [sessions, setSessions] = useState(() => peek(`sessions:${schoolId}`) ?? []);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    swr(`sessions:${schoolId}`, () => listSessions(schoolId), (rows) => !cancelled && setSessions(rows), { persist: true }).catch(
      () => !cancelled && setSessions((s) => s)
    );
    return () => {
      cancelled = true;
    };
  }, [schoolId, version]);

  const today = new Date().toISOString().slice(0, 10);
  const current =
    sessions.find((s) => s.starts_on && s.ends_on && s.starts_on <= today && today <= s.ends_on) ?? sessions[0];
  // After setting up a new session (admitting for next year)
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { sessions, current, reload };
}
