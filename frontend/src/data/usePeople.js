import { useCallback, useEffect, useState } from "react";
import { addDoc, collection, getDocs } from "firebase/firestore";
import { db } from "../firebase.js";
import { SAMPLE } from "./sample.js";

// Loads a Firestore collection ("students" | "employees"). Falls back to
// sample data when the collection is empty or Firestore can't be reached.
export function usePeople(kind) {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [usingSample, setUsingSample] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getDocs(collection(db, kind))
      .then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      .catch(() => [])
      .then((rows) => {
        if (cancelled) return;
        const fallback = rows.length === 0;
        setUsingSample(fallback);
        setPeople(fallback ? SAMPLE[kind] : rows);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const add = useCallback(
    async (record) => {
      let id = `local-${Date.now()}`;
      try {
        id = (await addDoc(collection(db, kind), record)).id;
      } catch {
        // Keep the record locally so the draft UI still works offline.
      }
      setPeople((prev) => [{ id, ...record }, ...prev]);
    },
    [kind]
  );

  return { people, loading, usingSample, add };
}
