import { useCallback, useEffect, useState } from "react";
import { addEmployee, addStudent, loadEmployees, loadStudents, withPhotoUrls } from "./api.js";
import { peek, remember, swr } from "./cache.js";

// Loads the people for a view: students enrolled in `sessionId`, or the
// school's employees. `source` is "supabase" | "error". The last list is
// remembered (in memory and on the device), so it shows at once and is
// refreshed in the background.
export function usePeople(kind, schoolId, sessionId) {
  const key = `people:${kind}:${schoolId}:${kind === "students" ? sessionId : ""}`;
  const [people, setPeopleState] = useState(() => peek(key) ?? []);
  const [loading, setLoading] = useState(() => peek(key) === undefined);
  const setPeople = useCallback(
    (next) =>
      setPeopleState((prev) => {
        const v = typeof next === "function" ? next(prev) : next;
        remember(key, v, true);
        return v;
      }),
    [key]
  );
  const [source, setSource] = useState("supabase");
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const ready = kind === "employees" || Boolean(sessionId);

  useEffect(() => {
    if (!schoolId || !ready) return;
    let cancelled = false;
    const cached = peek(key);
    setPeopleState(cached ?? []);
    setLoading(cached === undefined);
    swr(
      key,
      () => (kind === "students" ? loadStudents(schoolId, sessionId) : loadEmployees(schoolId)).then(withPhotoUrls),
      (rows) => {
        if (cancelled) return;
        setSource("supabase");
        setPeopleState(rows);
        setLoading(false);
      },
      // The big lists: at most once every 2 minutes (Reload forces it).
      { persist: true, maxAge: version ? 0 : 120000 }
    ).catch(() => {
      if (cancelled) return;
      // Keep showing what we had; only an empty screen is an error.
      if (peek(key) === undefined) {
        setSource("error");
        setPeopleState([]);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [key, kind, schoolId, sessionId, ready, version]);

  const add = useCallback(
    async (record) => {
      const saved =
        kind === "students" ? await addStudent(schoolId, sessionId, record) : await addEmployee(schoolId, record);
      setPeople((prev) => [saved, ...prev]);
    },
    [kind, schoolId, sessionId]
  );

  // Apply fields already saved elsewhere (edits, photos) to the list on screen.
  const patch = useCallback((id, fields) => {
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, ...fields } : p)));
  }, []);

  return { people, loading: loading || !ready, source, add, patch, reload };
}
