import { useCallback, useEffect, useState } from "react";
import { addEmployee, addStudent, loadEmployees, loadStudents, withPhotoUrls } from "./api.js";

// Loads the people for a view: students enrolled in `sessionId`, or the
// school's employees. `source` is "supabase" | "error".
export function usePeople(kind, schoolId, sessionId) {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState("supabase");
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const ready = kind === "employees" || Boolean(sessionId);

  useEffect(() => {
    if (!schoolId || !ready) return;
    let cancelled = false;
    setLoading(true);
    const load = kind === "students" ? loadStudents(schoolId, sessionId) : loadEmployees(schoolId);
    load
      .then(withPhotoUrls)
      .then(
        (rows) => {
          if (cancelled) return;
          setSource("supabase");
          setPeople(rows);
        },
        () => {
          if (cancelled) return;
          setSource("error");
          setPeople([]);
        }
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [kind, schoolId, sessionId, ready, version]);

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
