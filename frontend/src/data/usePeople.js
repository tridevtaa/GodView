import { useCallback, useEffect, useState } from "react";
import { addEmployee, addStudent, loadEmployees, loadStudents, withPhotoUrls } from "./api.js";
import { peek, remember, swr } from "./cache.js";
import { supabase } from "../supabase.js";

// One retry before giving up: a dropped request, or a sign-in that expired
// while the laptop slept (getSession() renews it), shouldn't empty the list.
async function withRetry(load) {
  try {
    return await load();
  } catch (err) {
    console.warn("[people] load failed, retrying", err);
    await supabase.auth.getSession().catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    return load();
  }
}

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
  const [errorText, setErrorText] = useState("");
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  // Check again, unless it was fetched in the last 2 minutes
  const [check, setCheck] = useState(0);
  const revalidate = useCallback(() => setCheck((c) => c + 1), []);
  const ready = kind === "employees" || Boolean(sessionId);

  useEffect(() => {
    if (!schoolId || !ready) return;
    let cancelled = false;
    const cached = peek(key);
    setPeopleState(cached ?? []);
    setLoading(cached === undefined);
    // Something is on screen (memory, or the copy kept on the device)
    let shown = cached !== undefined;
    swr(
      key,
      () => withRetry(() => (kind === "students" ? loadStudents(schoolId, sessionId) : loadEmployees(schoolId)).then(withPhotoUrls)),
      (rows) => {
        if (cancelled) return;
        shown = true;
        setSource("supabase");
        setErrorText("");
        setPeopleState(rows);
        setLoading(false);
      },
      // The big lists: at most once every 2 minutes (Reload forces it).
      { persist: true, maxAge: version ? 0 : 120000 }
    ).catch((err) => {
      if (cancelled) return;
      console.error("[people] load failed", err);
      // Keep showing what we had (including the device copy); only an empty
      // screen is an error.
      if (!shown) {
        setSource("error");
        setErrorText([err?.code, err?.message].filter(Boolean).join(": ").slice(0, 160));
        setPeopleState([]);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [key, kind, schoolId, sessionId, ready, version, check]);

  // After an error, try again when the page is back in view or online
  useEffect(() => {
    if (source !== "error") return;
    const again = () => document.visibilityState === "visible" && reload();
    window.addEventListener("online", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("online", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [source, reload]);

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

  // Take a deleted profile off the list.
  const drop = useCallback((id) => {
    setPeople((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return { people, loading: loading || !ready, source, errorText, add, patch, drop, reload, revalidate };
}
