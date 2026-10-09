import { useEffect, useState } from "react";
import { listSessions } from "./api.js";

// The school's academic sessions, newest first, and which one is current
// (the session whose dates include today, else the newest).
export function useSessions(schoolId) {
  const [sessions, setSessions] = useState([]);
  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    listSessions(schoolId).then(
      (rows) => !cancelled && setSessions(rows),
      () => !cancelled && setSessions([])
    );
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  const today = new Date().toISOString().slice(0, 10);
  const current =
    sessions.find((s) => s.starts_on && s.ends_on && s.starts_on <= today && today <= s.ends_on) ?? sessions[0];
  return { sessions, current };
}
