import { useCallback, useEffect, useState } from "react";
import { addDoc, collection, getDocs } from "firebase/firestore";
import { db } from "../firebase.js";
import { SAMPLE } from "./sample.js";

// Loads a Firestore collection ("students" | "employees"). An empty collection
// shows sample data; a failed read shows nothing and reports the error.
// `source` is "firestore" | "sample" | "error".
export function usePeople(kind) {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState("firestore");
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getDocs(collection(db, kind))
      .then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      .then(
        (rows) => {
          if (cancelled) return;
          setSource(rows.length > 0 ? "firestore" : "sample");
          setPeople(rows.length > 0 ? rows : SAMPLE[kind]);
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
  }, [kind, version]);

  const add = useCallback(
    async (record) => {
      const { id } = await addDoc(collection(db, kind), record);
      setPeople((prev) => [{ id, ...record }, ...(source === "sample" ? [] : prev)]);
      setSource("firestore");
    },
    [kind, source]
  );

  // Apply fields already saved elsewhere (e.g. has_photo) to the list on screen.
  const patch = useCallback((id, fields) => {
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, ...fields } : p)));
  }, []);

  return { people, loading, source, add, patch, reload };
}
