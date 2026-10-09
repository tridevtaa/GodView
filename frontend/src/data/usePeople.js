import { useCallback, useEffect, useState } from "react";
import {
  addDoc,
  collection,
  getDocs,
  getDocsFromCache,
  query,
  serverTimestamp,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "../firebase.js";
import { SAMPLE } from "./sample.js";
import { mergeRows, nextMark } from "./syncMerge.js";

// Firestore bills every document a query returns, so reloading the whole
// collection on each visit adds up fast (one full load of students is ~900
// reads). Instead: read the browser's cached copy, then ask the server only for
// documents whose `updated_at` is newer than the newest one we already have.
// Every write in the app sets `updated_at` (see stamp below), which is what
// makes changes from other staff show up here.
//
// The last-synced time lives in localStorage; clearLocalData() resets it.
const syncKey = (kind) => `godview.sync.${kind}`;

function readSyncMark(kind) {
  try {
    return Number(localStorage.getItem(syncKey(kind))) || 0;
  } catch {
    return 0;
  }
}

function writeSyncMark(kind, millis) {
  try {
    localStorage.setItem(syncKey(kind), String(millis));
  } catch {
    // Storage blocked: next visit just does a full load again.
  }
}

const toRow = (d) => ({ id: d.id, ...d.data() });

async function loadPeople(kind) {
  const col = collection(db, kind);
  const since = readSyncMark(kind);

  let cached = [];
  if (since) {
    try {
      cached = (await getDocsFromCache(col)).docs.map(toRow);
    } catch {
      cached = [];
    }
  }

  if (cached.length === 0) {
    // First visit on this browser (or cache was cleared): one full load.
    const rows = (await getDocs(col)).docs.map(toRow);
    writeSyncMark(kind, nextMark(rows, since));
    return { rows, stale: false };
  }

  let changed;
  try {
    changed = (await getDocs(query(col, where("updated_at", ">", Timestamp.fromMillis(since))))).docs.map(toRow);
  } catch {
    // Offline or over quota: the saved copy is still useful, just not current.
    return { rows: cached, stale: true };
  }
  const rows = mergeRows(cached, changed);
  // Mark from server-set timestamps, not this device's clock.
  writeSyncMark(kind, nextMark(rows, since));
  return { rows, stale: false };
}

// Fields to add to every write so other browsers pick the change up.
export const stamp = () => ({ updated_at: serverTimestamp() });

// Loads a collection ("students" | "employees"). An empty collection shows
// sample data; a failed read shows nothing and reports the error.
// `source` is "firestore" | "sample" | "error"; `stale` means the list is the
// saved copy because checking for updates failed.
export function usePeople(kind) {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState("firestore");
  const [stale, setStale] = useState(false);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadPeople(kind)
      .then(
        ({ rows, stale }) => {
          if (cancelled) return;
          setStale(stale);
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
      const { id } = await addDoc(collection(db, kind), { ...record, ...stamp() });
      setPeople((prev) => [{ id, ...record }, ...(source === "sample" ? [] : prev)]);
      setSource("firestore");
    },
    [kind, source]
  );

  // Apply fields already saved elsewhere (e.g. has_photo) to the list on screen.
  const patch = useCallback((id, fields) => {
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, ...fields } : p)));
  }, []);

  return { people, loading, source, stale, add, patch, reload };
}
