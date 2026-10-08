import { useCallback, useEffect, useState } from "react";
import { addDoc, collection, getDocs } from "firebase/firestore";
import { db } from "../firebase.js";
import { SAMPLE } from "./sample.js";

// Optional real records kept out of git (e.g. students.local.json). The glob
// resolves to {} when no such file exists, so the build never depends on it.
const LOCAL = Object.fromEntries(
  Object.entries(import.meta.glob("./*.local.json", { eager: true, import: "default" })).map(
    ([file, rows]) => [file.match(/\.\/(\w+)\.local\.json$/)[1], rows]
  )
);

// Loads a Firestore collection ("students" | "employees"). When it is empty or
// Firestore can't be reached, falls back to local records, then sample data.
// `source` is "firestore" | "local" | "sample".
export function usePeople(kind) {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState("firestore");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getDocs(collection(db, kind))
      .then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      .catch(() => [])
      .then((rows) => {
        if (cancelled) return;
        if (rows.length > 0) {
          setSource("firestore");
          setPeople(rows);
        } else if (LOCAL[kind]?.length) {
          setSource("local");
          setPeople(LOCAL[kind]);
        } else {
          setSource("sample");
          setPeople(SAMPLE[kind]);
        }
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

  return { people, loading, source, add };
}
